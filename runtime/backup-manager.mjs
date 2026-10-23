// RC9 candidate: protected, pre-write file snapshots. Backups are kept in the
// private state directory, never inside a user's repository or Git index.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {vault} from './secure-state.mjs';
import {config} from './config.mjs';
import {canonical, route, within} from './access-policy.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const MAX_FILE = 32 * 1024 * 1024; // fail closed, no huge memory / disk copies
const MAX_BATCH = 128 * 1024 * 1024;
const gitEnv = index => ({...process.env, GIT_INDEX_FILE:index, GIT_OPTIONAL_LOCKS:'0', GIT_TERMINAL_PROMPT:'0'});
const looksCredentialBearing = raw => raw.includes(0) || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:api[_-]?key|secret|access[_-]?token|password|authorization)\s*[=:]\s*["']?(?:Bearer\s+)?[A-Za-z0-9+/_.-]{16,}/i.test(raw.toString('utf8'));
const regular = p => {
  try {
    const s=fs.lstatSync(p);
    if(s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()) || (s.isFile() && s.nlink!==1))throw Error('Linked/device/special file cannot be snapshotted');
    return s;
  } catch(e) {if(e.code==='ENOENT')return null;throw e;}
};
const metaFile = (dir) => path.join(dir,'manifest.json');
export function snapshotTargetAllowed(target,{reviewed=false}={}){
  const c=route(target);
  // Policy gates belong to the broker. An exact human-approved operation may
  // snapshot a protected target; storage/link/integrity limits still apply.
  if(reviewed)return true;
  return (c.permission==='project'&&!c.system&&!c.sensitive)||(config.blacklistDefaultAllow&&!['private','vault'].includes(c.permission)&&!c.secretAdjacent&&(!c.sensitive||c.system));
}

