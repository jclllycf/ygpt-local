import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {EngineError} from './file-engine.mjs';
import {LocalCatalog} from './local-catalog.mjs';
import {LocalMcp,toolScratch,removeScratch} from './local-mcp.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
export class LocalDispatch {
  constructor({root,stateDir,currentOwner,jobs,catalog,connect,...options}){
    Object.assign(this,{root,stateDir,owner:currentOwner,jobs});this.catalog=catalog??new LocalCatalog({root,stateDir,...options});this.mcp=new LocalMcp({catalog:this.catalog,currentOwner,connect});
    this.db=new DatabaseSync(path.join(stateDir,'local-tasks.sqlite3'));this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,entry TEXT NOT NULL,fingerprint TEXT NOT NULL,label TEXT NOT NULL,cwd TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL,scratch TEXT,session TEXT,parent TEXT);
      CREATE INDEX IF NOT EXISTS task_owner ON tasks(owner,created);`);
    if(!this.db.prepare('PRAGMA table_info(tasks)').all().some(c=>c.name==='request_digest'))this.db.exec('ALTER TABLE tasks ADD COLUMN request_digest TEXT');
    // Discovery reads configuration only, never starts an MCP server or Agent.
    this.catalog.refresh().catch(()=>{});this.starting=new Map();this.closing=false;
    this.sweeper=setInterval(()=>{if(!this.sweeping&&!this.closing)this.sweeping=this.cleanup().catch(()=>{}).finally(()=>{this.sweeping=null;});},60000);this.sweeper.unref?.();
  }
  async prepare(kind,a){
    const entry=await this.catalog.get(a.entryId,kind),cwd=await fs.realpath(a.cwd??this.root);if(!(await fs.stat(cwd)).isDirectory())throw new EngineError('LOCAL_CWD_INVALID','Choose an existing working directory');
    const env=await this.catalog.environment(entry,path.join(this.catalog.folders.local,'YGPT Local','ToolScratch'));
    const executable=await this.catalog.executable(entry.executable,env,cwd);let args=[...(entry.args??[])],stdin=a.stdin??null;
    if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))throw new EngineError('LOCAL_ARGS_INVALID','The configured argument prefix must be a string array');
    if(kind==='agent'&&entry.adapter==='codex'){
      if(a.args?.length)throw new EngineError('AGENT_ARGS_INVALID','The Codex adapter preserves its configured provider/model and permission defaults. Use the CLI entry for an explicit custom invocation.');
      if(a.resumeTaskId){const previous=this.task(a.resumeTaskId);if(previous.entry!==entry.id||previous.cwd!==cwd||!previous.session||!['succeeded','failed','cancelled'].includes(previous.state))throw new EngineError('AGENT_RESUME_INVALID','Resume only a finished task from this chat, exact account and directory, with a recorded session ID');args.push('exec','resume','--json',previous.session,'-');}
      else args.push('exec','--json','-');
      if(typeof a.prompt!=='string'||!a.prompt.trim())throw new EngineError('AGENT_PROMPT_REQUIRED','Provide the delegated task');stdin=a.prompt;
    }else{
      if(kind==='agent'&&entry.adapter==='custom'&&!(a.args?.length))throw new EngineError('AGENT_ARGUMENTS_REQUIRED','This Agent requires its documented non-interactive arguments. Inspect this installed CLI help first; YGPT will not guess permission or model flags.');
      args.push(...(a.args??[]));if(kind==='agent'&&a.prompt!==undefined)stdin=a.prompt;
      if(a.resumeTaskId)throw new EngineError('AGENT_RESUME_UNSUPPORTED','This adapter has no verified resume contract; do not reuse another task session');
    }
    if(args.length>100||args.some(x=>typeof x!=='string'||x.length>32768||/[\0\r\n]/.test(x)))throw new EngineError('LOCAL_ARGS_INVALID','Use at most 100 bounded argv strings without line breaks');
    if(stdin!==null&&(typeof stdin!=='string'||Buffer.byteLength(stdin)>262144))throw new EngineError('LOCAL_STDIN_INVALID','Prompt/stdin exceeds 256 KiB');
    // Scripts are invoked through an explicit interpreter, never a shell-built command.
    let launch={executable,args};
    if(/\.(?:cmd|bat)$/i.test(executable)){
      // Node's cross-spawn escapes each Windows argv element; keep this in a
      // bundled fixed launcher instead of interpolating model data into cmd /c.
      launch={executable:process.execPath,args:[fileURLToPath(new URL('./workers/local-cli-launcher.mjs',import.meta.url)),executable,...args]};
    }else if(/\.ps1$/i.test(executable))launch={executable:path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),args:['-NoProfile','-NonInteractive','-File',executable,...args]};
    const fingerprint=digest(entry.fingerprint+'\0'+digest(await fs.readFile(executable)));
    return {entry,cwd,env,executable,args,stdin,launch,fingerprint,timeoutMs:a.timeoutMs??1800000};
  }
  async review(name,a){
    if(['y_capabilities','y_capability_sources'].includes(name))return {riskText:'',binding:null};
    if(name==='y_mcp'){if(['status','close'].includes(a.action))return {riskText:'',binding:null};return this.mcp.review(a);}
    if(a.action!=='run')return {riskText:'',binding:null};
    const p=await this.prepare(name==='y_agent'?'agent':'cli',a);
    return {riskText:JSON.stringify({executable:p.executable,args:p.args,stdin:p.stdin,cwd:p.cwd}),binding:{entry:p.entry.id,fingerprint:p.fingerprint,cwd:p.cwd}};
  }
  task(id){const t=this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!t||t.owner!==this.owner())throw new EngineError('SESSION_FOREIGN','This local task belongs to another chat or is unavailable');return t;}
  async update(t){
    let status;try{status=await this.jobs.status(t.id);}catch{return {...t,state:'unknown',reason:'The durable job inventory is unavailable; this task was not replayed'};}
    this.db.prepare('UPDATE tasks SET state=?,session=COALESCE(?,session) WHERE id=?').run(status.state,status.agent_session??null,t.id);t.state=status.state;t.session=status.agent_session??t.session;
    if(t.scratch&&!['queued','running','unknown'].includes(status.state)){await removeScratch(JSON.parse(t.scratch));this.db.prepare('UPDATE tasks SET scratch=NULL WHERE id=?').run(t.id);}
    return {...t,job:status};
  }
  view(t){return {taskId:t.id,job_id:t.id,kind:t.kind,entryId:t.entry,label:t.label,cwd:t.cwd,state:t.state,agentSessionId:t.session??null,parentTaskId:t.parent??null,createdAt:new Date(t.created).toISOString(),...(t.job?{job:t.job}:{})};}
  async run(kind,a){
    if(this.closing)throw new EngineError('ENGINE_CLOSED','Local dispatcher is closing');const owner=this.owner();if(!owner)throw new EngineError('CONTEXT_REQUIRED','Retain this chat context');
    if(a.action==='list'){
      const rows=this.db.prepare('SELECT * FROM tasks WHERE owner=? ORDER BY created DESC LIMIT 100').all(owner),tasks=[];
      for(const row of rows)tasks.push(this.view(await this.update(row)));return {tasks};
    }
    if(a.action!=='run'){
      const t=this.task(a.taskId);if(t.kind!==kind)throw new EngineError('LOCAL_TASK_KIND','Use the same task interface that started this task');
      if(a.action==='cancel'){await this.jobs.cancel(t.id);return {taskId:t.id,cancelRequested:true,...this.view(await this.update(t))};}
      const updated=await this.update(t);if(a.action==='status')return this.view(updated);
      if(a.action!=='logs')throw new EngineError('LOCAL_TASK_ACTION','Choose run, list, status, logs or cancel');
      const logs=await this.jobs.logs(t.id);
      // Codex JSONL records its real session ID; no Desktop history is merged.
      for(const line of (logs.text??'').split('\n')){try{const v=JSON.parse(line);if(v.type==='thread.started'&&/^[a-f0-9-]{36}$/i.test(v.thread_id??'')){this.db.prepare('UPDATE tasks SET session=? WHERE id=?').run(v.thread_id,t.id);updated.session=v.thread_id;}}catch{}}
      return {...this.view(updated),logs,transientObservation:true};
    }
    const id=a.taskId??randomUUID(),requestDigest=digest(JSON.stringify({kind,entryId:a.entryId,args:a.args??[],cwd:a.cwd??this.root,stdin:a.stdin??null,prompt:a.prompt??null,resumeTaskId:a.resumeTaskId??null,timeoutMs:a.timeoutMs??1800000}));
    const old=this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(old){const t=this.task(id);if(t.request_digest!==requestDigest)throw new EngineError('IDEMPOTENCY_COLLISION','This task ID names different arguments; the existing command was not repeated');return {...this.view(await this.update(t)),reused:true,message:'Existing task returned; no command was repeated'};}
    const count=this.db.prepare("SELECT count(*) AS n FROM tasks WHERE owner=? AND state IN ('preparing','queued','running','unknown')").get(owner).n+(this.starting.get(owner)??0);
    if(count>=2)throw new EngineError('CONCURRENCY_LIMIT','This chat has two active or unresolved local tasks; check or cancel one before starting another');
    this.starting.set(owner,(this.starting.get(owner)??0)+1);let scratch;
    try{
      const p=await this.prepare(kind,a);scratch=await toolScratch(this.catalog,owner);const env=await this.catalog.environment(p.entry,scratch.dir);
      if(this.closing)throw new EngineError('ENGINE_CLOSED','Local dispatcher is closing');
      this.db.prepare('INSERT INTO tasks(id,owner,kind,entry,fingerprint,label,cwd,created,state,scratch,parent,request_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,kind,p.entry.id,p.fingerprint,(a.label??p.entry.name).slice(0,160),p.cwd,Date.now(),'preparing',JSON.stringify(scratch),a.resumeTaskId??null,requestDigest);
      let result;
      try{result=await this.jobs.call({action:'submit',id,argv:[p.launch.executable,...p.launch.args],cwd:p.cwd,timeoutSeconds:Math.ceil(p.timeoutMs/1000),environment:env,stdin:p.stdin});}
      catch(e){this.db.prepare("UPDATE tasks SET state='unknown' WHERE id=?").run(id);throw Object.assign(new EngineError('LOCAL_TASK_OUTCOME_UNKNOWN','Task submission was interrupted. Check task '+id+' instead of starting it again.'),{effectStarted:true,outcomeUnknown:true});}
      this.db.prepare('UPDATE tasks SET state=? WHERE id=?').run(result.state,id);
      return {...this.view(this.task(id)),accountHome:p.entry.accountHome??null,model:p.entry.model??null,provider:p.entry.provider??null,defaultsPreserved:true,desktopConversationCreated:false,stdinClosed:true,permissionScope:'YGPT checks this launch; the delegated agent retains its own configuration and permissions. Full Access is not forwarded.'};
    }catch(e){if(scratch&&!this.db.prepare('SELECT id FROM tasks WHERE id=?').get(id))await removeScratch(scratch);throw e;}
    finally{this.starting.set(owner,Math.max(0,(this.starting.get(owner)??1)-1));}
  }
  async cleanup(){for(const t of this.db.prepare('SELECT * FROM tasks WHERE scratch IS NOT NULL LIMIT 32').all())await this.update(t);}
  async close(){this.closing=true;clearInterval(this.sweeper);await this.sweeping;await this.mcp.close();await this.cleanup();this.db.close();}
}
