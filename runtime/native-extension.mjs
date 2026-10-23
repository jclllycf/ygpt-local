import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {createRc9EngineExtension} from '../engine/src/rc9-integration.mjs';
import {config} from './config.mjs';
import {isReadOnlyInvocation} from './read-only-policy.mjs';
import {authorize,canonical,route,within,highRiskCommand,argvRiskText,projectRoots} from './access-policy.mjs';
import {currentOwner,currentCall} from './ownership.mjs';
import {diskInspect,deviceFingerprint} from './safe-actions.mjs';
import {uiaDecision,uiaPresentation,uiaChatScope,windowIdentity} from '../engine/src/uia-consent.mjs';

const allow=reason=>({decision:'allow',reason}),hold=reason=>({decision:'approve',kind:'capability',reason}),deny=reason=>({decision:'deny',reason});
export function authorizeNative(intent){
  const n=intent.tool,a=intent.args??{};
  if(!/^y_(?:file_|search_|project_|process_|job_|browser_|desktop_|system_)/.test(n))return authorize(n,a);
  if(n.startsWith('y_browser_')){
    // Owner blacklist (rc.13): any http/https destination is allowed unless
    // the owner blocklisted it; the engine still enforces tab ownership and
    // download bounds. Interaction holds only in the owner's opt-in
    // non-default-allow configuration.
    if(['y_browser_action','y_browser_download'].includes(n))return config.blacklistDefaultAllow?allow('Owner default-allow browser interaction; engine destination blacklist and tab ownership checks still apply'):hold('Browser interaction requires an owner-enrolled workflow origin');
    return allow('YGPT browser (isolated by default, or the owner existing browser after y_browser_attach); destination blacklist applies');
  }
  // UIA stays available; binding and every input/focus action need a human decision.
  if(n.startsWith('y_desktop_'))return uiaDecision(n)??hold('Unclassified desktop capability: '+n);
  if(['y_system_inspect','y_process_list'].includes(n))return allow('Fixed read-only diagnostics or this chat\'s process inventory');
  if(n==='y_project_inspect'){const t=route(a.path??'');if(t.permission==='private'||t.permission==='vault'||t.sensitive)return hold('Project inspection target is protected or credential-adjacent: a verified owner decision is required');return allow('Read-only project structure, manifest and Git inspection');}
  if(['y_process_run','y_process_start','y_job_submit'].includes(n)){
    if(config.readOnlyAutoAllow&&isReadOnlyInvocation(a))return allow('Parsed read-only PowerShell invocation; no approval');
    const cwd=a.cwd??projectRoots[0];
    const decision=authorize('job_submit',{cwd,argv:[a.executable,...(a.args??[])]});
    if(decision.decision!=='allow')return decision;
    if(highRiskCommand(argvRiskText([a.executable,...(a.args??[])])))return hold('Destructive or privileged executable arguments require verified host review');
    return allow('Pinned executable, enrolled project cwd, current user; bounded pre-write coverage');
  }
  if(['y_process_poll','y_process_input','y_process_cancel','y_job_status','y_job_logs','y_job_cancel','y_job_list'].includes(n))return allow('Private ingress, engine-owned sessions and durable owner-scoped job IDs only');
  return hold('Unclassified native capability: '+n+' — instead of a blanket refusal, a verified owner decision is required');
}