export class BackupManager {
  // Explicit sealer injection is used only by isolated unit tests. The server
  // always uses the Windows-owner protected key from vault(stateDir).
  constructor({stateDir=config.stateDir,git=config.executables.git,sealer}={}){
    this.root=path.join(stateDir,'backups');this.git=git;
    this.sealer=sealer??vault(stateDir);
    this.reviewScope=new AsyncLocalStorage();
    fs.mkdirSync(this.root,{recursive:true,mode:0o700});
  }
  // Internal broker capability, never an MCP argument. Async-local scope keeps
  // approval for one operation from widening another concurrent operation.
  withReviewed(fn){return this.reviewScope.run(true,fn);}
  saveManifest(id,data,{initial=false}={}){
    const folder=path.join(this.root,id),dest=metaFile(folder),temp=path.join(folder,`manifest-${randomUUID()}.tmp`);
    try{
      if(initial&&fs.existsSync(dest))throw Error('Snapshot manifest already exists');
      fs.writeFileSync(temp,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
      fs.renameSync(temp,dest);
    }finally{try{fs.rmSync(temp,{force:true});}catch{}}
  }
  manifest(id){
    if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid backup ID');
    const folder=path.join(this.root,id);
    const data=JSON.parse(fs.readFileSync(metaFile(folder),'utf8'));
    if(data.id!==id)throw Error('Backup identity mismatch');
    return data;
  }
  info(m){return {id:m.id,operation:m.operation,createdAt:m.createdAt,files:m.files.map(({path,existed,kind,beforeHash,afterHash})=>({path,existed,kind,beforeHash,afterHash})),git:m.git??null,status:m.status,...(m.jobId?{jobId:m.jobId}:{}),...(m.interruption?{interruption:m.interruption}:{})};}
  list(limit=20){
    return fs.readdirSync(this.root,{withFileTypes:true}).filter(e=>e.isDirectory() && /^[0-9a-f-]{36}$/i.test(e.name))
      .map(e=>{try{return this.info(this.manifest(e.name));}catch{return null;}}).filter(Boolean)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,Math.min(Math.max(1,limit),100));
  }
  pendingJobs(){
    return fs.readdirSync(this.root,{withFileTypes:true})
      .filter(e=>e.isDirectory()&&/^[0-9a-f-]{36}$/i.test(e.name))
      .map(e=>{try{return this.info(this.manifest(e.name));}catch{return null;}})
      .filter(x=>x&&x.status==='prepared'&&x.jobId);
  }
  attachJob(id,jobId){
    if(!/^[0-9a-f-]{36}$/i.test(jobId))throw Error('Invalid durable job ID');
    const m=this.manifest(id);
    if(m.status!=='prepared'||m.jobId)throw Error('Snapshot already finalized or assigned');
    m.jobId=jobId;
    this.saveManifest(id,m);
    return this.info(m);
  }
  interrupt(id,reason='Job completion could not be verified'){
    const m=this.manifest(id);
    if(m.status!=='prepared')return this.info(m);
    const observed=m.files.map(e=>{
      try{const now=this.current(e.path);return {path:e.path,kind:now.kind,hash:now.digest,changed:now.kind!==e.kind||now.digest!==e.beforeHash};}
      catch(error){return {path:e.path,error:error.message,changed:null};}
    });
    m.status='interrupted-unverified';
    m.interruption={observedAt:new Date().toISOString(),observed,reason};
    this.saveManifest(id,m);
    return this.info(m);
  }
  current(p){
    const stat=regular(p);
    if(!stat)return {existed:false,kind:'absent',digest:null};
    if(stat.isDirectory())return {existed:true,kind:'directory',digest:null};
    if(stat.size>MAX_FILE)throw Error('File too large for protected pre-write snapshot');
    return {existed:true,kind:'file',digest:hash(fs.readFileSync(p))};
  }
  // Commit an isolated Git ref without editing the user's working index/branch.
  // A protected physical snapshot always remains the authoritative rollback.
  checkpoint(dir,entries,id){
    if(!this.git || !fs.existsSync(this.git))return {status:'unavailable'};
    const run=(cwd,args,env)=>execFileSync(this.git,['-c','core.hooksPath=NUL',...args],{cwd,env,encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
    try{
      const root=run(path.dirname(entries[0].path),['rev-parse','--show-toplevel']);
      if(!root || entries.some(e=>!within(e.path,canonical(root))))return {status:'different-repos'};
      const parent=run(root,['rev-parse','--verify','HEAD']);
      const index=path.join(dir,'isolated-git.index');const env=gitEnv(index);
      run(root,['read-tree',parent],env);
      let included=0,skippedSensitivePreimages=0;
      for(const e of entries){
        if(e.kind!=='file' || !e.existed)continue;
        const rel=path.win32.relative(root,e.path).replaceAll('\\','/');
        const stage=run(root,['ls-files','--stage','--',rel]);
        const mode=stage.match(/^(100644|100755)\s+[a-f0-9]{40,64}\s+0\t/i)?.[1];
        if(!mode)continue;
        const raw=fs.readFileSync(e.path);
        if(looksCredentialBearing(raw)){skippedSensitivePreimages++;continue;}
        // Plumbing bypasses repository clean filters and hooks. 'git add'
        // can execute user-configured filter.*.clean commands as this owner.
        // Only the explicitly snapshotted preimage is added to the isolated
        // index. Unknown/binary or obvious credential text stays in DPAPI.
        const oid=run(root,['hash-object','-w','--no-filters','--',e.path]);
        if(!/^[a-f0-9]{40,64}$/i.test(oid))throw Error('Unexpected Git object ID');
        run(root,['update-index','--add','--cacheinfo',`${mode},${oid},${rel}`],env);included++;
      }
      if(!included)return {status:'no-tracked-target',skippedSensitivePreimages};
      const tree=run(root,['write-tree'],env);
      // commit-tree needs a stable identity even on a machine without user.name.
      // No branch, HEAD, index or user git config is written.
      const identity={...env,GIT_AUTHOR_NAME:'YGPT Local Checkpoint',GIT_AUTHOR_EMAIL:'checkpoint@localhost',GIT_COMMITTER_NAME:'YGPT Local Checkpoint',GIT_COMMITTER_EMAIL:'checkpoint@localhost'};
      const commit=run(root,['commit-tree',tree,'-p',parent,'-m',`YGPT protected pre-write ${id}`],identity);
      const ref=`refs/ygpt/checkpoints/${id}`;
      run(root,['update-ref',ref,commit]);
      return {status:'created',ref,commit,parent,trackedFiles:included,skippedSensitivePreimages,repoRoot:root};
    }catch(e){return {status:'unavailable',reason:`Git checkpoint failed (${e.code??'unknown'}); physical snapshot retained`};}
    finally{try{fs.rmSync(path.join(dir,'isolated-git.index'),{force:true});}catch{}}
  }
  // A failed post-checkpoint preparation must not leave a new Git reference.
  // Compare against the exact commit so concurrent Git changes are protected.
  discardCheckpoint(checkpoint){
    if(checkpoint?.status!=='created')return true;
    if(!this.git || !fs.existsSync(this.git) || !/^refs\/ygpt\/checkpoints\/[0-9a-f-]{36}$/i.test(checkpoint.ref))return false;
    try{
      execFileSync(this.git,['-c','core.hooksPath=NUL','update-ref','-d',checkpoint.ref,checkpoint.commit],{
        cwd:checkpoint.repoRoot,env:gitEnv(path.join(this.root,'unused-index')),timeout:10000,windowsHide:true,stdio:'ignore'
      });
      return true;
    }catch{return false;}
  }
  // Call once on a newly started bridge before serving mutations. A power
  // failure may have happened after the target changed but before finish().
  // Keep its encrypted preimage, record current evidence, and require manual
  // recovery planning rather than silently treating it as a successful edit.
  reconcileInterrupted(){
    let count=0;
    for(const entry of fs.readdirSync(this.root,{withFileTypes:true})){
      if(!entry.isDirectory()||! /^[0-9a-f-]{36}$/i.test(entry.name))continue;
      let m;try{m=this.manifest(entry.name);}catch{continue;}
      if(m.status!=='prepared'||m.jobId)continue; // durable jobs are reconciled with their persistent job ledger
      this.interrupt(m.id,'Bridge stopped before the write result was finalized; do not assume the observed bytes came from this operation');count++;
    }
    return count;
  }
  create(operation,targets){
    const unique=[...new Set(targets.map(canonical))];
    if(!unique.length || unique.length>100)throw Error('Unsupported snapshot target count');
    const entries=[];let size=0;
    for(const p of unique){
      if(!snapshotTargetAllowed(p,{reviewed:this.reviewScope.getStore()===true}))
        throw Error('Protected snapshot target requires a verified owner decision');
      const stat=regular(p);
      if(stat?.isDirectory() && operation==='move_file')throw Error('Directory move needs a reviewed tree-level recovery plan');
      if(stat?.isFile()){size+=stat.size;if(stat.size>MAX_FILE||size>MAX_BATCH)throw Error('Snapshot exceeds protected storage size limit');}
      entries.push({path:p,existed:!!stat,kind:!stat?'absent':stat.isDirectory()?'directory':'file',beforeHash:null,afterHash:null,size:stat?.size??0,mode:stat?.mode??null,mtimeMs:stat?.mtimeMs??null});
    }
    const id=randomUUID(),dir=path.join(this.root,id);
    // A failed copy must never permit mutation. Retain a failed staging folder
    // for diagnostics only until confirmed safe to remove.
    fs.mkdirSync(dir,{mode:0o700});
    let gitCheckpoint=null;
    try{
      for(let i=0;i<entries.length;i++){
        const e=entries[i];if(e.kind!=='file')continue;
        const raw=fs.readFileSync(e.path);e.beforeHash=hash(raw);
        if(raw.length!==e.size)throw Error('File changed while backing up');
        const sealed=this.sealer.seal(raw.toString('base64'));
        const filename=path.join(dir,`${i}.sealed`);
        fs.writeFileSync(filename,sealed,{flag:'wx',mode:0o600});
        if(hash(Buffer.from(this.sealer.open(fs.readFileSync(filename,'utf8')),'base64'))!==e.beforeHash)throw Error('Backup integrity check failed');
        if(this.current(e.path).digest!==e.beforeHash)throw Error('File changed during snapshot');
      }
      // Detect external changes again after the optional Git work.
      for(const e of entries){const c=this.current(e.path);if(c.existed!==e.existed||c.kind!==e.kind||c.digest!==e.beforeHash)throw Error('File changed during pre-write preparation');}
      const git=entries.some(e=>e.existed&&e.kind==='file')?this.checkpoint(dir,entries,id):{status:'no-existing-file'};
      gitCheckpoint=git;
      for(const e of entries){const c=this.current(e.path);if(c.existed!==e.existed||c.kind!==e.kind||c.digest!==e.beforeHash)throw Error('File changed during Git checkpoint; no edit permitted');}
      const manifest={id,operation,createdAt:new Date().toISOString(),files:entries,git,status:'prepared'};
      this.saveManifest(id,manifest,{initial:true});
      return this.info(manifest);
    }catch(e){
      if(!this.discardCheckpoint(gitCheckpoint)){
        fs.writeFileSync(path.join(dir,'checkpoint-cleanup-required.json'),JSON.stringify({id,git:gitCheckpoint,error:e.message}));
        throw Error('Pre-write preparation failed and Git checkpoint cleanup requires manual review: '+gitCheckpoint.ref+'; '+e.message);
      }
      fs.rmSync(dir,{recursive:true,force:true});throw e;
    }
  }
  verify(id){const m=this.manifest(id);
    for(const e of m.files){const c=this.current(e.path);if(c.existed!==e.existed||c.kind!==e.kind||c.digest!==e.beforeHash)throw Error('Target changed after pre-write backup; operation aborted');}
    return true;
  }
  finish(id,result){
    const m=this.manifest(id);if(m.status!=='prepared')throw Error('Backup already finalized');
    for(const e of m.files){const c=this.current(e.path);e.afterHash=c.digest;e.afterKind=c.kind;}
    m.status=result?'completed':'failed-or-unknown';
    this.saveManifest(id,m);
    return this.info(m);
  }
  diff(id){return this.info(this.manifest(id));}
  // A restored file is installed via a sibling temporary file so incomplete
  // writes never truncate the user's existing target. This is not an OS-wide
  // multi-file transaction: compensation uses the independent undo snapshot.
  applyEntry(e,contents){
    if(!e.existed){
      const stat=regular(e.path);
      if(stat){if(stat.isDirectory())fs.rmdirSync(e.path);else fs.unlinkSync(e.path);}
      return;
    }
    if(e.kind==='directory'){fs.mkdirSync(e.path,{recursive:true});return;}
    const tmp=path.join(path.dirname(e.path),`.ygpt-restore-${randomUUID()}.tmp`);
    fs.mkdirSync(path.dirname(e.path),{recursive:true});
    try{
      fs.writeFileSync(tmp,contents,{flag:'wx',mode:0o600});
      fs.renameSync(tmp,e.path);
      if(e.mode!==null)fs.chmodSync(e.path,e.mode);
      if(e.mtimeMs!==null)fs.utimesSync(e.path,new Date(),new Date(e.mtimeMs));
    }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  }
  savedContents(id,files){return files.map((e,i)=>{
    if(e.kind!=='file'||!e.existed)return null;
    const raw=Buffer.from(this.sealer.open(fs.readFileSync(path.join(this.root,id,`${i}.sealed`),'utf8')),'base64');
    if(hash(raw)!==e.beforeHash||raw.length!==e.size)throw Error('Saved snapshot integrity check failed');
    return raw;
  });}
  restore(id,{reviewed=false}={}){
    if(reviewed&&this.reviewScope.getStore()!==true)return this.withReviewed(()=>this.restore(id));
    reviewed=this.reviewScope.getStore()===true;
    const m=this.manifest(id);
    if(!['completed','failed-or-unknown'].includes(m.status))throw Error('Snapshot is not a restorable edit');
    const contents=this.savedContents(id,m.files); // decrypt and verify ALL before writing ANYTHING
    for(const e of m.files){
      const classification=route(e.path);
      if(!reviewed&&(classification.permission!=='project'||classification.system||classification.sensitive)&&!(config.blacklistDefaultAllow&&!['private','vault'].includes(classification.permission)&&!classification.secretAdjacent&&!classification.sensitive))
        throw Error('Restore target requires a verified owner decision');
      const c=this.current(e.path);
      if(c.kind!==e.afterKind||c.digest!==e.afterHash)throw Object.assign(Error('Restore conflict: target changed since snapshot; no files restored. Review the diff; do not retry this restore.'),{code:'CONFLICT',effectStarted:false,filesRestored:0});
    }
    const undo=this.create('restore',m.files.map(e=>e.path));this.verify(undo.id);
    const undoManifest=this.manifest(undo.id),undoContents=this.savedContents(undo.id,undoManifest.files);
    const applied=[];
    try{
      for(let i=0;i<m.files.length;i++){
        const e=m.files[i];
        const c=this.current(e.path);
        if(c.kind!==e.afterKind||c.digest!==e.afterHash)throw Error('Restore conflict: target changed during restoration');
        // Include a partially completed replacement in the compensation set.
        applied.push(i);this.applyEntry(e,contents[i]);
      }
      this.finish(undo.id,true);
      m.status='restored';this.saveManifest(id,m);
      return {restored:id,undoBackupId:undo.id};
    }catch(e){
      const errors=[];
      for(const i of applied.reverse()){
        try{this.applyEntry(undoManifest.files[i],undoContents[i]);}
        catch(recoveryError){errors.push(`${i}: ${recoveryError.message}`);}
      }
      try{this.finish(undo.id,false);}catch(recoveryError){errors.push(`undo ledger: ${recoveryError.message}`);}
      throw Error('Restore incomplete: '+e.message+(errors.length?'; COMPENSATION INCOMPLETE: '+errors.join(', '):'; prior edits compensated; inspect undo snapshot '+undo.id));
    }
  }
}
