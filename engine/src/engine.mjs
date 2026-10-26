import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileP=promisify(execFile);
import {z} from 'zod';
import {YFileEngine,EngineError,sha256} from './file-engine.mjs';
import {YSearchEngine} from './search-engine.mjs';
import {YTerminalEngine} from './terminal-engine.mjs';
import {YBrowserFacade} from './browser-engine.mjs';
import {BrowserExtensions} from './browser-extensions.mjs';
import {YDesktopEngine} from './desktop-engine.mjs';
import {YSystemEngine} from './system-engine.mjs';
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
  // The broker supplies the calling chat context; standalone fixtures use one local owner.
  const currentOwner=typeof config.currentOwner==='function'?()=>config.currentOwner()??'local':()=>'local';
  // Two browser modes (owner model rc.13): an isolated Playwright browser
  // (default; Chrome unless the owner configures Edge) and, on request, a
  // take-over of the owner's own existing browser over CDP (y_browser_attach).
  // The chat asks the owner which to use; no answer means the isolated one.
  await fs.mkdir(stateDir,{recursive:true});await (protectState??protectWindowsState)(stateDir);
  if(config.mode!=='fixture'&&(!authorize||!backupManager||!outerLedger))throw new EngineError('RC9_REQUIRED','Live integration requires trusted authorize, BackupManager and shared ledger; no model-supplied approval is accepted');
  const snapshot=backupManager?rc9SnapshotProvider(backupManager):await fixtureSnapshotProvider(root,stateDir);
  // Integrated mode is already guarded by the RC broker's PID+birth lease.
  // A second stale timer would reject a legitimate immediate crash recovery.
  const release=config.mode==='rc9-integrated'?async()=>{}:await lockfile.lock(stateDir,{lockfilePath:path.join(stateDir,'engine-instance.lock'),stale:30000,update:5000,retries:0});
  const file=await YFileEngine.create(root,{snapshot}),terminal=new YTerminalEngine({root,stateDir,allowedExecutables:config.allowedExecutables,authorizeExecutable:config.mode==='rc9-integrated'?config.authorizeExecutable:undefined,prepareExecutable:config.mode==='rc9-integrated'?config.prepareExecutable:undefined,maxOutputBytes:2*1024*1024,currentOwner});
  const search=new YSearchEngine(file),browser=new YBrowserFacade({stateDir,...config.browser,currentOwner}),desktop=new YDesktopEngine({stateDir,allowedPids:config.desktopAllowedPids??[],protectedPaths:config.agentProtectedRoots??[],currentOwner}),system=new YSystemEngine({stateDir,physicalDisks:config.physicalDisks}),jobs=new DurableJobs({terminal,stateDir,python:config.python,pythonArgs:config.pythonArgs,ingressId:config.ingressId});
  // Live service: listen for the paired browser extension from the start (see
  // YExtensionBrowser.prestart); fixtures never open the relay port.
  if(config.mode==='rc9-integrated')browser.existing.prestart();
  const extensions=new BrowserExtensions({stateDir,root,currentOwner});
  const ledger=outerLedger??new EngineLedger(stateDir),table=new Map();
  const add=(name,shape,handler,{mutating=false,openWorld=false,description=name}={})=>{
    const schema=z.object({...shape,requestKey:z.string().max(120).optional(),...(config.mode==='rc9-integrated'?{outputToken:z.string().max(128).optional()}:{})}).strict();
    table.set(name,{name,title:'YGPT Local · '+name,description:'YGPT Local: '+description,inputSchema:z.toJSONSchema(schema,{target:'draft-07',io:'input'}),annotations:{readOnlyHint:!mutating,destructiveHint:mutating,idempotentHint:!mutating,openWorldHint:openWorld},parse:a=>schema.parse(a),handler,mutating});
  };
  add('y_ping',{},async()=>({...identity,processId:process.pid,mode:config.mode,scope:root,rc9Protection:!!backupManager,modules:['file','terminal','search','browser','desktop','system'],chatgptConnected:false,tunnelCreated:false}));
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
  add('y_file_read_many',{paths:z.array(str).min(1).max(20),lines:z.number().int().min(1).max(2000).default(200),maxBytesPerFile:z.number().int().min(1024).max(1048576).default(262144)},async a=>{
    const files=[];for(const p of a.paths){try{const r=await file.read(p,{lines:a.lines,maxBytes:a.maxBytesPerFile});files.push({path:r.path,ok:true,content:r.content,sha256:r.sha256,totalLines:r.totalLines,remainingLines:r.remainingLines});}catch(e){files.push({path:p,ok:false,error:{code:e.code??'READ_FAILED',message:String(e.message).slice(0,300)}});}}
    return {files,succeeded:files.filter(f=>f.ok).length,failed:files.filter(f=>!f.ok).length};
  },{description:'Read several text files in one call: per-file byte/line limits, a failure in one file never fails the batch, SHA-256 per file'});
  add('y_file_patch',{path:str,expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),hunks:z.array(z.object({oldText:z.string().min(1).max(1048576),newText:z.string().max(1048576),count:z.number().int().min(1).max(1000).optional()}).strict()).min(1).max(50),dryRun:z.boolean().default(false)},async a=>{
    const target=await file.resolve(a.path);const data=await file.boundedBytes(target,8*1024*1024);
    const before=sha256(data);if(before!==a.expectedSha256)throw new EngineError('STALE_PREIMAGE','Target changed since inspection');
    let content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
    for(const [i,h] of a.hunks.entries()){const occurrences=content.split(h.oldText).length-1;
      if(occurrences===0)throw new EngineError('PATCH_NOT_FOUND','Hunk '+(i+1)+' text not found');
      if(h.count!==undefined&&occurrences!==h.count)throw new EngineError('PATCH_MISMATCH','Hunk '+(i+1)+' expected '+h.count+' occurrence(s), found '+occurrences);
      content=content.split(h.oldText).join(h.newText);}
    const afterBytes=Buffer.from(content,'utf8');
    if(a.dryRun)return {path:target,dryRun:true,beforeSha256:before,afterSha256:sha256(afterBytes),hunksApplied:a.hunks.length,bytesBefore:data.length,bytesAfter:afterBytes.length};
    const written=await file.atomicWrite(a.path,content,{expectedSha256:before});
    return {path:target,beforeSha256:before,afterSha256:written.sha256,snapshotId:written.snapshotId,hunksApplied:a.hunks.length,bytes:afterBytes.length};
  },{mutating:true,description:'Apply exact text hunks to one file, guarded by the expectedSha256 from your last read; atomic write with a pre-write snapshot; dryRun previews the resulting SHA without writing'});
  add('y_project_inspect',{path:str.default('.'),maxEntries:z.number().int().min(1).max(500).default(200)},async a=>{
    const dir=await file.resolve(a.path);const info=await fs.stat(dir);if(!info.isDirectory())throw new EngineError('NOT_DIRECTORY','Project inspection target is not a directory');
    const entries=[];let truncated=false;
    const walk=async(rel,depth)=>{if(entries.length>=a.maxEntries){truncated=true;return;}
      let items;try{items=await fs.readdir(path.join(dir,rel),{withFileTypes:true});}catch{return;}
      items.sort((x,y)=>x.name.localeCompare(y.name));
      for(const it of items){if(entries.length>=a.maxEntries){truncated=true;break;}
        if(['node_modules','.git'].includes(it.name))continue;
        const r=rel?rel+'/'+it.name:it.name;
        if(it.isDirectory()){entries.push({path:r,type:'directory'});if(depth<3)await walk(r,depth+1);}
        else if(it.isFile()){let size=null;try{size=(await fs.stat(path.join(dir,r))).size;}catch{}entries.push({path:r,type:'file',size});}}};
    await walk('',0);
    const manifests={};
    for(const name of ['package.json','pyproject.toml','Cargo.toml','go.mod']){try{const raw=await fs.readFile(path.join(dir,name),'utf8');manifests[name]=name==='package.json'?(()=>{try{const j=JSON.parse(raw);return {name:j.name??null,scripts:Object.keys(j.scripts??{})};}catch{return {present:true};}})():{present:true};}catch{}}
    let git=null;const gitExe=(config.allowedExecutables??[]).find(x=>/git(?:\.exe)?$/i.test(String(x)));
    if(gitExe){const run=async args=>{const {stdout}=await execFileP(gitExe,['-C',dir,...args],{timeout:5000,windowsHide:true,maxBuffer:65536});return stdout.trim();};
      try{if(await run(['rev-parse','--is-inside-work-tree'])==='true'){const [branch,status,log]=await Promise.all([run(['branch','--show-current']).catch(()=>''),run(['status','--porcelain=v1']).catch(()=>''),run(['log','--oneline','-5']).catch(()=>'' )]);git={branch:branch||null,dirtyLines:status?status.split('\n').length:0,status:status?status.split('\n').slice(0,50):[],recentCommits:log?log.split('\n'):[]};}}catch{git=null;}}
    return {path:dir,entries,truncated,manifests,git};
  },{description:'One bounded read of a project: directory structure, package manifests and read-only Git state (branch, dirty summary, recent commits)'});
  add('y_search_text',{directory:str.default('.'),pattern:str,regex:z.boolean().default(false),caseSensitive:z.boolean().default(true),glob:str.optional(),offset:z.number().int().min(0).max(5000).default(0),maxMatches:z.number().int().min(1).max(2000).default(100)},a=>search.findText(a.directory,a.pattern,a));
  add('y_search_files',{directory:str.default('.'),pattern:str.default('*'),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(1000).default(100)},a=>search.findFiles(a.directory,a.pattern,a));
  add('y_process_run',processSpec,a=>terminal.run(a),{mutating:true});
  add('y_process_start',processSpec,a=>terminal.start(a),{mutating:true});
  add('y_process_poll',{sessionId:sid,offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(65536).default(65536)},a=>terminal.poll(a.sessionId,a));
  add('y_process_input',{sessionId:sid,text:z.string().max(65536),end:z.boolean().default(false)},a=>terminal.input(a.sessionId,a.text,a),{mutating:true});
  add('y_process_cancel',{sessionId:sid},a=>terminal.cancel(a.sessionId),{mutating:true});
  add('y_process_list',{},()=>terminal.list());
  // A durable job is for long work: default 30 minutes, up to 24 hours.
  add('y_job_submit',{...processSpec,timeoutMs:z.number().int().min(100).max(86400000).default(1800000),id:sid},a=>jobs.submit(a),{mutating:true});
  add('y_job_status',{id:sid},a=>jobs.status(a.id));add('y_job_logs',{id:sid},a=>jobs.logs(a.id));add('y_job_cancel',{id:sid},a=>jobs.cancel(a.id),{mutating:true});add('y_job_list',{},()=>jobs.list());
  add('y_browser_open',{url:str,target:z.enum(['isolated','existing']).optional(),keepAlive:z.boolean().default(false)},a=>browser.open(a.url,{target:a.target,keepAlive:a.keepAlive}),{mutating:true,openWorld:true,description:'Open a page. Ask the owner which browser to use when it matters: target=existing works in their daily Chrome/Edge through the YGPT extension (attach first with y_browser_attach); with no preference answer, omit target — the isolated browser is the default. Isolated calls close and delete their browser immediately after returning the snapshot. For an explicit multi-step browser task use keepAlive=true, then y_browser_close; a 30-second idle lease also releases abandoned contexts'});
  add('y_browser_attach',{action:z.enum(['attach','profiles']).default('attach'),instance:z.string().max(160).optional()},a=>browser.attach(a),{mutating:true,openWorld:true,description:'Select the owner daily Chrome/Edge profile through the paired YGPT extension. Retain the returned contextToken and include it on the profile choice and every subsequent browser call, including open with target=existing and detach. If several profiles are paired, needsChoice lists exact instance ids, profile labels and emails; ask which account to use and never guess. Each chat keeps its own selection and different profiles can work concurrently. Work stays inside the YGPT background tab group; personal tabs are never read and detach leaves the browser running'});
  add('y_browser_detach',{},()=>browser.detach(),{description:'Release this chat\'s tabs in the owner daily browser (they stay open in the YGPT group for a later attach). The shared connection closes when no other chat still uses it; the browser itself is never closed'});
  add('y_browser_tabs',{},()=>browser.list());
  add('y_browser_extensions',{action:z.enum(['status','list','install','reload','trigger','uninstall','close']).default('status'),target:z.enum(['existing','developer']).default('existing'),id:z.string().regex(/^[a-p]{32}$/).optional(),extensionPath:str.optional()},a=>extensions.run(a),{mutating:true,openWorld:true,description:'Unified browser extension lifecycle through the bundled official Chrome DevTools adapter: status, list, install an unpacked path, reload a specific extension ID, trigger its action, uninstall or close the adapter. No desktop clicks. target=existing requires the owner to enable and personally confirm Chrome remote debugging once at chrome://inspect/#remote-debugging; Chrome controls that connection/profile independently of the YGPT daily-profile relay, so never assume an account match. Do not auto-switch to another profile. target=developer explicitly creates a separate private headless Chrome development session for this chat. Telemetry/CrUX disabled; no Chrome Use upgrade or profile copy. Installation/uninstallation is reviewed in Standard mode; reload and diagnostics reuse the current permission.'});
  add('y_browser_snapshot',{tabId:sid},a=>browser.snapshot(a.tabId));
  add('y_browser_navigate',{tabId:sid,url:str},a=>browser.navigate(a.tabId,a.url),{mutating:true,openWorld:true});
  add('y_browser_action',{tabId:sid,action:z.enum(['click','fill','press','select','check']),target:locator,value:z.union([z.string().max(10000),z.boolean()]).optional()},a=>browser.act(a.tabId,a.action,a.target,a.value),{mutating:true,openWorld:true});
  add('y_browser_wait',{tabId:sid,target:locator,text:z.string().max(500).optional(),state:z.enum(['visible','hidden','attached','detached']).default('visible'),timeoutMs:z.number().int().min(100).max(15000).default(10000)},a=>browser.wait(a.tabId,a.target,a));
  add('y_browser_debug',{tabId:sid,action:z.enum(['status','console','network','clear','evaluate','cdp']).default('status'),expression:z.string().max(20000).optional(),method:z.string().max(100).optional(),params:z.record(z.string(),z.unknown()).default({}),limit:z.number().int().min(1).max(200).default(50)},async a=>({...await browser.debug(a.tabId,a),transientObservation:true}),{mutating:true,openWorld:true,description:'Deep debug this chat-owned browser tab without desktop input: bounded in-memory console/network records, JavaScript evaluate, and tab-scoped CDP commands. Start with status before reproducing a bug; logs collect only after the tab is tracked, omit headers/query strings, and disappear on close. status starts CDP network capture; network requestIds can be used with Network.getResponseBody. CDP is limited to page domains; Browser and Target domains are not exposed. evaluate may change page state; a timed-out expression is never replayed.'});
  add('y_browser_screenshot',{tabId:sid},a=>browser.screenshot(a.tabId));
  add('y_browser_download',{tabId:sid,target:locator},a=>browser.download(a.tabId,a.target),{mutating:true,openWorld:true});
  add('y_browser_close',{tabId:sid},a=>browser.closeTab(a.tabId),{mutating:true});
  add('y_desktop_windows',{},()=>desktop.windows());
  add('y_desktop_bind',{hwnd:str},a=>desktop.bind(a.hwnd));
  add('y_desktop_inspect',{targetId:sid,diagnostics:z.boolean().default(false),...selector,maxDepth:z.number().int().min(1).max(64).default(32),maxNodes:z.number().int().min(1).max(1200).default(600)},a=>desktop.act(a.targetId,a.diagnostics?'diagnose':'tree',a),{description:'Read the owned window control tree, or set diagnostics=true for input-desktop availability, foreground status, held modifiers and source/target integrity without changing focus or injecting input. Reports depth/node limits honestly. For browser extension work prefer y_browser_extensions; do not re-request approval for native Windows input failures.'});
  add('y_desktop_value',{targetId:sid,...selector},a=>desktop.act(a.targetId,'value',a));
  add('y_desktop_action',{targetId:sid,action:z.enum(['focus','setValue','invoke','click','type','keys']),...selector,value:z.string().max(10000).optional()},a=>desktop.act(a.targetId,a.action,a),{mutating:true,openWorld:true,description:'Control a chat-owned window after one temporary Full Access approval. Read current selectors with y_desktop_inspect. keys uses value such as CTRL+L, CTRL+T or ENTER without a selector. Browser invoke uses a verified pointer click without attempting UIA invoke first. Native failures report precise codes; do not re-execute an outcomeUnknown action.'});
  add('y_desktop_screenshot',{targetId:sid},a=>desktop.capture(a.targetId));
  add('y_system_inspect',{kind:z.enum(['health','processes','services','events','autostarts','disks','physical-disks']).default('health')},a=>system.inspect(a.kind));

  return {identity,file,terminal,search,browser,extensions,desktop,system,jobs,ledger,
    tools(){return [...table.values()].map(({parse,handler,mutating,...tool})=>tool);},
    async invoke(name,args={}){
      let operation;try{const t=table.get(name);if(!t)throw new EngineError('NO_TOOL','Unknown YGPT Local tool');const parsed=t.parse(args),{requestKey,...a}=parsed;
        const decision=authorize?await authorize({tool:name,args:a,mutating:t.mutating,openWorld:t.annotations?.openWorldHint,root}):{allowed:config.mode==='fixture'};
        if(decision?.allowed!==true)throw new EngineError(decision?.code??/^(TARGET_FOREIGN|SESSION_FOREIGN)\b/.exec(decision?.reason??'')?.[1]??'RC9_BLOCKED',decision?.reason??'Outer policy did not authorize this exact operation');
        operation=ledger.begin(name,a,name==='y_browser_wait'?undefined:requestKey);if(operation.reused)return operation.result;
        const result=await t.handler(a),processError=name==='y_process_run'&&result.state!=='succeeded'||name==='y_browser_extensions'&&result.ok===false,response={product:'YGPT Local',callId:operation.id,ok:!processError,result,...(processError?{error:{code:result.code??'PROCESS_EXIT_FAILED',message:result.details??('Process ended with state '+result.state+' and exit code '+result.exitCode)}}:{})};ledger.finish(operation.id,response);return response;
      }catch(e){const outcomeUnknown=e.outcomeUnknown===true||['UIA_TIMEOUT','JOB_CONTROL_TIMEOUT'].includes(e.code)||e.name==='TimeoutError';const response={product:'YGPT Local',callId:operation?.id??null,ok:false,error:{code:e.code??(outcomeUnknown?'RESULT_UNKNOWN':'EXECUTION_FAILED'),message:String(e.message).slice(0,1000),...(e.hresult?{hresult:e.hresult}:{}),...(e.action?{action:e.action}:{}),...(e.inputDiagnostics?{inputDiagnostics:e.inputDiagnostics}:{}),...(e.effectStarted===false?{effectStarted:false}:{}),...(outcomeUnknown?{outcomeUnknown:true}:{})}};if(operation&&!operation.reused)ledger.finish(operation.id,response);return response;}
    },
    async close(){await Promise.allSettled([terminal.close(),browser.close(),extensions.close()]);if(!outerLedger)ledger.close();await release();}
  };
}