export async function createNativeExtension({backups,ledger,protectState}){
  const root=config.engineRoot??path.parse(config.projectRoots[0]).root;
  let engine;
  const approvedInvocation=new AsyncLocalStorage();
  const invocationScope=new AsyncLocalStorage();
  const processTools=new Set(['y_process_run','y_process_start','y_job_submit']);
  const authorizeExecutable=async spec=>{
    const invocation=invocationScope.getStore();
    if(!invocation||!processTools.has(invocation.name))return false;
    const a=invocation.args;
    if(canonical(spec.executable)!==canonical(a.executable)||JSON.stringify(spec.args)!==JSON.stringify(a.args??[])||canonical(spec.cwd)!==canonical(a.cwd??root))return false;
    const approved=approvedInvocation.getStore()?.tool===invocation.name;
    if(!approved&&(!config.blacklistDefaultAllow||authorizeNative({tool:invocation.name,args:a}).decision!=='allow'))return false;
    const file=fs.statSync(spec.executable);
    return file.isFile();
  };
  const interactive=new Set(config.browser.interactiveOrigins??['http://127.0.0.1','http://localhost']);
  const authorizeOperation=async(intent,request)=>{
    // Only the broker enters this scope after atomically claiming an exact
    // reviewed operation. No tool argument or request metadata can create it.
    const reviewed=approvedInvocation.getStore();
    if(reviewed&&reviewed.tool===request.tool)return allow('Exact operation claimed by the broker after app capability consent');
    const tokenNames=['y_job_logs','y_job_cancel','y_process_poll','y_process_input','y_process_cancel'];
    if(tokenNames.includes(intent.tool)){
      const a=request.args,kind=intent.tool.startsWith('y_job_')?'job':'session',id=kind==='job'?a.id:a.sessionId;
      if(!ledger.owns(kind,id,a.outputToken))return deny('Missing, foreign or stale outputToken for this task/session');
      if(intent.tool==='y_process_input'&&highRiskCommand(a.text??''))return hold('Sensitive process stdin requires verified host review');
      return ledger.owns(kind,id,a.outputToken)?allow('Original call output capability verified'):deny('Missing, foreign or stale outputToken for this task/session');
    }
    if(intent.tool==='y_browser_action'||intent.tool==='y_browser_download'){
      let url;try{url=new URL(engine.browser.page(request.args.tabId).url());}catch(e){return {...deny(e.message||'Unknown owned browser tab'),...(e.code?{code:e.code}:{})};}
      if(config.blacklistDefaultAllow){
        try{engine.browser.validateUrl(url.href);}catch(e){return deny(e.message);}
        return allow('Owner default-allow interaction in an owned isolated tab; destination and download bounds remain enforced');
      }
      // Loopback's ephemeral fixture port is allowed only when the exact host
      // is enrolled. External sites require an exact scheme+host+port origin.
      if(!interactive.has(url.origin)&&!(interactive.has(url.protocol+'//'+url.hostname)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))return hold('External irreversible browser effects require verified human consent or exact owner workflow');
      return allow('Owner-enrolled interactive origin; external side effects are not Git backed up');
    }
    return authorizeNative(intent);
  };
  engine=await createRc9EngineExtension({config:{mode:'rc9-integrated',root,stateDir:config.stateDir,legacyTools:false,python:config.python,pythonArgs:config.pythonArgs,ingressId:config.ingressId,
    allowedExecutables:[process.execPath,config.python,config.executables.git,path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),path.join(process.env.SystemRoot,'System32/cmd.exe')].filter(Boolean),
    browser:config.browser,authorizeExecutable,currentOwner,currentCall,agentProtectedRoots:config.agentProtectedRoots,
    // Read-only physical disk/partition inventory (was y_disk_inspect).
    physicalDisks:async()=>(await diskInspect()).map(d=>({...d,fingerprint:deviceFingerprint(d)}))},authorizeOperation,backupManager:backups,operationLedger:ledger,protectState});
  const invokeWithPolicy=engine.invoke.bind(engine);
  engine.invoke=(name,args)=>invocationScope.run({name,args},()=>invokeWithPolicy(name,args));
  if(config.readOnlyAutoAllow){
    // Read-only calls may resolve any owner-authorized local drive. Keep the
    // engine's original root/reparse restrictions for every mutating call.
    // AsyncLocalStorage prevents parallel reads from widening a writer's scope.
    const reads=new Set(['y_file_read','y_file_read_bytes','y_file_info','y_file_list','y_search_text','y_search_files']);
    const readScope=new AsyncLocalStorage(),resolve=engine.file.resolve.bind(engine.file),invoke=engine.invoke.bind(engine);
    engine.file.resolve=async input=>{
      if(!readScope.getStore())return resolve(input);
      const value=canonical(path.resolve(root,input));return /^[a-z]:$/i.test(value)?value+'\\':value;
    };
    engine.invoke=(name,args)=>readScope.run(reads.has(name),()=>invoke(name,args));
  }
  // The engine only reaches bind after the broker claimed a human-approved
  // request for this exact window identity (see binding()). No enrollment
  // list can turn that reviewed operation into a permanent policy refusal.
  const rawBind=engine.desktop.bind.bind(engine.desktop);
  engine.desktop.bind=async hwnd=>{
    const win=await engine.desktop.window(hwnd);
    engine.desktop.enrollFromBroker(win.pid,win.birth);
    return rawBind(hwnd);
  };
  // Window identity for approval binding and the card: exe path + SHA-256 + PID
  // + process birth + hwnd. Bound targets keep the identity approved at bind.
  const desktopWindow=async(name,args)=>{
    if(name==='y_desktop_bind'){const win=await engine.desktop.window(args.hwnd);return {...win,executableSha256:win.executablePath?await engine.desktop.executableDigest(win.executablePath).catch(()=>null):null};}
    if(name.startsWith('y_desktop_')&&args.targetId)return engine.desktop.target(args.targetId);
    return null;
  };
  return {engine,authorizeOperation,
    invokeApproved:(name,args)=>approvedInvocation.run({tool:name},()=>engine.invoke(name,args)),
    async binding(name,args){
      if(name==='y_desktop_bind'||name==='y_desktop_action')return {window:windowIdentity(await desktopWindow(name,args))};
      if(name.startsWith('y_browser_')&&args.tabId)return {tabId:args.tabId,url:engine.browser.page(args.tabId).url()};
      if(processTools.has(name)){
        const files=[args.executable,...(args.args??[]).filter(a=>typeof a==='string'&&path.isAbsolute(a)&&/\.(?:mjs|cjs|js|ps1|py|cmd|bat)$/i.test(a))];
        return {files:files.map(p=>({path:canonical(p),sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')}))};
      }
      return null;
    },
    // Approval card content for capabilities that need more than the arguments.
    async presentation(name,args){return name.startsWith('y_desktop_')?uiaPresentation(name,args,await desktopWindow(name,args)):null;},
    // Narrow conversation grant for UIA; null means the broker's default rules.
    chatScope(name,args){
      if(!name.startsWith('y_desktop_'))return null;
      let win=null;try{if(args.targetId)win=engine.desktop.target(args.targetId);}catch{}
      return uiaChatScope(name,args,win);
    },
    tools:()=>engine.tools().filter(t=>t.name!=='y_ping').map(t=>{
      if(!['y_job_logs','y_job_cancel','y_process_poll','y_process_input','y_process_cancel'].includes(t.name))return t;
      return {...t,inputSchema:{...t.inputSchema,properties:{...t.inputSchema.properties,outputToken:{type:'string',minLength:32,maxLength:128}},required:[...new Set([...(t.inputSchema.required??[]),'outputToken'])]}};
    }),
    async authorize(name,args){
      const {rc9Intents}=await import('../engine/src/rc9-integration.mjs');
      for(const intent of rc9Intents({tool:name,args,root,mutating:true})){const decision=await authorizeOperation(intent,{args});if(decision.decision!=='allow')return decision;}
      return allow('All typed native intents authorized');
    },
    async launchFixture(){
      const exe=fileURLToPath(new URL('../engine/build/YDesktop.exe',import.meta.url));
      const hash=createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
      if(!config.desktopAllowedApps.some(r=>canonical(r.path)===canonical(exe)&&r.sha256===hash))throw Error('Fixture executable not enrolled by owner');
      const p=spawn(exe,['--fixture','RC10'],{stdio:'ignore',windowsHide:false});
      await new Promise((resolve,reject)=>{p.once('spawn',resolve);p.once('error',reject);});
      return {pid:p.pid,fixture:true,product:'YGPT Local'};
    }
  };
}
