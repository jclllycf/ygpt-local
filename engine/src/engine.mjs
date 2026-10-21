import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import Ajv from 'ajv';
import {YFileEngine,EngineError,sha256} from './file-engine.mjs';
import {YSearchEngine} from './search-engine.mjs';
import {YTerminalEngine} from './terminal-engine.mjs';
import {YBrowserEngine} from './browser-engine.mjs';
import {YDesktopEngine} from './desktop-engine.mjs';
import {YSystemEngine} from './system-engine.mjs';
import {DesktopCommanderAdapter} from './compat-adapter.mjs';
import {DurableJobs} from './durable-jobs.mjs';
import {EngineLedger} from './ledger.mjs';
import {fixtureSnapshotProvider,rc9SnapshotProvider} from './snapshot-adapter.mjs';
import {protectState as protectWindowsState} from './state-protection.mjs';
import lockfile from 'proper-lockfile';

export const identity={name:'YGPT Local',version:'0.2.0-candidate.1',provider:'ygpt-local',engine:'hybrid-windows',production:false};
const str=z.string().min(1).max(2048),text=z.string().max(8*1024*1024),hash=z.string().regex(/^[a-f0-9]{64}$/).nullable().optional();
const locator=z.object({role:z.string().max(80).optional(),name:z.string().max(300).optional(),testId:z.string().max(200).optional(),selector:z.string().max(500).optional()}).strict();
const selector={automationId:z.string().max(300).optional(),name:z.string().max(300).optional(),runtimeId:z.string().max(300).optional()};
const processSpec={executable:str,args:z.array(z.string().max(32768)).max(100).default([]),cwd:str.optional(),timeoutMs:z.number().int().min(100).max(86400000).default(10000)};
const sid=z.string().uuid();
export async function createEngine(config,{authorize,backupManager,ledger:outerLedger,protectState}={}) {
  const root=await fs.realpath(config.root),stateDir=path.resolve(config.stateDir);
  await fs.mkdir(stateDir,{recursive:true});await (protectState??protectWindowsState)(stateDir);
  if(config.mode!=='fixture'&&(!authorize||!backupManager||!outerLedger))throw new EngineError('RC9_REQUIRED','Live integration requires trusted authorize, BackupManager and shared ledger; no model-supplied approval is accepted');
  const snapshot=backupManager?rc9SnapshotProvider(backupManager):await fixtureSnapshotProvider(root,stateDir);
  // Integrated mode is already guarded by the RC broker's PID+birth lease.
  // A second stale timer would reject a legitimate immediate crash recovery.
  const release=config.mode==='rc9-integrated'?async()=>{}:await lockfile.lock(stateDir,{lockfilePath:path.join(stateDir,'engine-instance.lock'),stale:30000,update:5000,retries:0});
  const file=await YFileEngine.create(root,{snapshot}),terminal=new YTerminalEngine({root,stateDir,allowedExecutables:config.allowedExecutables,authorizeExecutable:config.mode==='rc9-integrated'?config.authorizeExecutable:undefined,maxOutputBytes:2*1024*1024});
  const search=new YSearchEngine(file),browser=new YBrowserEngine({stateDir,...config.browser}),desktop=new YDesktopEngine({stateDir,allowedPids:config.desktopAllowedPids??[]}),system=new YSystemEngine(),dc=new DesktopCommanderAdapter({root,stateDir}),jobs=new DurableJobs({terminal,stateDir,python:config.python,pythonArgs:config.pythonArgs,ingressId:config.ingressId});
  const ledger=outerLedger??new EngineLedger(stateDir),table=new Map();
  const add=(name,shape,handler,{mutating=false,openWorld=false,description=name}={})=>{
    const schema=z.object({...shape,requestKey:z.string().max(120).optional(),...(config.mode==='rc9-integrated'?{outputToken:z.string().max(128).optional()}:{})}).strict();
    table.set(name,{name,title:'YGPT Local · '+name,description:'YGPT Local: '+description,inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:!mutating,destructiveHint:mutating,idempotentHint:!mutating,openWorldHint:openWorld},parse:a=>schema.parse(a),handler,mutating});
  };
  add('y_ping',{},async()=>({...identity,processId:process.pid,mode:config.mode,scope:root,rc9Protection:!!backupManager,modules:['file','terminal','search','browser','desktop','system'],chatgptConnected:false,tunnelCreated:false}));
  add('y_engine_history',{limit:z.number().int().min(1).max(100).default(30)},a=>ledger.history(a.limit));
  add('y_file_list',{path:str.default('.')},a=>file.list(a.path));
  add('y_file_info',{path:str},a=>file.stat(a.path));
  add('y_file_read',{path:str,offset:z.number().int().min(0).default(0),lines:z.number().int().min(1).max(2000).default(100)},a=>file.read(a.path,a));
  add('y_file_read_bytes',{path:str,offset:z.number().int().min(0).default(0),length:z.number().int().min(1).max(1048576).default(65536)},a=>file.readBytes(a.path,a));
  add('y_file_write',{path:str,content:text,expectedSha256:hash},a=>file.atomicWrite(a.path,a.content,a),{mutating:true});
  add('y_file_edit',{path:str,oldText:str,newText:text,expectedSha256:hash},a=>file.replaceExact(a.path,a.oldText,a.newText,a),{mutating:true});
  add('y_file_copy',{source:str,destination:str,expectedSha256:hash,expectedSourceSha256:hash},a=>file.copy(a.source,a.destination,a),{mutating:true});
  add('y_file_move',{source:str,destination:str,expectedSha256:hash},a=>file.move(a.source,a.destination,a),{mutating:true});
  add('y_file_mkdir',{path:str},a=>file.mkdir(a.path),{mutating:true});
  add('y_file_batch',{operations:z.array(z.object({kind:z.enum(['write','copy','move','edit']),path:str.optional(),source:str.optional(),destination:str.optional(),content:text.optional(),oldText:str.optional(),newText:text.optional(),expectedSha256:hash}).strict()).min(1).max(50)},a=>file.batch(a.operations),{mutating:true});
  add('y_search_text',{directory:str.default('.'),pattern:str,regex:z.boolean().default(false),caseSensitive:z.boolean().default(true),glob:str.optional(),offset:z.number().int().min(0).max(5000).default(0),maxMatches:z.number().int().min(1).max(2000).default(100)},a=>search.findText(a.directory,a.pattern,a));
  add('y_search_files',{directory:str.default('.'),pattern:str.default('*'),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(1000).default(100)},a=>search.findFiles(a.directory,a.pattern,a));
  add('y_process_run',processSpec,a=>terminal.run(a),{mutating:true});
  add('y_process_start',processSpec,a=>terminal.start(a),{mutating:true});
  add('y_process_poll',{sessionId:sid,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(65536).default(65536)},a=>terminal.poll(a.sessionId,a));
  add('y_process_input',{sessionId:sid,text:z.string().max(65536),end:z.boolean().default(false)},a=>terminal.input(a.sessionId,a.text,a),{mutating:true});
  add('y_process_cancel',{sessionId:sid},a=>terminal.cancel(a.sessionId),{mutating:true});
  add('y_process_list',{},()=>terminal.list());
  add('y_job_submit',{...processSpec,id:sid},a=>jobs.submit(a),{mutating:true});
  add('y_job_status',{id:sid},a=>jobs.status(a.id));add('y_job_logs',{id:sid},a=>jobs.logs(a.id));add('y_job_cancel',{id:sid},a=>jobs.cancel(a.id),{mutating:true});add('y_job_list',{},()=>jobs.list());
  add('y_browser_open',{url:str},a=>browser.open(a.url),{mutating:true,openWorld:true});
  add('y_browser_tabs',{},()=>browser.list());
  add('y_browser_snapshot',{tabId:sid},a=>browser.snapshot(a.tabId));
  add('y_browser_navigate',{tabId:sid,url:str},a=>browser.navigate(a.tabId,a.url),{mutating:true,openWorld:true});
  add('y_browser_action',{tabId:sid,action:z.enum(['click','fill','press','select','check']),target:locator,value:z.union([z.string().max(10000),z.boolean()]).optional()},a=>browser.act(a.tabId,a.action,a.target,a.value),{mutating:true,openWorld:true});
  add('y_browser_wait',{tabId:sid,target:locator,text:z.string().max(500).optional(),state:z.enum(['visible','hidden','attached','detached']).default('visible'),timeoutMs:z.number().int().min(100).max(15000).default(10000)},a=>browser.wait(a.tabId,a.target,a));
  add('y_browser_screenshot',{tabId:sid},a=>browser.screenshot(a.tabId));
  add('y_browser_download',{tabId:sid,target:locator},a=>browser.download(a.tabId,a.target),{mutating:true,openWorld:true});
  add('y_browser_close',{tabId:sid},a=>browser.closeTab(a.tabId),{mutating:true});
  add('y_desktop_windows',{},()=>desktop.windows());
  add('y_desktop_bind',{hwnd:str},a=>desktop.bind(a.hwnd));
  add('y_desktop_inspect',{targetId:sid},a=>desktop.act(a.targetId,'tree'));
  add('y_desktop_value',{targetId:sid,...selector},a=>desktop.act(a.targetId,'value',a));
  add('y_desktop_action',{targetId:sid,action:z.enum(['focus','setValue','invoke','click','type']),...selector,value:z.string().max(10000).optional()},a=>desktop.act(a.targetId,a.action,a),{mutating:true,openWorld:true});
  add('y_desktop_screenshot',{targetId:sid},a=>desktop.capture(a.targetId));
  add('y_system_inspect',{kind:z.enum(['health','processes','services','events','autostarts','disks']).default('health')},a=>system.inspect(a.kind));

  const dcNames=new Set(['get_config','read_file','read_multiple_files','write_file','create_directory','list_directory','move_file','start_search','get_more_search_results','stop_search','list_searches','get_file_info','edit_block','start_process','read_process_output','interact_with_process','force_terminate','list_sessions']);
  const dcWrites=new Set(['write_file','edit_block','create_directory','move_file']),dcMutates=new Set([...dcWrites,'start_process','interact_with_process','force_terminate']);
  const ajv=new Ajv({strict:false,allErrors:true});
  if(config.legacyTools!==false){for(const upstream of await dc.tools()){
    if(!dcNames.has(upstream.name))continue;const validate=ajv.compile(upstream.inputSchema),name=upstream.name;
    const handler=async a=>{
      for(const key of ['path','file_path','source','destination'])if(a[key])a={...a,[key]:await file.resolve(a[key])};
      if(a.paths)a={...a,paths:await Promise.all(a.paths.map(p=>file.resolve(p)))};
      // Shell strings are supplied by an authenticated owner/broker; this is not an OS sandbox.
      if(name==='start_process'&&!config.allowLegacyCommands)throw new EngineError('RC9_REQUIRED','Legacy shell commands require explicit owner config and outer RC9 authorization');
      const receipts=[];if(dcWrites.has(name))for(const target of [a.path,a.file_path,a.source,a.destination].filter(Boolean)){
        let before=null;try{before=await file.boundedBytes(target);}catch(e){if(e.code!=='ENOENT')throw e;}
        const receipt=await snapshot({path:target,before,existed:before!==null,sha256:before===null?null:sha256(before)});if(!receipt?.durable)throw new EngineError('BACKUP_FAILED','Legacy write snapshot failed');receipts.push(receipt);}
      let ok=false;try{const got=await dc.invoke(name,a);ok=!got.isError;return {upstreamResult:got};}finally{for(const r of receipts)await snapshot.finish?.(r.id,ok);}
    };
    const definition={...upstream,inputSchema:{...upstream.inputSchema,properties:{...upstream.inputSchema.properties,contextToken:{type:'string',description:'Compatibility only. Never grants permission.'}}},title:'YGPT Local · '+name,description:'YGPT Local compatible '+name+'. '+(upstream.description??'').replace(/Desktop Commander/gi,'local engine'),_meta:undefined,mutating:dcMutates.has(name),annotations:{readOnlyHint:!dcMutates.has(name),destructiveHint:dcMutates.has(name),openWorldHint:name==='start_process'},parse:a=>{const {contextToken,...rest}=a;if(!validate(rest))throw new EngineError('BAD_ARGS',ajv.errorsText(validate.errors));return rest;},handler};
    table.set(name,definition);table.set('y_local_'+name,{...definition,name:'y_local_'+name});
  }}
  return {identity,file,terminal,search,browser,desktop,system,dc,jobs,ledger,
    tools(){return [...table.values()].map(({parse,handler,mutating,...tool})=>tool);},
    async invoke(name,args={}){
      let operation;try{const t=table.get(name);if(!t)throw new EngineError('NO_TOOL','Unknown YGPT Local tool');const parsed=t.parse(args),{requestKey,...a}=parsed;
        const decision=authorize?await authorize({tool:name,args:a,mutating:t.mutating,openWorld:t.annotations?.openWorldHint,root}):{allowed:config.mode==='fixture'};
        if(decision?.allowed!==true)throw new EngineError('RC9_BLOCKED',decision?.reason??'Outer policy did not authorize this exact operation');
        operation=ledger.begin(name,a,requestKey);if(operation.reused)return operation.result;
        const result=await t.handler(a),upstreamError=result?.upstreamResult?.isError===true,processError=name==='y_process_run'&&result.state!=='succeeded',response={product:'YGPT Local',callId:operation.id,ok:!upstreamError&&!processError,result,...(upstreamError?{error:{code:'UPSTREAM_EXECUTION_FAILED',message:'The compatible upstream operation returned an error; see original tool content'}}:processError?{error:{code:'PROCESS_EXIT_FAILED',message:'Process ended with state '+result.state+' and exit code '+result.exitCode}}:{})};ledger.finish(operation.id,response);return response;
      }catch(e){const outcomeUnknown=['UIA_TIMEOUT','JOB_CONTROL_TIMEOUT'].includes(e.code)||e.name==='TimeoutError';const response={product:'YGPT Local',callId:operation?.id??null,ok:false,error:{code:e.code??(outcomeUnknown?'RESULT_UNKNOWN':'EXECUTION_FAILED'),message:String(e.message).slice(0,1000),...(outcomeUnknown?{outcomeUnknown:true}:{})}};if(operation&&!operation.reused)ledger.finish(operation.id,response);return response;}
    },
    async close(){await Promise.allSettled([terminal.close(),browser.close(),dc.close()]);if(!outerLedger)ledger.close();await release();}
  };
}
