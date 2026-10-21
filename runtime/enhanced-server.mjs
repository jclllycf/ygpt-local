import {spawn} from 'node:child_process';
import {statfs} from 'node:fs/promises';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import Ajv from 'ajv';
import {SUPPORTED_PROTOCOL_VERSIONS,LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/sdk/types.js';
import {config,INSTALL,RUNTIME,cleanEnv,currentPermissionMode} from './config.mjs';
import {authorize,canonical,projectRoots,systemRoots,developerTasks,planDevTask} from './access-policy.mjs';
// RC9 never loads the Windows WPF/local approval implementation. Review-needed
// operations are suspended until a trusted ChatGPT host event is verified.
const noLocalReview=config.rc9Candidate||config.localApprovalDisabled;
const {launchPortal,lookup,pending,portal,ledger,acl,releaseLease,closePanel}=await import(noLocalReview?'./owner-state.mjs':'./approvals.mjs');
import {protectForWindows} from './secure-state.mjs';
import {scrub} from './durable.mjs';
import {validateSource,validateDestination,checksum,diskInspect,deviceFingerprint} from './safe-actions.mjs';
import {describeOperation} from './operation-description.mjs';
import {chatScope} from './chat-scope.mjs';
import {profileSummary} from './permission-profiles.mjs';
import {BackupManager} from './backup-manager.mjs';
import {jobSnapshotTargets as planTerminalSnapshots} from './terminal-snapshots.mjs';
import {createNativeExtension} from './native-extension.mjs';
import {barTools,barEnabled,uiEnabled,barResource,approvalResourceUris,BAR_URI,LEGACY_BAR_URI,INSPECTION_URI,approvalCenterTool,approvalCenterResult,chatApprovalResult,handleBar,previewTool,previewResult} from './inline-approval.mjs';
import {describeEnglish,reviewScope} from './chat-review.mjs';
import {stable,digest} from './durable.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {CURRENT_PROTOCOL,requestHost,nativeConsentSupported,nativeConsentRequest,resumeNativeConsent} from './host-consent.mjs';
import {sqliteRead} from './sqlite-read.mjs';
import {canonicalToolName} from '../compatibility/tool-names.mjs';
const wireContext=new AsyncLocalStorage();
const source=path.join(RUNTIME,'compat-entry.mjs');
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},id={type:'string',format:undefined,maxLength:128};
const integer={type:'integer',minimum:1,maximum:100};
const additions=[
 ['y_sqlite_read','Read a SQLite database or inspect its schema without approval. Connection is read-only and query_only; no write statements, attachments or extensions. Prefer this over terminal scripts for .codex or other local databases.',obj({path:str,sql:{type:'string',maxLength:20000},params:{type:'array',maxItems:100,items:{type:['string','number','null']}},maxRows:{type:'integer',minimum:1,maximum:1000}},['path','sql'])],
 ['y_ping','Health of YGPT local engine and owner connection; no monthly local quota.',obj()],
 ['y_pending_approvals','List pending request IDs and states; never grants approval.',obj()],
 ['y_wait_approval','Wait for an already displayed approval and return the original result, keeping the task in progress. Never executes or replays the action. Continue waiting while pending; do not produce a final report above the card.',obj({requestId:str,resultToken:str,waitMs:{type:'integer',minimum:100,maximum:25000}},['requestId','resultToken'])],
 ['y_service_health','Fixed read-only YGPT process, engine, catalog and approval-channel health. No shell or protected configuration contents.',obj()],
 ['y_policy','Current project permissions, protections and private owner deployment.',obj()],
 ['y_permission_mode','Read the active local security mode: autonomous, balanced or secure. Changing modes requires an owner action in the local Windows settings, never a model tool call.',obj()],
 ['y_workstation_health','Read-only RAM/CPU/disk health.',obj()],
 ['y_dev_task','Run predefined git, Node, npm or Python project tasks in an owner-trusted Windows project without a shell. Requires explicit owner opt-in and can run project scripts; returns durable job ID and output token.',obj({cwd:str,task:{type:'string',enum:developerTasks},timeoutSeconds:{type:'integer',minimum:1,maximum:1800}},['cwd','task'])],
 // No waiting-for-human tools are advertised in the no-prompt build.
 ['y_close_context','Revoke this chat-held context and its narrow temporary grants. No host session ID is trusted.',obj({contextToken:str},['contextToken'])],
 ['job_submit','Start an owner-scoped durable job. argv[0] must be an absolute executable. Trusted development tasks run without a local approval prompt.',obj({cwd:str,argv:{type:'array',items:str,minItems:1,maxItems:100},timeoutSeconds:{type:'integer',minimum:1,maximum:86400}},['cwd','argv'])],
 ['run_trusted_workflow','Run an owner-reviewed build/test workflow. Exact cwd, argv and entry-file hashes must match; otherwise requires one local approval.',obj({cwd:str,argv:{type:'array',items:str,minItems:1,maxItems:100},timeoutSeconds:{type:'integer',minimum:1,maximum:86400}},['cwd','argv'])],
 ['download_file','Download from fixed official HTTPS sources into an owner-allowed folder. Never executes downloaded code or changes a physical disk. Returns a durable job ID and scoped output token.',obj({url:str,destination:str,sha256:{type:'string',pattern:'^[a-fA-F0-9]{64}$'},maxBytes:{type:'integer',minimum:1,maximum:10737418240}},['url','destination'])],
 ['inspect_download_status','Read download byte progress using its job outputToken; no additional panel.',obj({id,outputToken:str},['id','outputToken'])],
 ['verify_checksum','Read an ordinary project file and compute/compare SHA-256 without modifying it.',obj({path:str,sha256:{type:'string',pattern:'^[a-fA-F0-9]{64}$'}},['path'])],
 ['disk_inspect','Read-only fixed inventory of disk models, sizes and partitions. Never formats, writes or elevates permissions.',obj()],
 ['job_status','Get persistent job state. Content and commands are not returned.',obj({id},['id'])],
 ['job_tail','Read bounded job log with outputToken from its original submission; no repeated approval.',obj({id,outputToken:str,lines:integer},['id','outputToken'])],
 ['job_cancel','Cancel only the approved job identified by id and its outputToken. Never accepts a PID.',obj({id,outputToken:str},['id','outputToken'])],
 ['job_recover','Ask for local consent to release a new result token for an existing job after a lost response. Does not replay or restart it.',obj({id},['id'])],
 ['job_list','List this private instance jobs without raw arguments or output tokens.',obj({limit:integer})],
 ['call_status','Get durable operation/call state by ID. A pending ChatGPT generation is not kept open.',obj({id},['id'])],
 ['call_result','Recover a bounded encrypted result with the resultToken returned to the original caller. Never repeat an unknown operation.',obj({id,resultToken:str},['id','resultToken'])],
 ['recent_calls','Recent call IDs/states; no arguments, results or result tokens.',obj({limit:integer})]
 ,['y_backup_list','List protected pre-write snapshots; contents and credentials are not included.',obj({limit:integer})]
 ,['y_backup_diff','Get path/hash differences and Git checkpoint status for a snapshot.',obj({id},['id'])]
 ,['y_backup_restore','Conflict-checked restore of a completed file snapshot; creates its own undo snapshot.',obj({id},['id'])]
 ,['y_backup_accept','Request marking a finished version as accepted. Requires verified owner approval; never deletes backups automatically.',obj({id},['id'])]
].map(([name,description,inputSchema])=>{
  // Tool annotations guide the host's UI. A restore edits user files, and
  // acceptance is a state transition even while trusted approval is absent.
  const mutates=['job_submit','job_cancel','download_file','run_trusted_workflow','y_dev_task','y_backup_restore','y_backup_accept'].includes(name);
  return {name,description,inputSchema,annotations:{readOnlyHint:!mutates,destructiveHint:mutates,openWorldHint:['job_submit','download_file','run_trusted_workflow','y_dev_task'].includes(name),idempotentHint:!['job_submit','download_file','run_trusted_workflow','y_dev_task','y_backup_restore','y_backup_accept'].includes(name)}};
});
// Cached ChatGPT catalogs still call this historical display-only name.
// It renders the NEW strip and cannot approve anything by itself.
const legacyReviewTool={name:'y_review_approval',title:'Approval',description:'Compatibility alias: show the compact YGPT approval strip for an existing pending operation. Does not approve or execute it.',inputSchema:obj({requestId:str},['requestId']),_meta:{ui:{resourceUri:LEGACY_BAR_URI},'openai/outputTemplate':LEGACY_BAR_URI},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}};
const hidden=new Set(['y_widget_credential','y_inline_decision','set_config_value','give_feedback_to_desktop_commander','get_recent_tool_calls','write_pdf']);
const ajv=new Ajv({strict:false,validateFormats:false});
let child,ready=false,closing=false,init=null,initialization=null,backendInitialization=null,seq=0,engineTools=[],portalServer,restarts=0;
const eagerStartup=config.rc10Candidate&&config.deployment==='production';
const startupInit={protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'YGPT Local startup self-test',version:config.version}};
const requests=new Map(),sessionScopes=new Map(),processIdentities=new Map();
const approvalWaiters=new Map();
const deliveredApprovals=new Set();
let nativeExtension;
function healthRecord(ready,extra={}){
  if(!config.rc10Candidate)return;
  const p=path.join(config.stateDir,'rc10-health.json');
  const value={version:config.version,product:'YGPT Local',pid:process.pid,childPid:child?.pid??null,ready,at:new Date().toISOString(),deployment:config.deployment,tools:nativeExtension?tools().length:0,...extra};
  const temp=p+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,p);
}
let backups;
let backupsReady;
const writeNames=new Set(['write_file','edit_block','move_file','create_directory']);
const fileLocks=new Map();
const jobSnapshots=new Map();
const modifiedPaths=(name,a)=>name==='move_file'?[a.source,a.destination]:[name==='edit_block'?a.file_path:a.path];
function jobSnapshotTargets(cwd,extra=[]){
  try{return planTerminalSnapshots(cwd,extra);}
  catch(error){error.effectStarted=false;error.code='BACKUP_PREPARATION_FAILED';throw error;}
}
// Bounded preflight coverage for an arbitrary project command. This captures
// project entry/config and source files, not all possible external effects.
// The exact covered paths are returned so recovery scope is never overstated.
function trackJobSnapshot(jobId,backupId){
  jobSnapshots.set(jobId,backupId);
  const timer=setInterval(async()=>{
    if(!jobSnapshots.has(jobId)){clearInterval(timer);return;}
    try{
      const status=await jobControl('status',{id:jobId});
      if(['queued','running'].includes(status.state))return;
      if(['succeeded','failed','cancelled'].includes(status.state))backups.finish(backupId,status.state==='succeeded');
      else backups.interrupt(backupId,'Durable job outcome could not be verified: '+status.state);
      jobSnapshots.delete(jobId);clearInterval(timer);
    }catch(e){ // retain the prepared sealed preimage for crash/interruption review
      if(process.env.YGPT_DEBUG_ENGINE==='1')process.stderr.write('Job snapshot finalization: '+e.message+'\n');
    }
  },1800);timer.unref();
}
async function ensureBackups(){
  if(!backupsReady){
    backupsReady=(async()=>{
      const manager=new BackupManager();
      manager.reconcileInterrupted();
      backups=manager;
      for(const pending of manager.pendingJobs()){
        try{
          const state=await jobControl('status',{id:pending.jobId});
          if(['queued','running'].includes(state.state))trackJobSnapshot(pending.jobId,pending.id);
          else if(['succeeded','failed','cancelled'].includes(state.state))manager.finish(pending.id,state.state==='succeeded');
          else manager.interrupt(pending.id,'Durable job outcome could not be verified: '+state.state);
        }catch(e){manager.interrupt(pending.id,'Durable job ledger was unavailable at recovery; completion unverified');}
      }
      return manager;
    })().catch(error=>{backups=undefined;backupsReady=undefined;throw error;});
  }
  return backupsReady;
}
function createVerifiedSnapshot(operation,targets){
  try{const saved=backups.create(operation,targets);backups.verify(saved.id);return saved;}
  catch(error){error.effectStarted=false;error.code='BACKUP_PREPARATION_FAILED';throw error;}
}
async function protectedJobSubmit(operation,cwd,jobId,submit,additionalTargets=[]){
  if(!config.rc9Candidate)return submit();
  if(!/^[0-9a-f-]{36}$/i.test(jobId))throw Error('Durable job requires a stable ID before launch');
  await ensureBackups();
  const files=jobSnapshotTargets(cwd,additionalTargets);
  if(!files.length)return {...await submit(),prewriteBackup:{coverage:'no eligible files in bounded scan',files:0}};
  const saved=createVerifiedSnapshot(operation,files);
  // Bind the exact job identity in the encrypted snapshot ledger BEFORE
  // launching it. A crash during submission is then recoverable as uncertain,
  // never silently finalized as an unassociated failed operation.
  backups.verify(saved.id);
  backups.attachJob(saved.id,jobId);
  try{
    const answer=await submit();
    if(answer.job_id!==jobId)throw Error('Durable job identity mismatch; inspect job ledger before retry');
    trackJobSnapshot(jobId,saved.id);
    return {...answer,prewriteBackup:{id:saved.id,files:files.length,coverage:'bounded project files only; external effects and generated files not guaranteed'}};
  }catch(e){
    try{backups.interrupt(saved.id,'Job submission failed or outcome uncertain; inspect durable ledger before retry');}catch{}
    throw e;
  }
}
// Serialize file mutation transactions for the same target; a check of the
// original hash is repeated immediately before the upstream engine call.
async function withFileLocks(paths,run){
  const keys=[...new Set(paths.map(canonical))].sort();
  const previous=keys.map(k=>fileLocks.get(k)).filter(Boolean);
  let release;const hold=new Promise(resolve=>{release=resolve;});
  for(const key of keys)fileLocks.set(key,hold);
  await Promise.all(previous);
  try{return await run();}finally{release();for(const key of keys)if(fileLocks.get(key)===hold)fileLocks.delete(key);}
}
const emit=o=>{if(o.result?._meta?.yBar&&wireContext.getStore()?.legacyApproval)o.result._meta.yBar={...o.result._meta.yBar,legacyBridge:true};if(o.result?._meta?.yBar)o={...o,result:{...o.result,_meta:{...o.result._meta,yukiBar:o.result._meta.yBar}}};if(o.result&&wireContext.getStore()?.version===CURRENT_PROTOCOL)o={...o,result:{resultType:'complete',...o.result}};process.stdout.write(JSON.stringify(o)+'\n');};
const failure=(id,message)=>emit({jsonrpc:'2.0',id,error:{code:-32001,message}});
const response=(id,value,isError=false)=>emit({jsonrpc:'2.0',id,result:{content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],isError}});
// Brand key local-file/terminal tools for ChatGPT discovery while retaining
// original names so older conversations continue to work without catalog refresh.
// YGPT is the only public MCP tool identity. Desktop Commander is an internal
// open-source engine dependency, credited in NOTICE/LICENSE, not a second app.
// The old unprefixed tool names continue to dispatch internally for cached chats.
const publicName=n=>n.startsWith('y_')?n:n.startsWith('job_')?'y_task_'+n.slice(4):'y_'+n;
const brandedTools=()=>engineTools.map(t=>({...t,name:'y_local_'+t.name,title:'YGPT Local · '+t.name.replace(/_/g,' '),description:("YGPT Local · Windows: "+String(t.description??'').replace(/This command can be referenced as[\s\S]*$/i,'').replace(/Desktop Commander/gi,'local engine').replace(/\s+/g,' ').trim()).slice(0,320)}));
const tools=()=>[...(nativeExtension?.tools()??[]),...(config.rc10Candidate?[{name:"y_desktop_fixture",title:"YGPT Local · Desktop fixture",description:"Launch an owner-enrolled harmless UIA fixture; no disk or unrelated application effects",inputSchema:obj(),annotations:{readOnlyHint:false,destructiveHint:false}}]:[]),...brandedTools(),...additions.filter(t=>!((noLocalReview&&!config.chatAppConsent&&t.name==='y_pending_approvals')||(noLocalReview&&t.name==='job_recover'))&&(config.rc9Candidate||!t.name.startsWith('y_backup_'))),...(!config.rc9Candidate&&uiEnabled()?[previewTool]:[]),...((!config.rc9Candidate||config.chatAppConsent)&&barEnabled()?[...(!config.rc10Candidate?[legacyReviewTool]:[]),...barTools]:[]),...(config.rc10Candidate?[approvalCenterTool,{...legacyReviewTool,description:'Render this approval immediately at the current action, then call y_wait_approval using the original resultToken so the task can continue after the user decides. Do not finish the conversation or append a long report while waiting. Include original contextToken.'}]:[])].map(t=>({...t,...(config.chatAppConsent&&t._meta?.ui?.resourceUri?{_meta:{...t._meta,ui:{...t._meta.ui,resourceUri:INSPECTION_URI},'openai/outputTemplate':INSPECTION_URI}}:{}),name:publicName(t.name),title:t.title??('YGPT Local · '+t.name),inputSchema:{...t.inputSchema,properties:{...t.inputSchema.properties,contextToken:{type:'string',description:'Private context token retained in THIS chat; never copy to another chat.'}}}}));
function engineRequest(method,params={},timeout=60000){
  if(!child||!child.stdin.writable||(!ready&&method!=='initialize'))return Promise.reject(Error('Engine unavailable; no operation replayed'));
  const id='__rc_'+(++seq);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(id);reject(Error('Engine deadline reached; reconcile effects before retrying'));},timeout);
    requests.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
}
function ensureEngine(params){
  if(!backendInitialization)backendInitialization=initializeEngine(params).catch(e=>{backendInitialization=null;throw e;});
  return backendInitialization;
}
async function initializeEngine(params=init){
  const info=await engineRequest('initialize',{...params,protocolVersion:SUPPORTED_PROTOCOL_VERSIONS.includes(params?.protocolVersion)?params.protocolVersion:LATEST_PROTOCOL_VERSION,capabilities:{}},15000);
  ready=true;child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=await engineRequest('tools/list');
  engineTools=listed.tools.filter(t=>!hidden.has(t.name)).map(t=>{
    const copy={...t};delete copy._meta;copy.inputSchema=structuredClone(t.inputSchema);
    if(t.name==='edit_block')copy.inputSchema=obj({file_path:str,old_string:{type:'string',minLength:1},new_string:str,expected_replacements:{type:'integer',minimum:1,maximum:100},origin:{type:'string',enum:['ui','llm']}},['file_path','old_string','new_string']);
    // YGPT supports an explicit project working directory even though the
    // pinned upstream start_process schema does not. Translate at our bridge.
    if(t.name==='start_process')copy.inputSchema.properties.cwd={type:'string',description:'Optional absolute working directory inside an enrolled project root'};
    if(['read_process_output','get_more_search_results','stop_search','interact_with_process','force_terminate','kill_process'].includes(t.name)){
      copy.inputSchema.properties.outputToken=str;copy.inputSchema.required=[...new Set([...(copy.inputSchema.required??[]),'outputToken'])];
    }
    const fix=s=>{if(!s||typeof s!=='object')return;for(const [k,v] of Object.entries(s)){if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0)s[k]=true;else fix(v);}};
    fix(copy.inputSchema);
    const mutate=['write_file','edit_block','move_file','create_directory','start_process','interact_with_process','force_terminate','kill_process'].includes(copy.name);
    copy.annotations={readOnlyHint:!mutate,destructiveHint:mutate,idempotentHint:!mutate,openWorldHint:['start_process','interact_with_process'].includes(copy.name)};
    copy.description=String(copy.description??'').replace(/\s+/g,' ').slice(0,260);
    return copy;
  });
  if(config.rc10Candidate&&!nativeExtension){await ensureBackups();nativeExtension=await createNativeExtension({backups,ledger,protectState:async()=>acl});}
  const names=tools().map(t=>t.name);if(new Set(names).size!==names.length)throw Error('Duplicate tool catalog entry');
  healthRecord(true,{initializationSource:init?'host-request':'startup-self-test',initializedByTunnel:Boolean(init)&&config.deployment==='production'});restarts=0;return info;
}
function runChild(){
  const active=spawn(process.execPath,[source],{cwd:config.projectRoots[0],env:cleanEnv(),stdio:['pipe','pipe','pipe'],windowsHide:true});child=active;
  readline.createInterface({input:active.stdout}).on('line',line=>{
    let msg;try{msg=JSON.parse(line);}catch{return;}
    if(!requests.has(msg.id))return;const r=requests.get(msg.id);requests.delete(msg.id);clearTimeout(r.timer);
    msg.error?r.reject(Error(msg.error.message)):r.resolve(msg.result);
  });
  // Upstream logs can contain tool arguments: only a bounded generic health signal is exposed.
  active.stderr.on('data',chunk=>{if(process.env.YGPT_DEBUG_ENGINE==='1')process.stderr.write('[engine diagnostic] '+String(chunk).slice(0,1500));});
  let failed=false;
  const onFailure=()=>{if(failed)return;failed=true;ready=false;backendInitialization=null;initialization=null;if(child===active)child=null;healthRecord(false,{reason:'upstream-disconnected'});
    for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('Engine disconnected; request not replayed'));}requests.clear();sessionScopes.clear();processIdentities.clear();
    if(!closing){const ms=Math.min(30000,1000*2**Math.min(restarts++,5));setTimeout(async()=>{if(closing)return;runChild();if(init||eagerStartup){try{await ensureEngine(init??startupInit);if(init)emit({jsonrpc:'2.0',method:'notifications/tools/list_changed'});}catch{child?.kill();}}},ms).unref();}
  };active.once('exit',onFailure);active.once('error',onFailure);
}
function textOf(r){return (r.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
async function jobControl(action,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(config.python,[...config.pythonArgs,path.join(RUNTIME,'y_jobs.py')],{cwd:config.stateDir,env:cleanEnv({YGPT_INGRESS_ID:config.ingressId,YGPT_PROJECT_ROOTS:JSON.stringify(config.projectRoots)}),windowsHide:true,stdio:['pipe','pipe','ignore']});
    let data='';const timer=setTimeout(()=>{p.kill();reject(Error('Job control deadline; query status by operation ID'));},12000);
    p.stdout.on('data',b=>{data+=b;if(Buffer.byteLength(data)>262144){p.kill();reject(Error('Job response too large'));}});
    p.once('error',e=>{clearTimeout(timer);reject(e);});
    p.once('exit',code=>{clearTimeout(timer);try{const r=JSON.parse(data);code===0?resolve(r):reject(Error(r.error??'Job control failure'));}catch{reject(Error('Invalid job response'));}});
    p.stdin.end(JSON.stringify({action,...args}));
  });
}
async function dispatch(name,args,operationId,reviewed=false){
  if(name==='y_sqlite_read'){canonical(args.path);const value=sqliteRead(args);return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
  if(name==='y_desktop_fixture'&&nativeExtension){const result=await nativeExtension.launchFixture();return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
  if(nativeExtension?.tools().some(t=>t.name===name)){
    const {requestKey,...engineArgs}=args;
    let saved;
    if(['y_process_run','y_process_start','y_job_submit'].includes(name)){
      const targets=jobSnapshotTargets(args.cwd??projectRoots[0]);
      if(targets.length){saved=createVerifiedSnapshot(name,targets);if(name==='y_job_submit')backups.attachJob(saved.id,args.id);}
    }
    const r=await (reviewed?nativeExtension.invokeApproved(name,engineArgs):nativeExtension.engine.invoke(name,engineArgs));
    if(r.ok&&['y_process_run','y_process_start','y_job_submit'].includes(name)){
      const kind=name==='y_job_submit'?'job':'session',id=kind==='job'?r.result.job_id:r.result.sessionId;
      if(id&&!(kind==='job'&&r.result.reused))r.result.outputToken=ledger.grant(kind,id);
    }
    if(saved){
      if(name==='y_job_submit'&&r.ok)trackJobSnapshot(args.id,saved.id);
      else if(name==='y_process_start'&&r.ok){
        const session=r.result.sessionId;
        const timer=setInterval(async()=>{try{const status=await nativeExtension.engine.terminal.poll(session);if(status.state!=='running'){clearInterval(timer);backups.finish(saved.id,status.state==='succeeded');}}catch{clearInterval(timer);backups.interrupt(saved.id,'Interactive process outcome uncertain');}},1000);timer.unref();
      }else backups.finish(saved.id,r.ok&&!r.error?.outcomeUnknown);
      r.prewriteBackup={id:saved.id,coverage:'bounded project files; protected, linked, new and external files are excluded'};
    }
    const value={...r,production:config.deployment==='production',version:config.version};
    const content=[{type:'text',text:JSON.stringify(value)}];
    const artifact=r.result;
    if(r.ok&&artifact?.mimeType==='image/png'&&artifact.path){const b=fs.readFileSync(artifact.path);if(b.length<=4*1024*1024)content.push({type:'image',mimeType:'image/png',data:b.toString('base64')});}
    return {content,isError:!r.ok,structuredContent:value};
  }
  if(config.rc9Candidate&&name.startsWith('y_backup_')){
    await ensureBackups();
    const result=name==='y_backup_list'?{snapshots:backups.list(args.limit)}:
      name==='y_backup_diff'?backups.diff(args.id):
      name==='y_backup_restore'?backups.restore(args.id,{reviewed}):
      (()=>{throw Error('Backup acceptance requires verified human approval; no backup data deleted');})();
    return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
  }
  if(name==='y_dev_task'){
    const task=planDevTask(args);
    const id=operationId??randomUUID();
    const result=await protectedJobSubmit('developer-task',task.cwd,id,()=>jobControl('submit',{id,cwd:task.cwd,argv:task.argv,timeoutSeconds:task.timeoutSeconds}));
    result.outputToken=ledger.grant('job',result.job_id);
    return {structuredContent:result,content:[{type:'text',text:JSON.stringify({job_id:result.job_id,state:result.state,task:task.task,outputToken:result.outputToken})}]};
  }
  if(name==='job_recover'){const r=await jobControl('status',{id:args.id});const token=ledger.grant('job',args.id);const value={job_id:args.id,state:r.state,outputToken:token,replayed:false};return {structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};}
  if(name==='verify_checksum'){const r=await checksum(args.path,args.sha256);return {content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r};}
  if(name==='disk_inspect'){const r=(await diskInspect()).map(d=>({...d,fingerprint:deviceFingerprint(d)}));return {content:[{type:'text',text:JSON.stringify(r)}]};}
  if(name==='download_file'){
    validateSource(args.url);validateDestination(args.destination);fs.mkdirSync(path.dirname(args.destination),{recursive:true});
    const jobId=operationId??randomUUID();const descriptor=path.join(config.stateDir,'jobs','download-'+jobId+'.dpapi');
    fs.writeFileSync(descriptor,protectForWindows(JSON.stringify(args)));
    const r=await protectedJobSubmit('download',path.dirname(args.destination),jobId,()=>jobControl('submit',{id:jobId,cwd:path.dirname(args.destination),argv:[process.execPath,path.join(RUNTIME,'download-worker.mjs'),descriptor],timeoutSeconds:86400}),[args.destination]);r.outputToken=ledger.grant('job',r.job_id);
    return {content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r};
  }
  if(name==='inspect_download_status'){
    if(!/^[\da-f-]{36}$/.test(args.id))throw Error('Invalid download ID');
    const filename=path.join(config.stateDir,'jobs','download-'+args.id+'.dpapi.status.json');
    const r={...(fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{bytes:0}),job:await jobControl('status',{id:args.id})};return {content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r};
  }
  if(name==='run_trusted_workflow')name='job_submit';
  if(name.startsWith('job_')){
    const {outputToken,...jobArgs}=args;
    const jobId=operationId??randomUUID();
    const r=name==='job_submit'?await protectedJobSubmit('job',args.cwd,jobId,()=>jobControl('submit',{...jobArgs,id:jobId})):
      await jobControl(name.slice(4),jobArgs);
    if(name==='job_submit')r.outputToken=ledger.grant('job',r.job_id);
    return {content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r};
  }
  if(name==='start_process'){
    const access=authorize(name,args);
    if(access.exec){
      let text;
      if(access.exec.local)text=access.exec.local==='date'?new Date().toISOString():access.exec.local==='disks'?JSON.stringify(await diskInspect()):access.cwd;
      else text=await new Promise((resolve,reject)=>{const p=spawn(access.exec.exe,access.exec.argv,{cwd:access.cwd,env:cleanEnv(),windowsHide:true,stdio:['ignore','pipe','ignore']});let out='';p.stdout.on('data',b=>{out+=b;if(out.length>65536)p.kill();});p.once('error',reject);p.once('exit',c=>c===0?resolve(out.trim()):reject(Error('Introspection failed')));});
      return {content:[{type:'text',text}],isError:false};
    }
  }
  const {outputToken,...engineArgs}=args;
  if(name==='start_process'&&(args.cwd||config.rc9Candidate)){
    // The upstream terminal has no cwd argument. Pin PowerShell and use its
    // literal-path command rather than leaking an unsupported property to it.
    // Validate against the exact directory that the policy already approved.
    // The RC9 policy evaluates a missing cwd against the enrolled project
    // root. Execute in that SAME directory; otherwise the unscoped upstream
    // process would inherit the bridge's (possibly private) service directory.
    const resolved=canonical(args.cwd??projectRoots[0]);
    if(!config.blacklistDefaultAllow&&!projectRoots.some(root=>resolved===root||resolved.startsWith(root+'\\')))throw Error('Terminal cwd is not an enrolled project');
    if(!fs.statSync(resolved).isDirectory())throw Error('Terminal cwd is not a directory');
    if(args.shell&&!/^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test(path.win32.basename(args.shell)))throw Error('Explicit cwd requires a PowerShell shell');
    engineArgs.command=`Set-Location -LiteralPath '${resolved.replaceAll("'","''")}'; ${args.command}`;
    engineArgs.shell=args.shell??'powershell.exe';
    delete engineArgs.cwd;
  }
  if(name==='start_search'){engineArgs.literalSearch=true;engineArgs.includeHidden=false;}
  let r;
  // RC9 pre-write transactions are opt-in. Keep the RC8 tool execution path
  // byte-for-byte compatible while this candidate remains unaccepted.
  if(config.rc9Candidate&&writeNames.has(name)){
    r=await withFileLocks(modifiedPaths(name,args),async()=>{
      await ensureBackups();
      const saved=backups.create(name,modifiedPaths(name,args));
      try{
        backups.verify(saved.id);
        const answer=await engineRequest('tools/call',{name,arguments:engineArgs});
        const complete=backups.finish(saved.id,!answer.isError);
        return {...answer,structuredContent:{...(answer.structuredContent??{}),backup:complete},content:[...(answer.content??[]),{type:'text',text:JSON.stringify({yPrewriteBackup:complete.id,backupStatus:complete.status})}]};
      }catch(e){try{backups.finish(saved.id,false);}catch{}throw e;}
    });
  }else if(config.rc10Candidate&&name==='start_process'){
    await ensureBackups();const targets=jobSnapshotTargets(args.cwd??projectRoots[0]);
    const saved=targets.length?createVerifiedSnapshot('legacy-terminal',targets):null;
    if(saved)backups.verify(saved.id);
    try{
      r=await engineRequest('tools/call',{name,arguments:engineArgs});
      if(saved){
        if(r.isError||r.structuredContent?.status==='finished')backups.finish(saved.id,!r.isError);
        else backups.interrupt(saved.id,'Legacy interactive shell still running; result and generated/external effects require reconciliation');
        r.structuredContent={...(r.structuredContent??{}),prewriteBackup:{id:saved.id,coverage:'bounded project files only; running legacy process requires reconciliation'}};
      }
    }catch(e){if(saved)try{backups.interrupt(saved.id,'Legacy terminal outcome unknown')}catch{}throw e;}
  }else r=await engineRequest('tools/call',{name,arguments:engineArgs});
  if(name==='get_config')return {content:[{type:'text',text:JSON.stringify({service:'YGPT Local',engine:'YGPT Files & Terminal',upstreamDependency:'Desktop Commander 0.3.0',configManagedLocally:true})}]};
  const text=textOf(r);
  if(!r.isError&&['start_process','start_search'].includes(name)){
    const sid=name==='start_search'?(r.structuredContent?.sessionId??text.match(/\bsearch_\d+_[\w-]+\b/)?.[0]??text.match(/(?:Session ID|sessionId|searchId)[:=]\s*["']?([\w-]+)/i)?.[1]):(r.structuredContent?.pid??text.match(/(?:PID|pid)[:=]?\s*(\d+)/i)?.[1]);
    if(sid){const token=ledger.grant('session',String(sid));sessionScopes.set(String(sid),true);r.structuredContent={...(r.structuredContent??{}),outputToken:token,sessionId:String(sid)};r.content=[...(r.content??[]),{type:'text',text:JSON.stringify({sessionId:String(sid),outputToken:token,nextTool:name==='start_search'?'y_local_get_more_search_results':'y_local_read_process_output'})}];
      if(name==='start_process')processIdentities.set(sid,(await jobControl('identity',{pid:Number(sid)})).identity);
    }
  }
  return r;
}
async function execute(id,name,args){
  const scope=scopeFor(name,args);
  const access=nativeExtension?.tools().some(t=>t.name===name)?await nativeExtension.authorize(name,args):authorize(name,args,scope);if(access.decision==='deny')throw Error('Policy changed; operation not executed');
  if(!ledger.claim(id,name,args))throw Error('Operation was already claimed, expired or handled');
  const callId=ledger.callStart(name,id);
  try{
    const operation=ledger.get(id),approvedScope=operation?.chatScope;
    if(approvedScope?.eligible&&(config.chatAppConsent?reviewScope(name,args):chatScope(name,args)).key!==approvedScope.key){ledger.finish(id,'failed',null,'Reviewed executable/script changed; no operation executed');ledger.callFinish(callId,'failed');return {isError:true,content:[{type:'text',text:'Reviewed file changed after consent. No operation executed.'}]};}
    if(operation?.executionBinding&&digest(stable(nativeExtension.binding(name,args)))!==operation.executionBinding)throw Object.assign(Error('Reviewed target or executable changed; request a new review'),{effectStarted:false,code:'EXECUTION_TARGET_CHANGED'});
    if(['interact_with_process','force_terminate','kill_process'].includes(name)){
      const pid=String(args.pid);const current=(await jobControl('identity',{pid:Number(pid)})).identity;
      if(!processIdentities.get(pid)||current!==processIdentities.get(pid))throw Error('Process identity changed; no signal sent');
    }
    const r=await dispatch(name,args,id,true);const state=r.isError?'failed':'succeeded';
    ledger.finish(id,state,r,null,r.structuredContent?.job_id??null);ledger.callFinish(callId,state,r);return r;
  }catch(e){const beforeEffect=e.effectStarted===false,state=beforeEffect?'failed':'unknown';ledger.finish(id,state,null,e.message,name==='job_submit'?id:null);ledger.callFinish(callId,state);return {isError:true,structuredContent:{state,executed:beforeEffect?false:null,code:e.code??'EXECUTION_UNCERTAIN'},content:[{type:'text',text:(beforeEffect?'NOT_EXECUTED: ':'UNKNOWN: ')+e.message+'; inspect status/effects before retrying.'}]};}
}
function scopeFor(name,a){const sid=String(a.pid??a.sessionId??'');return {ownsJob:ledger.owns('job',a.id,a.outputToken),ownsSession:sessionScopes.has(sid)&&ledger.owns('session',sid,a.outputToken)};}
async function handle(msg){
  if(msg.jsonrpc!=='2.0')throw Error('JSON-RPC 2.0 required');
  const id=msg.id;
  const host=requestHost(msg,init);
  if(msg.method==='initialize'){
    // The authenticated Tunnel may initialize a new ChatGPT chat on its existing
    // stdio ingress. Reuse the MCP engine/handshake without starting a second
    // worker or clearing the ongoing operation ledger.
    if(!initialization){
      init=msg.params;
      initialization=ensureEngine(init).then(r=>({protocolVersion:r.protocolVersion,serverInfo:{name:'YGPT Local',version:config.version},capabilities:{tools:{listChanged:true},...(config.rc10Candidate||!config.rc9Candidate&&uiEnabled()?{resources:{}}:{})},instructions:'For authorized local Windows file, directory, edit, search or build requests, call YGPT Local typed tools first. Never claim completion without results. Prefer y_file_read/y_file_edit/y_sqlite_read, retain expectedSha256 and read back changes. For general knowledge do not probe the PC. Public tools use y_. This is a PRIVATE single-owner Windows connector. All typed read-only file/directory/search/database operations are automatically allowed under the owner read policy. Use y_sqlite_read for local SQLite queries and read tools for protected directories; do not open approval cards for reading. Mutating destructive/system/security risks require review and return an operation ID and resultToken. '+(config.chatAppConsent?'For REVIEW_REQUIRED, show y_review_approval immediately with requestId and original contextToken, then y_wait_approval with the original resultToken to receive the result while continuing this task. Do not end the response merely because approval is pending, and do not bury the strip above a long report. When native host elicitation is available, it pauses and resumes the original tool directly. Only a user in the isolated app can decide. The app sends a follow-up to this conversation after a decision; query y_call_status and y_call_result with the retained resultToken, never replay an already approved action. Retain scoped outputToken on every continuation.':config.rc9Candidate?'High-risk operations are suspended until a verified ChatGPT host consent channel exists. No local popups, in-chat fake buttons, or model-approved execution.':config.localApprovalDisabled?'Local human-approval dialogs and queues are disabled. Trusted developer operations execute automatically; protected actions are rejected.':barEnabled()?'Use the compact strip for local review.':'Use the local Windows panel.')+ ' No retired large card or model-callable approval tools. Native host forms use protocol input-required responses only when both host form capabilities are advertised. Preserve resultToken/outputToken for scoped retrieval; do not display tokens in summaries. A generation may end while approval is pending. Query y_call_status then y_call_result to continue; do not replay unknown effects.'}));
    }
    try{emit({jsonrpc:'2.0',id,result:{...await initialization,protocolVersion:msg.params?.protocolVersion===CURRENT_PROTOCOL?CURRENT_PROTOCOL:SUPPORTED_PROTOCOL_VERSIONS.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:LATEST_PROTOCOL_VERSION}});healthRecord(true,{initializationSource:'host-request',initializedByTunnel:config.deployment==='production',hostProtocol:msg.params?.protocolVersion,hostCoreForm:!!msg.params?.capabilities?.elicitation?.form,hostOpenAIForm:!!msg.params?.capabilities?.extensions?.['openai/elicitation']?.form});}
    catch(e){initialization=null;init=null;throw e;}
    return;
  }
  // Initialization is not a catalog change. Emitting list_changed here can
  // invalidate the host's just-created connection while it is loading tools.
  if(msg.method?.startsWith('notifications/')){if(msg.method==='notifications/initialized')await initialization;return;}
  if(initialization)await initialization;
  if(host.version===CURRENT_PROTOCOL){await ensureEngine(startupInit);healthRecord(true,{initializationSource:'per-request-metadata',initializedByTunnel:config.deployment==='production',hostProtocol:host.version,hostCoreForm:!!host.capabilities.elicitation?.form,hostOpenAIForm:!!host.capabilities.extensions?.['openai/elicitation']?.form});}
  else if(!init)throw Error('Initialize required');
  if(msg.method==='ping')return emit({jsonrpc:'2.0',id,result:{}});
  if(msg.method==='tools/list')return emit({jsonrpc:'2.0',id,result:{tools:tools()}});
  if(['resources/list','resources/templates/list'].includes(msg.method))return emit({jsonrpc:'2.0',id,result:msg.method==='resources/list'?{resources:approvalResourceUris().map(uri=>({uri,name:'YGPT compact approval strip',mimeType:'text/html;profile=mcp-app'}))}:{resourceTemplates:[]}});
  if(msg.method==='resources/read'&&approvalResourceUris().includes(msg.params?.uri))return emit({jsonrpc:'2.0',id,result:{contents:[barResource(msg.params.uri)]}});
  if(msg.method!=='tools/call')throw Error('Unsupported method; no legacy in-chat resources');
  const requestedName=canonicalToolName(msg.params?.name),rawArgs=msg.params?.arguments??{};
  const nativeCall=config.rc10Candidate&&(nativeExtension?.tools().some(t=>t.name===requestedName)||requestedName==='y_desktop_fixture');
  // The 1.0.1 YGPT plugin advertised y_local_* names. Keep them callable,
  // including ones omitted from the condensed new alias catalog.
  const name=nativeCall?requestedName:typeof requestedName==='string'&&requestedName.startsWith('y_local_')?requestedName.slice('y_local_'.length):typeof requestedName==='string'&&requestedName.startsWith('y_task_')?'job_'+requestedName.slice(7):typeof requestedName==='string'&&additions.some(t=>t.name===requestedName.slice(2))?requestedName.slice(2):requestedName;
  const {contextToken,...args}=rawArgs;
  // Legacy display alias works only in chat-strip mode. The isolated local
  // consent panel keeps its previous rejection semantics and has no UI bridge.
  if(name==='y_review_approval'&&!config.rc10Candidate&&(config.rc9Candidate||!barEnabled()))return response(id,'Legacy in-chat card unavailable in RC9',true);
  if(hidden.has(name))return response(id,'Legacy card/config endpoint removed; use the local Windows panel',true);
  // Legacy names are routed through the YGPT-branded validated schema without advertising duplicates.
  const descriptor=tools().find(t=>t.name===requestedName)??tools().find(t=>t.name==='y_local_'+name)??tools().find(t=>t.name===publicName(name));
  if(!descriptor||!ajv.validate(descriptor.inputSchema,rawArgs))throw Error('Invalid tool arguments: '+(ajv.errors?.[0]?.message??requestedName));
  const resumed=await resumeNativeConsent(msg,name,args,host,ledger,execute);
  if(resumed)return emit({jsonrpc:'2.0',id,result:resumed});
  if(config.rc10Candidate&&(name==='y_approval_center'||name==='y_review_approval'))return emit({jsonrpc:'2.0',id,result:config.chatAppConsent?chatApprovalResult(ledger,{...args,contextToken}):approvalCenterResult(ledger.get(args.requestId),args.requestId)});
  if(barEnabled()&&(name==='y_review_approval'||barTools.some(t=>t.name===name)))return emit({jsonrpc:'2.0',id,result:handleBar(name,{...args,contextToken},ledger,execute,requestId=>approvalWaiters.has(requestId)||deliveredApprovals.has(requestId))});
  if(name==='y_close_context'){ledger.closeContext(contextToken);return response(id,{closed:true});}
  if(name==='y_wait_approval'){
    if(!ledger.canRead(args.requestId,args.resultToken))throw Error('Original resultToken required');
    const deadline=Date.now()+(args.waitMs??25000);let operation;
    approvalWaiters.set(args.requestId,(approvalWaiters.get(args.requestId)??0)+1);
    try{do{operation=ledger.get(args.requestId);if(!operation||!['awaiting_user','approved','running'].includes(operation.state))break;await new Promise(resolve=>setTimeout(resolve,250));}while(Date.now()<deadline);}
    finally{const remaining=approvalWaiters.get(args.requestId)-1;if(remaining)approvalWaiters.set(args.requestId,remaining);else approvalWaiters.delete(args.requestId);}
    if(operation&&!['awaiting_user','approved','running'].includes(operation.state)){if(deliveredApprovals.size>=2048)deliveredApprovals.clear();deliveredApprovals.add(args.requestId);}
    return response(id,{requestId:args.requestId,state:operation?.state??'not_found',result:['succeeded','failed','unknown'].includes(operation?.state)?ledger.result(args.requestId):null,continueWaiting:['awaiting_user','approved','running'].includes(operation?.state),message:'Use this existing result. Never repeat the original action.'});
  }
  if(name==='y_preview_approval_ui'&&uiEnabled())return emit({jsonrpc:'2.0',id,result:previewResult()});
  if(name==='y_ping')return response(id,{version:config.version,policyVersion:config.rc10Candidate?10:config.rc9Candidate?9:8,modules:config.rc10Candidate?['file','terminal','search','browser','desktop','system']:['legacy'],rc10Candidate:config.rc10Candidate,rc9Candidate:config.rc9Candidate,engineReady:ready,approvalReady:config.chatAppConsent&&barEnabled()||!noLocalReview&&portal()!=='unavailable',approvalInterface:config.chatAppConsent?'mcp-app-capability':config.rc9Candidate?'unverified-host-suspended':config.localApprovalDisabled?'disabled':barEnabled()?'inline-strip':'local-wpf',localApprovalDisabled:noLocalReview,inlineDecisionsEnabled:barEnabled()&&config.allowInlineDecisions,inChatUI:barEnabled(),nativeElicitation:false,
    // Advertised capabilities are diagnostic only: even form elicitation does
    // not attest that a specific human clicked Allow. Never auto-authorize on
    // this field or on clientInfo/model-supplied MCP request metadata.
    hostElicitationAdvertised:!!(init?.capabilities?.elicitation?.form||init?.capabilities?.elicitation?.url),
    hostApprovalClickVerified:false,approvalSecurity:config.chatAppConsent?'app-only tools + hidden metadata capability + exact request + TTL; physical human identity is not attested':'disabled',
    pid:process.pid,childPid:child?.pid,tunnelReadiness:config.deployment==='production'?'existing-production-ingress; probe watchdog for tunnel health':'isolated; no tunnel created',quota:'none',singleOwner:true,aclProtected:acl.protected});
  if(name==='y_policy')return response(id,{projectRoots,systemRoots,mode:currentPermissionMode(),defaultAllow:config.blacklistDefaultAllow,readOnlyAutoAllow:config.readOnlyAutoAllow,reviewSignals:['bulk deletion','system modification','disk/boot/security changes','credentials/protected connector state'],scope:'private single-owner; output tokens are per operation/job',noOsSandbox:true});
  if(name==='y_permission_mode')return response(id,{...profileSummary(currentPermissionMode()),autoDevTasks:config.autoDevTasks,trustedDeveloperRoots:config.trustedDeveloperRoots});
  if(name==='y_workstation_health'){const d=await statfs(path.parse(config.stateDir).root);return response(id,{cpuThreads:os.cpus().length,totalMemory:os.totalmem(),freeMemory:os.freemem(),freeDisk:d.bavail*d.bsize});}
  if(name==='y_service_health')return response(id,{version:config.version,engineReady:ready,pid:process.pid,enginePid:child?.pid,tools:tools().length,approvalReady:barEnabled(),localPopups:false,readOnly:true});
  if(name==='y_pending_approvals')return response(id,{operations:ledger.pending().filter(o=>o.state==='awaiting_user').map(r=>({id:r.id,state:r.state,title:r.presentation?.title,expiresAt:r.expiresAt}))});
  if(name==='recent_calls')return response(id,{calls:ledger.calls(args.limit)});
  if(name==='call_status'||name==='call_result'){
    const op=ledger.get(args.id),call=ledger.call(args.id);
    if(name==='call_status')return response(id,op?{id:op.id,tool:op.tool,state:op.state,reason:op.reason,resultRef:op.resultRef,expiresAt:op.expiresAt,updatedAt:op.updatedAt}:call??{found:false});
    const ok=op?ledger.canRead(args.id,args.resultToken):ledger.owns('call',args.id,args.resultToken);
    if(!ok)return response(id,'Result token missing or not scoped to this request',true);
    return response(id,op?{state:op.state,result:ledger.result(args.id)}:ledger.call(args.id,true));
  }
  const scope=scopeFor(name,args);
  if(['interact_with_process','force_terminate','kill_process'].includes(name)&&!scope.ownsSession)return response(id,'Foreign/stale process ID or missing outputToken; no process control allowed',true);
  let access=nativeCall?(name==='y_desktop_fixture'?{decision:'allow'}:await nativeExtension.authorize(name,args)):authorize(name,args,scope);
  if(config.blacklistDefaultAllow&&name==='y_backup_restore'){
    await ensureBackups();
    for(const file of backups.manifest(args.id).files){
      const targetAccess=authorize('write_file',{path:file.path});
      if(targetAccess.decision==='deny'){access=targetAccess;break;}
      if(targetAccess.decision==='approve')access=targetAccess;
    }
  }
  if(access.decision==='deny')return response(id,'YGPT POLICY BLOCKED: '+access.reason,true);
  if(access.decision==='approve'&&config.chatAppConsent){
    const context=ledger.context(contextToken),grantScope=reviewScope(name,args);
    if(grantScope.eligible&&ledger.hasChatGrant(context.hash,grantScope.key))access={...access,decision:'allow',chatGrant:true};
    else{
      const binding=nativeCall?nativeExtension.binding(name,args):null;
      const hold=ledger.create(name,args,{...access,presentation:describeEnglish(name,args),chatScope:grantScope,contextHash:context.hash,executionBinding:binding?digest(stable(binding)):null},{idempotencyKey:msg.params?._meta?.['ygpt/idempotency-key']??null});
      if(nativeConsentSupported(host)&&hold.operation.state==='awaiting_user')return emit({jsonrpc:'2.0',id,result:nativeConsentRequest(ledger,hold.operation,name,args,host,{resultToken:hold.receipt,contextToken:context.token})});
      const value={state:'suspended',needsApproval:hold.operation.state==='awaiting_user',requestId:hold.operation.id,...(hold.receipt?{resultToken:hold.receipt}:{}),...(context.token?{contextToken:context.token}:{}),chatScopeAvailable:grantScope.eligible,expiresAt:hold.operation.expiresAt,message:'REVIEW_REQUIRED: render y_review_approval immediately with requestId and original contextToken, then call y_wait_approval with original resultToken. Keep this task in progress; do not append a long report or replay the original action. User clicks notify this conversation; check call_status/call_result and continue without replaying the action. Never invoke UI decision tools from the model.'};
      return response(id,value);
    }
  }
  if(access.decision==='approve'){
    if(noLocalReview){
      if(config.rc9Candidate){
        const hold=ledger.create(name,args,{...access,presentation:describeOperation(name,args)},{idempotencyKey:msg.params?._meta?.['ygpt/idempotency-key']??null});
        return response(id,{state:'suspended',requestId:hold.operation.id,reason:'REVIEW_REQUIRED: trusted ChatGPT click channel is not yet verified; no execution or Windows popup',expiresAt:hold.operation.expiresAt});
      }
      return response(id,'Local human approvals removed; this action is not approved by the automatic rules',true);
    }
    const context=ledger.context(contextToken),scope=chatScope(name,args);
    if(scope.eligible&&ledger.hasChatGrant(context.hash,scope.key))access={...access,decision:'allow',chatGrant:true};
    else {
      const gate=lookup(name,args,{...access,chatScope:scope,contextHash:context.hash},{idempotencyKey:msg.params?._meta?.['ygpt/idempotency-key']??null});
      const op=gate.operation;
      return emit({jsonrpc:'2.0',id,result:{structuredContent:{needsApproval:op.state==='awaiting_user',requestId:op.id,state:op.state,...(gate.receipt?{resultToken:gate.receipt}:{}),...(context.token?{contextToken:context.token}:{}),chatScopeAvailable:scope.eligible},content:[{type:'text',text:(barEnabled()?'Show y_show_approval with requestId and original resultToken for the compact IN-CHAT strip.':'Local Windows consent required.')+' No execution before approval. Keep contextToken PRIVATE in this chat and include it on later calls to use only human-approved narrow scopes. It is a server-issued capability, not an authenticated OpenAI session ID. Query call_status and call_result with resultToken after the human decides. Never replay unknown effects.'}]}});
    }
  }
  const idem=msg.params?._meta?.['ygpt/idempotency-key']??(nativeCall?args.requestKey:undefined);
  if(idem&&(nativeCall||['job_submit','download_file','run_trusted_workflow'].includes(name))){
    const gate=ledger.create(name,args,{...access,presentation:describeOperation(name,args)},{idempotencyKey:idem});
    if(gate.reused)return response(id,{id:gate.operation.id,state:gate.operation.state,resultRef:gate.operation.resultRef,replayed:false});
    if(!ledger.autoClaim(gate.operation.id))throw Error('Automatic job was already claimed');
    try{const r=await dispatch(name,args,gate.operation.id,access.chatGrant===true);ledger.finish(gate.operation.id,r.structuredContent?.error?.outcomeUnknown?'unknown':r.isError?'failed':'succeeded',r,null,r.structuredContent?.job_id??null);return emit({jsonrpc:'2.0',id,result:{...r,structuredContent:{...(r.structuredContent??{}),ygpt:{requestId:gate.operation.id,resultToken:gate.receipt,policyAutomatic:true}}}});}
    catch(e){const beforeEffect=e.effectStarted===false,state=beforeEffect?'failed':'unknown';ledger.finish(gate.operation.id,state,null,e.message,gate.operation.id);return response(id,{id:gate.operation.id,state,executed:beforeEffect?false:null,code:e.code??'EXECUTION_UNCERTAIN',...(e.filesRestored!==undefined?{filesRestored:e.filesRestored,noFilesRestored:e.filesRestored===0}:{}),resultRef:gate.operation.id,message:beforeEffect?'Preflight failed before execution; inspect the error before creating a new request':'Query existing task; do not replay'},true);}
  }
  const callId=ledger.callStart(name);const token=ledger.grant('call',callId);
  try{const r=await dispatch(name,args,callId,access.chatGrant===true);ledger.callFinish(callId,r.structuredContent?.error?.outcomeUnknown?'unknown':r.isError?'failed':'succeeded',r);emit({jsonrpc:'2.0',id,result:{...r,structuredContent:{...(r.structuredContent??{}),ygpt:{callId,resultToken:token}}}});}
  catch(e){const beforeEffect=e.effectStarted===false,state=beforeEffect?'failed':'unknown';ledger.callFinish(callId,state);response(id,{callId,state,executed:beforeEffect?false:null,code:e.code??'EXECUTION_UNCERTAIN',...(e.filesRestored!==undefined?{filesRestored:e.filesRestored,noFilesRestored:e.filesRestored===0}:{}),message:e.message},true);}
}
async function shutdown(){if(closing)return;closing=true;await nativeExtension?.engine.close();child?.kill();closePanel();portalServer?.close();releaseLease();setTimeout(()=>process.exit(0),150).unref();}
process.once('exit',()=>{try{releaseLease();}catch{}});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
if(!noLocalReview)portalServer=await launchPortal(execute);
runChild();
// The Tunnel opens stdio eagerly but may not send initialize until a chat calls.
// Check only our private engine/catalog at boot; public requests still require
// their own initialize, and this is never recorded as a ChatGPT host handshake.
if(eagerStartup)ensureEngine(startupInit).catch(e=>{process.stderr.write('YGPT startup self-test failed: '+scrub(e.message)+'\n');child?.kill();});
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{let msg;try{if(Buffer.byteLength(line)>131072)throw Error('Request too large');msg=JSON.parse(line);}catch{failure(null,'Malformed/oversized JSON-RPC');return;}
  wireContext.run({version:msg.params?._meta?.['io.modelcontextprotocol/protocolVersion'],legacyApproval:typeof msg.params?.name==='string'&&msg.params.name.startsWith('yuki_')},()=>handle(msg).catch(e=>failure(msg.id??null,e.message)));});
input.once('close',shutdown);
