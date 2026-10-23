import {spawn} from 'node:child_process';
import {recordStartupFailure,clearStartupFailure} from './startup-diagnostics.mjs';
import readline from 'node:readline';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import Ajv from 'ajv';
import {SUPPORTED_PROTOCOL_VERSIONS,LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/sdk/types.js';
import {config,RUNTIME,cleanEnv,currentPermissionMode} from './config.mjs';
import {authorize,canonical,projectRoots,systemRoots,developerTasks,planDevTask} from './access-policy.mjs';
// RC9 never loads the Windows WPF/local approval implementation. Review-needed
// operations are suspended until a trusted ChatGPT host event is verified.
const noLocalReview=config.rc9Candidate||config.localApprovalDisabled;
const {launchPortal,lookup,pending,portal,ledger,acl,releaseLease,closePanel}=await import(noLocalReview?'./owner-state.mjs':'./approvals.mjs');
import {protectForWindows} from './secure-state.mjs';
import {scrub} from './durable.mjs';
import {validateSource,validateDestination,checksum} from './safe-actions.mjs';
import {describeOperation} from './operation-description.mjs';
import {chatScope} from './chat-scope.mjs';
import {profileSummary} from './permission-profiles.mjs';
import {BackupManager,trashPlan} from './backup-manager.mjs';
import {jobSnapshotTargets as planTerminalSnapshots} from './terminal-snapshots.mjs';
import {createNativeExtension} from './native-extension.mjs';
import {barTools,barEnabled,uiEnabled,barResource,approvalResourceUris,INSPECTION_URI,approvalCenterTool,approvalCenterResult,chatApprovalResult,handleBar,previewTool,previewResult} from './inline-approval.mjs';
import {describeEnglish,reviewScope} from './chat-review.mjs';
import {stable,digest,contextLabel} from './durable.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {CURRENT_PROTOCOL,requestHost,nativeConsentSupported,nativeConsentRequest,resumeNativeConsent} from './host-consent.mjs';
import {sqliteRead} from './sqlite-read.mjs';
import {retiredTool} from './retired-tools.mjs';
import {firstUseRecorder} from '../service/first-use.mjs';
import {startOwnerControl} from './owner-control.mjs';
import {callScope,resourceIntent,ownershipViolation,createdId} from './ownership.mjs';
const wireContext=new AsyncLocalStorage();
let activeOwnerRequests=0,ownerDraining=false;
const recordFirstUse=firstUseRecorder({data:process.env.YGPT_SETUP_DATA_DIR,key:process.env.YGPT_FIRST_USE_KEY,transport:process.env.YGPT_TRANSPORT_SOURCE,clientName:()=>init?.clientInfo?.name??''});
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},id={type:'string',format:undefined,maxLength:128};
const integer={type:'integer',minimum:1,maximum:100};
// One canonical catalog: native typed y_ tools (engine) plus these broker
// tools. Retired names are not routed; they get a NO_TOOL answer that names
// the replacement (see retired-tools.mjs).
const additions=[
 ['y_sqlite_read','Read a SQLite database or inspect its schema without approval. Connection is read-only and query_only; no write statements, attachments or extensions. Prefer this over terminal scripts for local databases.',obj({path:str,sql:{type:'string',maxLength:20000},params:{type:'array',maxItems:100,items:{type:['string','number','null']}},maxRows:{type:'integer',minimum:1,maximum:1000}},['path','sql'])],
 ['y_ping','Health of this YGPT Local bridge: version, engine and approval readiness, and the tool catalog by group. Read-only; no monthly local quota.',obj()],
 ['y_pending_approvals','List THIS chat\'s pending approval request IDs and states (other chats are only counted); never grants approval.',obj()],
 ['y_wait_approval','Wait for an already displayed approval and return the original result, keeping the task in progress. Never executes or replays the action. Continue waiting while pending; do not produce a final report above the card.',obj({requestId:str,resultToken:str,waitMs:{type:'integer',minimum:100,maximum:25000}},['requestId','resultToken'])],
 ['y_policy','Project roots, protections, the active permission mode (autonomous, balanced or secure) and what needs a human. Read-only: the mode is changed by the owner in Windows, never by a tool call.',obj()],
 ['y_dev_task','Run predefined git, Node, npm or Python project tasks without a shell. Ordinary project tasks run by default; protected working directories require a human decision. Can run project scripts; returns durable job ID and output token.',obj({cwd:str,task:{type:'string',enum:developerTasks},timeoutSeconds:{type:'integer',minimum:1,maximum:1800}},['cwd','task'])],
 ['y_close_context','Revoke this chat-held context: its narrow grants end, its browser context closes and its UIA bindings are released. Running processes and jobs keep running but can no longer be controlled from this chat; cancel them first if needed.',obj({contextToken:str},['contextToken'])],
 ['y_download_file','Download an HTTPS file with bounded size and optional SHA-256 verification. Protected destinations require a human decision. Never executes downloaded code. Returns a durable job ID and scoped output token; follow progress with y_job_status.',obj({url:str,destination:str,sha256:{type:'string',pattern:'^[a-fA-F0-9]{64}$'},maxBytes:{type:'integer',minimum:1,maximum:10737418240}},['url','destination'])],
 ['y_verify_checksum','Read an ordinary project file (any size) and compute/compare SHA-256 without modifying it.',obj({path:str,sha256:{type:'string',pattern:'^[a-fA-F0-9]{64}$'}},['path'])],
 ['y_call_status','Get durable operation/call state by ID. A pending ChatGPT generation is not kept open.',obj({id},['id'])],
 ['y_call_result','Recover a bounded encrypted result with the resultToken returned to the original caller. Never repeat an unknown operation.',obj({id,resultToken:str},['id','resultToken'])],
 ['y_recent_calls','Recent call IDs and states with tool name, time, a short chat label and transport; no arguments, results or tokens.',obj({limit:integer})],
 ['y_usage_report','Usage statistics for this instance over a bounded window (1 hour to 30 days, default 7 days): totals by state, per-tool counts, error codes, latency percentiles and per-chat/transport counts. Chat labels are server-issued; host type is never guessed. No arguments, results or secrets are included.',obj({windowHours:{type:'integer',minimum:1,maximum:720}})],
 ['y_resource_owner','Read-only ownership view: the resources (jobs, browser tabs, process sessions, UIA bindings) that belong to THIS chat, and how many belong to other chats. Listing never grants control over any resource.',obj()],
 ['y_file_trash','Move 1 to 20 files or folders to the Windows Recycle Bin. A single ordinary file is deleted by default: a verified protected snapshot is taken first (its snapshotId restores it with y_backup_restore) and the Recycle Bin keeps its own copy; if the snapshot fails nothing is deleted. Batch deletes, directories, project roots, system paths, YGPT runtime/state, the vault and files too large for a snapshot (over 32 MB) require a human decision first. Folders are snapshotted file by file up to 2,000 entries and 128 MB in total; the result lists anything that only the Recycle Bin holds.',obj({paths:{type:'array',minItems:1,maxItems:20,items:str}},['paths'])],
 ,['y_backup_list','List protected pre-write snapshots; contents and credentials are not included.',obj({limit:integer})]
 ,['y_backup_diff','Get path/hash differences and Git checkpoint status for a snapshot.',obj({id},['id'])]
 ,['y_backup_restore','Conflict-checked restore of a completed file snapshot; creates its own undo snapshot.',obj({id},['id'])]
 ,['y_backup_accept','Request marking a finished version as accepted. Requires verified owner approval; never deletes backups automatically.',obj({id},['id'])]
].map(([name,description,inputSchema])=>{
  // Tool annotations guide the host's UI. A restore edits user files, and
  // acceptance is a state transition even while trusted approval is absent.
  const mutates=['y_download_file','y_file_trash','y_dev_task','y_backup_restore','y_backup_accept'].includes(name);
  return {name,description,inputSchema,annotations:{readOnlyHint:!mutates,destructiveHint:mutates,openWorldHint:['y_download_file','y_dev_task'].includes(name),idempotentHint:!mutates}};
});
const ajv=new Ajv({strict:false,validateFormats:false});
let ready=false,closing=false,init=null,initialization=null,backendInitialization=null,portalServer;
const eagerStartup=config.rc10Candidate&&config.deployment==='production';
const startupInit={protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'YGPT Local startup self-test',version:config.version}};
const approvalWaiters=new Map();
const deliveredApprovals=new Set();
let nativeExtension;
function healthRecord(ready,extra={}){
  if(!config.rc10Candidate)return;
  const p=path.join(config.stateDir,'rc10-health.json');
  const value={version:config.version,product:'YGPT Local',pid:process.pid,ready,at:new Date().toISOString(),deployment:config.deployment,tools:nativeExtension?tools().length:0,...extra};
  const temp=p+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,p);
}
let backups;
let backupsReady;
const jobSnapshots=new Map();
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
// A context minted for this call is returned to this chat only. The model is
// told to keep it private and include it on later calls in the same chat.
const withFreshContext=o=>{
  const scope=callScope.getStore();
  if(!o.result||!scope?.context?.token||scope.delivered)return o;scope.delivered=true;
  const ygptContext={contextToken:scope.context.token,note:'Private to THIS chat. Include contextToken on later YGPT calls so this chat keeps ownership of its tabs, UIA targets, processes and jobs. Never copy it to another chat.'};
  return {...o,result:{...o.result,content:[...(o.result.content??[]),{type:'text',text:JSON.stringify({ygptContext})}],...(o.result.structuredContent&&typeof o.result.structuredContent==='object'?{structuredContent:{...o.result.structuredContent,ygptContext}}:{})}};
};
const emit=o=>{o=withFreshContext(o);if(o.result)recordFirstUse(wireContext.getStore()?.toolName,wireContext.getStore()?.toolArgs??{},o.result);if(o.result&&wireContext.getStore()?.version===CURRENT_PROTOCOL)o={...o,result:{resultType:'complete',...o.result}};process.stdout.write(JSON.stringify(o)+'\n');};
const failure=(id,message)=>emit({jsonrpc:'2.0',id,error:{code:-32001,message}});
const response=(id,value,isError=false)=>emit({jsonrpc:'2.0',id,result:{content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],isError}});
const fixtureTool={name:'y_desktop_fixture',title:'YGPT Local · Desktop fixture',description:'Launch the owner-enrolled harmless UIA test fixture window; no disk or unrelated application effects.',inputSchema:obj(),annotations:{readOnlyHint:false,destructiveHint:false}};
const catalog=()=>[...(nativeExtension?.tools()??[]),...(config.rc10Candidate?[fixtureTool]:[]),...additions.filter(t=>!(noLocalReview&&!config.chatAppConsent&&t.name==='y_pending_approvals')&&(config.rc9Candidate||!t.name.startsWith('y_backup_'))),...(!config.rc9Candidate&&uiEnabled()?[previewTool]:[]),...((!config.rc9Candidate||config.chatAppConsent)&&barEnabled()?barTools:[]),...(config.rc10Candidate?[approvalCenterTool]:[])];
const tools=()=>catalog().map(t=>({...t,...(config.chatAppConsent&&t._meta?.ui?.resourceUri?{_meta:{...t._meta,ui:{...t._meta.ui,resourceUri:INSPECTION_URI},'openai/outputTemplate':INSPECTION_URI}}:{}),title:t.title??('YGPT Local · '+t.name),inputSchema:{...t.inputSchema,properties:{...t.inputSchema.properties,contextToken:{type:'string',description:'Private context token retained in THIS chat; never copy to another chat.'}}}}));
const appOnly=t=>t._meta?.ui?.visibility?.includes('app');
const groups=[['file','y_file_'],['search','y_search_'],['project','y_project_'],['process','y_process_'],['job','y_job_'],['browser','y_browser_'],['desktop','y_desktop_'],['backup','y_backup_'],['approval',/^y_(?:show_approval|approval_center|wait_approval|pending_approvals|bar_)/],['status',/^y_(?:ping|policy|recent_calls|usage_report|resource_owner|call_|system_)/]];
function catalogSummary(){const list=tools(),byGroup={};for(const t of list){const g=groups.find(([,m])=>typeof m==='string'?t.name.startsWith(m):m.test(t.name))?.[0]??'other';byGroup[g]=(byGroup[g]??0)+1;}return {tools:list.length,publicTools:list.filter(t=>!appOnly(t)).length,appOnly:list.filter(appOnly).length,byGroup};}
function ensureEngine(params){
  if(!backendInitialization)backendInitialization=initializeEngine(params).catch(e=>{backendInitialization=null;recordStartupFailure(e);throw e;});
  return backendInitialization;
}
async function initializeEngine(){
  if(!nativeExtension){await ensureBackups();nativeExtension=await createNativeExtension({backups,ledger,protectState:async()=>acl});}
  const names=tools().map(t=>t.name);if(new Set(names).size!==names.length)throw Error('Duplicate tool catalog entry');
  ready=true;clearStartupFailure();healthRecord(true,{initializationSource:init?'host-request':'startup-self-test',initializedByTunnel:Boolean(init)&&config.deployment==='production'});
}
async function jobControl(action,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(config.python,[...config.pythonArgs,path.join(RUNTIME,'y_jobs.py')],{cwd:config.stateDir,env:cleanEnv({YGPT_INGRESS_ID:config.ingressId,YGPT_PROJECT_ROOTS:JSON.stringify(action==='submit'?[args.cwd]:config.projectRoots)}),windowsHide:true,stdio:['pipe','pipe','ignore']});
    let data='';const timer=setTimeout(()=>{p.kill();reject(Error('Job control deadline; query status by operation ID'));},12000);
    p.stdout.on('data',b=>{data+=b;if(Buffer.byteLength(data)>262144){p.kill();reject(Error('Job response too large'));}});
    p.once('error',e=>{clearTimeout(timer);reject(e);});
    p.once('exit',code=>{clearTimeout(timer);try{const r=JSON.parse(data);code===0?resolve(r):reject(Error(r.error??'Job control failure'));}catch{reject(Error('Invalid job response'));}});
    p.stdin.end(JSON.stringify({action,...args}));
  });
}
// A chat sees its own jobs and pre-ownership (unattributed) jobs; other chats'
// jobs are only counted, never listed.
function visibleJobs(rows){
  const mine=callScope.getStore()?.context?.hash??null,jobs=[];let otherChats=0,otherChatsActive=0;
  for(const job of Array.isArray(rows)?rows:[]){const owner=ledger.ownerOf('job',job.id);if(owner===null)jobs.push({...job,owner:'unattributed'});else if(owner===mine)jobs.push({...job,owner:'this-chat'});else{otherChats++;if(['queued','running','unknown'].includes(job.state))otherChatsActive++;}}
  return {jobs,otherChats,otherChatsActive};
}
// Fair share of the durable job worker: one chat may hold at most three active
// jobs, so a long task in chat A never leaves chat B without a slot. A retry
// of a job this chat already owns is a status lookup, not a new slot.
const JOBS_PER_CHAT=3;
async function jobShare(existingId=null){
  const mine=callScope.getStore()?.context?.hash;if(!mine||existingId&&ledger.ownerOf('job',existingId)===mine)return;
  const rows=await jobControl('list',{limit:100});
  const active=(Array.isArray(rows)?rows:[]).filter(j=>['queued','running'].includes(j.state)&&ledger.ownerOf('job',j.id)===mine).length;
  if(active>=JOBS_PER_CHAT)throw Object.assign(Error('CONCURRENCY_LIMIT: this chat already has '+active+' active durable jobs; wait for or cancel one. Nothing was started.'),{code:'CONCURRENCY_LIMIT',effectStarted:false});
}
async function dispatch(name,args,operationId,reviewed=false){
  // Only broker-claimed decisions or exact saved chat grants set reviewed.
  // Snapshot authorization follows this async call, never a model argument or
  // a mutable process-global flag shared with concurrent unreviewed calls.
  if(reviewed){await ensureBackups();return backups.withReviewed(()=>dispatchScoped(name,args,operationId,true));}
  return dispatchScoped(name,args,operationId,false);
}
async function dispatchScoped(name,args,operationId,reviewed=false){
  if(name==='y_sqlite_read'){canonical(args.path);const value=sqliteRead(args);return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
  if(name==='y_desktop_fixture'&&nativeExtension){const result=await nativeExtension.launchFixture();return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
  if(nativeExtension?.tools().some(t=>t.name===name)){
    const {requestKey,...engineArgs}=args;
    let saved;
    if(name==='y_job_submit')await jobShare(args.id);
    if(['y_process_run','y_process_start','y_job_submit'].includes(name)){
      const targets=jobSnapshotTargets(args.cwd??projectRoots[0]);
      if(targets.length){saved=createVerifiedSnapshot(name,targets);if(name==='y_job_submit')backups.attachJob(saved.id,args.id);}
    }
    const r=await (reviewed?nativeExtension.invokeApproved(name,engineArgs):nativeExtension.engine.invoke(name,engineArgs));
    if(name==='y_job_list'&&r.ok)r.result=visibleJobs(r.result);
    if(name==='y_job_status'&&r.ok)r.result=withDownloadProgress(r.result,args.id);
    if(r.ok&&['y_process_run','y_process_start','y_job_submit'].includes(name)){
      const kind=name==='y_job_submit'?'job':'session',id=kind==='job'?r.result.job_id:r.result.sessionId;
      if(id&&!(kind==='job'&&r.result.reused))r.result.outputToken=ledger.grant(kind,id);
    }
    if(saved){
      if(name==='y_job_submit'&&r.ok)trackJobSnapshot(args.id,saved.id);
      else if(name==='y_process_start'&&r.ok){
        const session=r.result.sessionId;
        const timer=setInterval(async()=>{try{const status=nativeExtension.engine.terminal.status(session);if(status.state!=='running'){clearInterval(timer);backups.finish(saved.id,status.state==='succeeded');}}catch{clearInterval(timer);backups.interrupt(saved.id,'Interactive process outcome uncertain');}},1000);timer.unref();
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
    const id=operationId??randomUUID();await jobShare();
    const result=await protectedJobSubmit('developer-task',task.cwd,id,()=>jobControl('submit',{id,cwd:task.cwd,argv:task.argv,timeoutSeconds:task.timeoutSeconds}));
    result.outputToken=ledger.grant('job',result.job_id);
    return {structuredContent:result,content:[{type:'text',text:JSON.stringify({job_id:result.job_id,state:result.state,task:task.task,outputToken:result.outputToken})}]};
  }
  if(name==='y_verify_checksum'){const r=await checksum(args.path,args.sha256,{reviewed});return {content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r};}
  if(name==='y_usage_report'){
    const hours=Math.min(720,Math.max(1,args.windowHours??168)),since=Date.now()-hours*3600000,rows=ledger.usageRows(since);
    const byState={},byTool={},byError={},bySource={},durations=[];
    for(const r of rows){byState[r.state]=(byState[r.state]??0)+1;const t=byTool[r.name]??={total:0,succeeded:0,failed:0,unknown:0,running:0};t.total++;if(t[r.state]!==undefined)t[r.state]++;if(r.error_code)byError[r.error_code]=(byError[r.error_code]??0)+1;const src=(r.context_label??'unverified')+' · '+(r.transport??'unverified');bySource[src]=(bySource[src]??0)+1;if(r.updated>r.created&&r.state!=='running')durations.push(r.updated-r.created);}
    durations.sort((x,y)=>x-y);const pct=p=>durations.length?durations[Math.min(durations.length-1,Math.floor(p/100*durations.length))]:null;
    const report={windowHours:hours,since:new Date(since).toISOString(),totalCalls:rows.length,byState,byTool,byError,bySource,latencyMs:{p50:pct(50),p95:pct(95),max:durations.length?durations[durations.length-1]:null},provenanceNote:'Chat labels are server-issued context labels; host type (Chat vs Desktop Agent) is not attested and is never guessed.'};
    return {content:[{type:'text',text:JSON.stringify(report)}],structuredContent:report};
  }
  if(name==='y_resource_owner'){
    const hash=callScope.getStore()?.context?.hash??null;
    let browser=null,processes=null;
    try{browser=(await nativeExtension.engine.invoke('y_browser_tabs',{})).result??null;}catch{}
    try{processes=(await nativeExtension.engine.invoke('y_process_list',{})).result??null;}catch{}
    const view={context:hash?contextLabel(hash):null,mine:hash?ledger.resourcesOf(hash):[],otherChats:hash?ledger.foreignCounts(hash):{},browserTabs:browser?.tabs??[],otherChatTabs:browser?.otherChatTabs??0,processesHere:processes,note:'Ownership is enforced by the server; this view never grants control. Other chats\' resources are counted, never listed.'};
    return {content:[{type:'text',text:JSON.stringify(view)}],structuredContent:view};
  }
  if(name==='y_file_trash'){
    if(process.platform!=='win32')throw Object.assign(Error('The Recycle Bin is only available on Windows'),{code:'TRASH_UNAVAILABLE',effectStarted:false});
    await ensureBackups();
    // Snapshot what it can really restore (folder trees included); anything
    // else goes only after a human decision and is reported as Recycle-Bin-only.
    const plan=trashPlan(args.paths);
    if(!reviewed&&plan.some(item=>!item.covered))throw Object.assign(Error('A target cannot be held by a protected snapshot ('+plan.filter(item=>!item.covered).map(item=>item.path+': '+item.reason).join('; ')+'). Nothing was deleted; ask again for the owner\'s decision.'),{code:'APPROVAL_REQUIRED',effectStarted:false});
    const snapshotPaths=plan.flatMap(item=>item.snapshotPaths);
    const saved=snapshotPaths.length?backups.create(name,snapshotPaths,{maxTargets:snapshotPaths.length}):null;if(saved)backups.verify(saved.id);
    const exe=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const script='Add-Type -AssemblyName Microsoft.VisualBasic;$p=$env:YGPT_TRASH_PATH;if([IO.Directory]::Exists($p)){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)}else{[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)}';
    const results=[];
    try{for(const item of plan){const target=item.path; // real letter case: the Recycle Bin records it as the original location
      await new Promise((resolve,reject)=>{const child=spawn(exe,['-NoProfile','-NonInteractive','-Command',script],{env:{...cleanEnv(),YGPT_TRASH_PATH:target},windowsHide:true,stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>{err+=b;});child.once('error',reject);child.once('exit',c=>c===0?resolve():reject(Object.assign(Error('Recycle Bin move failed for '+target+': '+String(err).slice(0,300)),{code:'TRASH_FAILED'})));setTimeout(()=>{try{child.kill();}catch{}reject(Object.assign(Error('Recycle Bin move timed out'),{code:'TRASH_FAILED'}));},30000).unref();});
      results.push({path:target,trashed:true,snapshot:item.covered?'covered':'recycle-bin-only',...(item.covered?{}:{reason:item.reason})});}
    }catch(e){if(saved)backups.finish(saved.id,false);e.snapshotId=saved?.id;if(results.length)e.message+='; already moved to the Recycle Bin: '+results.map(r=>r.path).join(', ');throw e;}
    if(saved)backups.finish(saved.id,true);
    const manifestPath=path.join(config.stateDir,'trash-manifest.json');let manifest=[];try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch{}
    for(const r of results)manifest.push({snapshotId:r.snapshot==='covered'?saved?.id??null:null,path:r.path,at:new Date().toISOString()});
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    const uncovered=plan.filter(item=>!item.covered);
    const value={snapshotId:saved?.id??null,results,coverage:uncovered.length?(saved?'partial':'none'):'complete',
      restore:saved?'Restore the covered files with y_backup_restore using this snapshotId after owner review; the Recycle Bin also keeps its own copy.':'No protected snapshot holds these items; restore them from the Windows Recycle Bin.',
      ...(uncovered.length?{recycleBinOnly:uncovered.map(item=>({path:item.path,reason:item.reason})),recycleBinNote:'Not in the protected snapshot: restore these from the Windows Recycle Bin (Windows may purge it when it is full).'}:{})};
    return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
  }
  if(name==='y_download_file'){
    validateSource(args.url);validateDestination(args.destination,{reviewed});await jobShare();fs.mkdirSync(path.dirname(args.destination),{recursive:true});
    const jobId=operationId??randomUUID();const descriptor=path.join(config.stateDir,'jobs','download-'+jobId+'.dpapi');
    fs.writeFileSync(descriptor,protectForWindows(JSON.stringify({...args,reviewed})));
    const r=await protectedJobSubmit('download',path.dirname(args.destination),jobId,()=>jobControl('submit',{id:jobId,cwd:path.dirname(args.destination),argv:[process.execPath,path.join(RUNTIME,'download-worker.mjs'),descriptor],timeoutSeconds:86400}),[args.destination]);r.outputToken=ledger.grant('job',r.job_id);
    return {content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r};
  }
  throw Object.assign(Error('NO_TOOL: unclassified tool '+name),{code:'NO_TOOL',effectStarted:false});
}
// Byte progress of a y_download_file job, merged into y_job_status.
function withDownloadProgress(status,id){
  if(!/^[\da-f-]{36}$/i.test(String(id)))return status;
  const filename=path.join(config.stateDir,'jobs','download-'+id+'.dpapi.status.json');
  try{return fs.existsSync(filename)?{...status,download:JSON.parse(fs.readFileSync(filename,'utf8'))}:status;}catch{return status;}
}
// Transport provenance. Only the local HTTP gateway (which authenticates the
// MCP session and strips caller-supplied ygpt/* metadata) may assert it.
// It never identifies the host as an ordinary chat versus the Desktop Agent.
const gatewayMetaTrusted=process.env.YGPT_TRUST_GATEWAY_META==='1';
function transportOf(msg){
  const asserted=gatewayMetaTrusted?msg.params?._meta?.['ygpt/transport']:null;
  if(asserted&&typeof asserted.kind==='string')return String(asserted.kind).slice(0,32)+(asserted.session?':'+String(asserted.session).slice(0,16):'');
  return process.env.YGPT_TRANSPORT_SOURCE==='official-secure-tunnel'?'secure-tunnel-stdio':'stdio';
}
// The calling chat's context, issued on first need and reused within the call.
function chatContext(){const scope=callScope.getStore();if(!scope.context)scope.context=ledger.context();return scope.context;}
const callMeta=()=>{const s=callScope.getStore();return {context:s?.context?.hash??null,transport:s?.transport??null};};
// Record that the calling context owns a durable job it just created.
function ownCreated(name,result){
  const intent=resourceIntent(name);if(intent.creates!=='job')return;
  const jobId=createdId('job',result);const context=callScope.getStore()?.context;
  if(jobId&&context)ledger.own('job',jobId,context.hash,name);
}
async function execute(id,name,args){
  // An approved operation always runs as the chat context that requested it,
  // never as the context of the call that delivered the human decision.
  const requested=ledger.get(id);
  return callScope.run({context:requested?.contextHash?{hash:requested.contextHash}:null,transport:'approval-continuation',delivered:true},()=>executeApproved(id,name,args));
}
async function executeApproved(id,name,args){
  const access=nativeExtension?.tools().some(t=>t.name===name)?await nativeExtension.authorize(name,args):authorize(name,args);if(access.decision==='deny')throw Error('Policy changed; operation not executed');
  if(!ledger.claim(id,name,args))throw Error('Operation was already claimed, expired or handled');
  const callId=ledger.callStart(name,id,callMeta());callScope.getStore().callId=callId;
  try{
    const operation=ledger.get(id),approvedScope=operation?.chatScope;
    if(approvedScope?.eligible&&grantScopeOf(name,args).key!==approvedScope.key){ledger.finish(id,'failed',null,'Reviewed executable/script changed; no operation executed');ledger.callFinish(callId,'failed');return {isError:true,content:[{type:'text',text:'Reviewed file changed after consent. No operation executed.'}]};}
    if(operation?.executionBinding&&digest(stable(await nativeExtension.binding(name,args).catch(e=>{throw Object.assign(e,{effectStarted:false});})))!==operation.executionBinding)throw Object.assign(Error('Reviewed target or executable changed; request a new review'),{effectStarted:false,code:'EXECUTION_TARGET_CHANGED'});
    const r=await dispatch(name,args,id,true);const state=r.isError?'failed':'succeeded';
    if(!r.isError)ownCreated(name,r);
    ledger.finish(id,state,r,null,r.structuredContent?.job_id??null);ledger.callFinish(callId,state,r);return r;
  }catch(e){const beforeEffect=e.effectStarted===false,state=beforeEffect?'failed':'unknown';ledger.finish(id,state,null,e.message,name==='y_download_file'?id:null);ledger.callFinish(callId,state);return {isError:true,structuredContent:{state,executed:beforeEffect?false:null,code:e.code??'EXECUTION_UNCERTAIN'},content:[{type:'text',text:(beforeEffect?'NOT_EXECUTED: ':'UNKNOWN: ')+e.message+'; inspect status/effects before retrying.'}]};}
}
// Conversation-grant scope of a reviewed call. UIA uses its own narrow rule
// (same window identity, same action type, ten minutes); bind is Allow once.
function grantScopeOf(name,args){return nativeExtension?.chatScope(name,args)??(config.chatAppConsent?reviewScope(name,args):chatScope(name,args));}
// Server instructions: one canonical y_ catalog, per-chat context, approvals.
const instructions=['For authorized local Windows file, directory, edit, search, project or build requests, call YGPT Local typed tools first; never claim completion without their results. For general knowledge do not probe the PC.',
 'Read with y_file_read / y_file_read_many / y_search_text / y_project_inspect / y_sqlite_read (typed reads are automatic). Change files with y_file_edit or y_file_patch using the expectedSha256 you read, then read back; STALE_PREIMAGE means someone else changed the file: re-read, never overwrite blindly. Remove files only with y_file_trash.',
 'Use y_process_run/start for short commands and y_job_submit for long work (pass a fresh UUID as id; resubmitting the same id never runs it twice).',
 'Chat context: the first call that creates a tab, UIA binding, process or job returns ygptContext.contextToken. Include that contextToken on EVERY later YGPT call in THIS chat; it is private to this chat and never belongs in another chat or a summary. Other chats\' tabs, windows, processes and jobs answer SESSION_FOREIGN. Permission model: owner blacklist — everything is allowed by default; operations with a destructive, privileged, system or credential-adjacent signal return APPROVAL_REQUIRED for a human decision instead of a refusal. There are no hard-denied targets: ChatGPT Desktop Agent windows, processes and folders are ordinary targets under the same rules.',
 'Browser tools have two modes: the isolated browser (default, a fresh private browser) and the owner\'s daily Chrome/Edge taken over through the paired YGPT browser extension (y_browser_attach, then open with target existing). In the daily browser, work only inside the YGPT tab group and never disturb the owner\'s own tabs. When several browsers/profiles are paired, attach returns candidates — ask the owner which account to use. When the choice matters, ask the owner which browser to use; if they do not answer, use the isolated browser. The isolated browser launches Chrome by default; the owner can set Edge in configuration.',
 'Desktop UIA (y_desktop_*) and some protected actions return APPROVAL_REQUIRED with requestId and resultToken: immediately show y_show_approval with requestId, resultToken and contextToken, then call y_wait_approval with the resultToken and keep the task in progress. Only the user decides in the card; never call y_bar_* yourself and never replay the original action. After a decision use y_call_status / y_call_result.',
 'RESULT_UNKNOWN or state unknown: query y_call_status, y_job_status or y_resource_owner; do not repeat the operation. Preserve resultToken/outputToken for retrieval and never show tokens in summaries.'].join(' ');
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
      initialization=ensureEngine(init).then(()=>({serverInfo:{name:'YGPT Local',version:config.version},capabilities:{tools:{listChanged:true},...(config.rc10Candidate||!config.rc9Candidate&&uiEnabled()?{resources:{}}:{})},instructions}));
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
  if(ownerDraining||process.env.YGPT_SETUP_DATA_DIR&&fs.existsSync(path.join(process.env.YGPT_SETUP_DATA_DIR,'maintenance-request')))return response(id,{state:'paused',executed:false,message:'Owner maintenance is in progress; no tool operation was executed.'},true);
  const name=msg.params?.name,rawArgs=msg.params?.arguments??{};
  if(typeof name!=='string'||!name)throw Error('Tool name required');
  const nativeCall=!!nativeExtension?.tools().some(t=>t.name===name)||name==='y_desktop_fixture'&&config.rc10Candidate;
  const {contextToken,...args}=rawArgs;
  // Resolve the calling chat context before anything touches an owned resource.
  const intent=resourceIntent(name,args);let context=null;
  if(contextToken){try{context=ledger.context(contextToken);}catch(e){if(intent.creates||intent.uses||intent.lists)return response(id,{state:'rejected',executed:false,code:'CONTEXT_EXPIRED',message:e.message},true);}}
  if(!context&&intent.creates)context=ledger.context();
  return callScope.run({context,transport:transportOf(msg),delivered:false},()=>callTool({id,msg,host,nativeCall,name,args,contextToken,rawArgs,intent}));
}
async function callTool({id,msg,host,nativeCall,name,args,contextToken,rawArgs,intent}){
  const descriptor=tools().find(t=>t.name===name);
  // Retired names are not aliases: nothing runs, and the answer names the replacement.
  if(!descriptor){const retired=retiredTool(name);return response(id,{state:'rejected',executed:false,code:'NO_TOOL',message:'Unknown YGPT Local tool '+String(name).slice(0,80)+'. This build serves one canonical y_ catalog; refresh the tool list.',...(retired?{replacement:retired.replacement,note:retired.note}:{})},true);}
  if(!ajv.validate(descriptor.inputSchema,rawArgs))throw Error('Invalid tool arguments: '+(ajv.errors?.[0]?.message??name));
  const foreign=ownershipViolation(ledger,name,intent,callScope.getStore().context?.hash??null);
  if(foreign)return response(id,foreign,true);
  const resumed=await resumeNativeConsent(msg,name,args,host,ledger,execute);
  if(resumed)return emit({jsonrpc:'2.0',id,result:resumed});
  if(config.rc10Candidate&&name==='y_approval_center')return emit({jsonrpc:'2.0',id,result:config.chatAppConsent?chatApprovalResult(ledger,{...args,contextToken}):approvalCenterResult(ledger.get(args.requestId),args.requestId)});
  if(barEnabled()&&barTools.some(t=>t.name===name))return emit({jsonrpc:'2.0',id,result:handleBar(name,{...args,contextToken},ledger,execute,requestId=>approvalWaiters.has(requestId)||deliveredApprovals.has(requestId))});
  if(name==='y_close_context'){
    const hash=callScope.getStore().context?.hash;ledger.closeContext(contextToken);
    const released=hash&&nativeExtension?{browserContextClosed:(await nativeExtension.engine.browser.closeContext(hash)).closed,desktopBindingsReleased:nativeExtension.engine.desktop.release(hash)}:{};
    return response(id,{closed:true,...released});
  }
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
  if(name==='y_ping')return response(id,{version:config.version,policyVersion:config.rc10Candidate?10:config.rc9Candidate?9:8,modules:['file','terminal','search','browser','desktop','system'],rc10Candidate:config.rc10Candidate,rc9Candidate:config.rc9Candidate,engineReady:ready,approvalReady:config.chatAppConsent&&barEnabled()||!noLocalReview&&portal()!=='unavailable',approvalInterface:config.chatAppConsent?'mcp-app-capability':config.rc9Candidate?'unverified-host-suspended':config.localApprovalDisabled?'disabled':barEnabled()?'inline-strip':'local-wpf',localApprovalDisabled:noLocalReview,inlineDecisionsEnabled:barEnabled()&&config.allowInlineDecisions,inChatUI:barEnabled(),nativeElicitation:false,
    // Advertised capabilities are diagnostic only: even form elicitation does
    // not attest that a specific human clicked Allow. Never auto-authorize on
    // this field or on clientInfo/model-supplied MCP request metadata.
    hostElicitationAdvertised:!!(init?.capabilities?.elicitation?.form||init?.capabilities?.elicitation?.url),
    hostApprovalClickVerified:false,approvalSecurity:config.chatAppConsent?'app-only tools + hidden metadata capability + exact request + TTL; physical human identity is not attested':'disabled',
    catalog:catalogSummary(),pid:process.pid,tunnelReadiness:config.deployment==='production'?'existing-production-ingress; probe watchdog for tunnel health':'isolated; no tunnel created',quota:'none',singleOwner:true,aclProtected:acl.protected,localPopups:false});
  if(name==='y_policy')return response(id,{projectRoots,systemRoots,...profileSummary(currentPermissionMode()),defaultAllow:config.blacklistDefaultAllow,readOnlyAutoAllow:config.readOnlyAutoAllow,autoDevTasks:config.autoDevTasks,trustedDeveloperRoots:config.trustedDeveloperRoots,
    humanApproval:['Desktop UIA bind and every UIA action','batch, directory or system-path deletes (y_file_trash)','destructive, privileged or system-changing commands','protected, credential-adjacent or system file changes','developer tasks targeting protected directories','writes into YGPT runtime/state or the vault'],hardDenied:[],hardDeniedNote:'Owner blacklist model (rc.13): there are no hard-denied targets. ChatGPT Desktop Agent resources and YGPT\'s own state are gated by human approval when a risk signal matches, never refused outright. Per-chat resource ownership (SESSION_FOREIGN) is not a policy denial: a chat can only operate resources it created.',
    desktopRequireEnrollment:false,scope:'private single-owner; resources belong to the chat context that created them',noOsSandbox:true});
  if(name==='y_pending_approvals'){const mine=callScope.getStore().context?.hash??null,waiting=ledger.pending().filter(o=>o.state==='awaiting_user');
    return response(id,{operations:waiting.filter(o=>mine&&o.contextHash===mine).map(r=>({id:r.id,state:r.state,title:r.presentation?.title,expiresAt:r.expiresAt})),otherChats:waiting.filter(o=>!mine||o.contextHash!==mine).length});}
  if(name==='y_recent_calls')return response(id,{calls:ledger.calls(args.limit)});
  if(name==='y_call_status'||name==='y_call_result'){
    const op=ledger.get(args.id),call=ledger.call(args.id);
    if(name==='y_call_status')return response(id,op?{id:op.id,tool:op.tool,state:op.state,reason:op.reason,resultRef:op.resultRef,expiresAt:op.expiresAt,updatedAt:op.updatedAt}:call??{found:false});
    const ok=op?ledger.canRead(args.id,args.resultToken):ledger.owns('call',args.id,args.resultToken);
    if(!ok)return response(id,'Result token missing or not scoped to this request',true);
    return response(id,op?{state:op.state,result:ledger.result(args.id)}:ledger.call(args.id,true));
  }
  let access=nativeCall?(name==='y_desktop_fixture'?{decision:'allow'}:await nativeExtension.authorize(name,args)):authorize(name,args);
  if(config.blacklistDefaultAllow&&name==='y_backup_restore'){
    await ensureBackups();
    for(const file of backups.manifest(args.id).files){
      const targetAccess=authorize('write_file',{path:file.path});
      if(targetAccess.decision==='deny'){access=targetAccess;break;}
      if(targetAccess.decision==='approve')access=targetAccess;
    }
  }
  if(access.decision==='deny')return response(id,{state:'rejected',executed:false,code:access.code??'POLICY_BLOCKED',message:'YGPT POLICY BLOCKED: '+access.reason},true);
  if(access.decision==='approve'&&config.chatAppConsent){
    const context=chatContext(),grantScope=grantScopeOf(name,args);
    if(grantScope.eligible&&ledger.hasChatGrant(context.hash,grantScope.key))access={...access,decision:'allow',chatGrant:true};
    else{
      const binding=nativeCall?await nativeExtension.binding(name,args):null;
      const presentation=(nativeCall&&await nativeExtension.presentation(name,args))||describeEnglish(name,args);
      const hold=ledger.create(name,args,{...access,presentation,chatScope:grantScope,contextHash:context.hash,executionBinding:binding?digest(stable(binding)):null},{idempotencyKey:msg.params?._meta?.['ygpt/idempotency-key']??null});
      if(nativeConsentSupported(host)&&hold.operation.state==='awaiting_user')return emit({jsonrpc:'2.0',id,result:nativeConsentRequest(ledger,hold.operation,name,args,host,{resultToken:hold.receipt,contextToken:context.token})});
      if(context.token)callScope.getStore().delivered=true;
      const value={state:'suspended',code:'APPROVAL_REQUIRED',needsApproval:hold.operation.state==='awaiting_user',requestId:hold.operation.id,...(hold.receipt?{resultToken:hold.receipt}:{}),...(context.token?{contextToken:context.token}:{}),chatScopeAvailable:grantScope.eligible,expiresAt:hold.operation.expiresAt,message:'REVIEW_REQUIRED: render y_show_approval immediately with requestId, resultToken and original contextToken, then call y_wait_approval with original resultToken. Keep this task in progress; do not append a long report or replay the original action. User clicks notify this conversation; check y_call_status/y_call_result and continue without replaying the action. Never invoke UI decision tools from the model.'};
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
    const context=chatContext(),scope=chatScope(name,args);
    if(scope.eligible&&ledger.hasChatGrant(context.hash,scope.key))access={...access,decision:'allow',chatGrant:true};
    else {
      const gate=lookup(name,args,{...access,chatScope:scope,contextHash:context.hash},{idempotencyKey:msg.params?._meta?.['ygpt/idempotency-key']??null});
      const op=gate.operation;
      return emit({jsonrpc:'2.0',id,result:{structuredContent:{needsApproval:op.state==='awaiting_user',requestId:op.id,state:op.state,...(gate.receipt?{resultToken:gate.receipt}:{}),...(context.token?{contextToken:context.token}:{}),chatScopeAvailable:scope.eligible},content:[{type:'text',text:(barEnabled()?'Show y_show_approval with requestId and original resultToken for the compact IN-CHAT strip.':'Local Windows consent required.')+' No execution before approval. Keep contextToken PRIVATE in this chat and include it on later calls to use only human-approved narrow scopes. It is a server-issued capability, not an authenticated OpenAI session ID. Query call_status and call_result with resultToken after the human decides. Never replay unknown effects.'}]}});
    }
  }
  const idem=msg.params?._meta?.['ygpt/idempotency-key']??(nativeCall?args.requestKey:undefined);
  if(idem&&(nativeCall||name==='y_download_file')){
    const gate=ledger.create(name,args,{...access,presentation:describeOperation(name,args),contextHash:callScope.getStore().context?.hash??null},{idempotencyKey:idem});
    if(gate.reused)return response(id,{id:gate.operation.id,state:gate.operation.state,resultRef:gate.operation.resultRef,replayed:false});
    if(!ledger.autoClaim(gate.operation.id))throw Error('Automatic job was already claimed');
    try{const r=await dispatch(name,args,gate.operation.id,access.chatGrant===true);if(!r.isError)ownCreated(name,r);ledger.finish(gate.operation.id,r.structuredContent?.error?.outcomeUnknown?'unknown':r.isError?'failed':'succeeded',r,null,r.structuredContent?.job_id??null);return emit({jsonrpc:'2.0',id,result:{...r,structuredContent:{...(r.structuredContent??{}),ygpt:{requestId:gate.operation.id,resultToken:gate.receipt,policyAutomatic:true}}}});}
    catch(e){const beforeEffect=e.effectStarted===false,state=beforeEffect?'failed':'unknown';ledger.finish(gate.operation.id,state,null,e.message,gate.operation.id);return response(id,{id:gate.operation.id,state,executed:beforeEffect?false:null,code:e.code??'EXECUTION_UNCERTAIN',...(e.filesRestored!==undefined?{filesRestored:e.filesRestored,noFilesRestored:e.filesRestored===0}:{}),resultRef:gate.operation.id,message:beforeEffect?'Preflight failed before execution; inspect the error before creating a new request':'Query existing task; do not replay'},true);}
  }
  const callId=ledger.callStart(name,null,callMeta());callScope.getStore().callId=callId;const token=ledger.grant('call',callId);
  try{const r=await dispatch(name,args,callId,access.chatGrant===true);if(!r.isError)ownCreated(name,r);ledger.callFinish(callId,r.structuredContent?.error?.outcomeUnknown?'unknown':r.isError?'failed':'succeeded',r);emit({jsonrpc:'2.0',id,result:{...r,structuredContent:{...(r.structuredContent??{}),ygpt:{callId,resultToken:token}}}});}
  catch(e){const beforeEffect=e.effectStarted===false,state=beforeEffect?'failed':'unknown';ledger.callFinish(callId,state);response(id,{callId,state,executed:beforeEffect?false:null,code:e.code??'EXECUTION_UNCERTAIN',...(e.filesRestored!==undefined?{filesRestored:e.filesRestored,noFilesRestored:e.filesRestored===0}:{}),message:e.message},true);}
}
const ownerControl=startOwnerControl({pipe:process.env.YGPT_CONTROL_PIPE,key:process.env.YGPT_LOCAL_CONTROL_KEY,status:async()=>{const c=catalogSummary();return {product:'YGPT Local',version:config.version,pid:process.pid,localReady:ready&&!!nativeExtension,tools:c.tools,publicTools:c.publicTools,appOnly:c.appOnly,draining:ownerDraining};},drain:async()=>{
 if(activeOwnerRequests||ledger.pending().some(o=>o.state==='awaiting_user'))return {safeToStop:false,reason:'Active calls or pending approvals'};
 let busy=false;const scan=v=>{if(v&&typeof v==='object'){if(['running','queued','starting','pending','awaiting_user','unknown'].includes(v.state))busy=true;for(const child of Object.values(v))scan(child);}};
 try{for(const n of ['y_process_list','y_job_list']){const v=await nativeExtension.engine.invoke(n,{});if(v?.isError||v?.ok===false)throw Error('Inventory failed');scan(v);if(Number(v?.result?.otherChatsActive??0)>0)busy=true;}}catch{return {safeToStop:false,reason:'Owned activity inventory unavailable'};}
 if(!busy)ownerDraining=true;return {safeToStop:!busy,reason:busy?'Owned activity is still active':null};
}});
async function shutdown(){if(closing)return;closing=true;ownerControl?.close();await nativeExtension?.engine.close();closePanel();portalServer?.close();releaseLease();setTimeout(()=>process.exit(0),150).unref();}
process.once('exit',()=>{try{releaseLease();}catch{}});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
if(!noLocalReview)portalServer=await launchPortal(execute);
// The Tunnel opens stdio eagerly but may not send initialize until a chat calls.
// Check only our private engine/catalog at boot; public requests still require
// their own initialize, and this is never recorded as a ChatGPT host handshake.
if(eagerStartup)ensureEngine(startupInit).catch(()=>{}); // ensureEngine records the sanitized startup failure
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{let msg;try{if(Buffer.byteLength(line)>131072)throw Error('Request too large');msg=JSON.parse(line);}catch{failure(null,'Malformed/oversized JSON-RPC');return;}
  activeOwnerRequests++;wireContext.run({version:msg.params?._meta?.['io.modelcontextprotocol/protocolVersion'],toolName:msg.params?.name,toolArgs:msg.params?.arguments},()=>handle(msg).catch(e=>failure(msg.id??null,e.message)).finally(()=>activeOwnerRequests--));});
input.once('close',shutdown);
