// Portable unit tests for the chat-only isolation upgrade. They exercise the
// real modules with injected fakes (vault, UIA helper, browser launcher) and
// run on Linux and Windows. They are NOT a ChatGPT host or Windows UIA test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync as spawnSyncRaw} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DurableLedger,contextLabel,CONTEXT_IDLE_MS} from '../runtime/durable.mjs';
import {resourceIntent,ownershipViolation,callScope,currentOwner} from '../runtime/ownership.mjs';
import {agentPath,agentCommandSignal,classifyWindow,assertIsolatedBrowserConfig,agentToolBoundary as agentBoundary} from '../engine/src/agent-protection.mjs';
import {YDesktopEngine} from '../engine/src/desktop-engine.mjs';

const spawnSyncOk=cmd=>spawnSyncRaw(cmd,['--version'],{encoding:'utf8'}).status===0;
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-upgrade-'));
const fakeVault={seal:v=>'test:'+Buffer.from(String(v)).toString('base64'),open:v=>Buffer.from(v.slice(5),'base64').toString('utf8')};
const newLedger=(dir=tmp())=>({dir,ledger:new DurableLedger(path.join(dir,'ops.sqlite3'),{owner:'test-owner',vault:fakeVault})});

test('Chat contexts are server-issued, sliding and revocable; an unknown token is refused',()=>{
  const {ledger}=newLedger();
  const a=ledger.context();assert.match(a.token,/^[0-9a-f]{64}$/);assert.ok(a.expires-Date.now()<=CONTEXT_IDLE_MS);
  assert.equal(ledger.context(a.token).hash,a.hash);
  assert.throws(()=>ledger.context('f'.repeat(64)),e=>e.code==='CONTEXT_EXPIRED');
  ledger.closeContext(a.token);assert.throws(()=>ledger.context(a.token),e=>e.code==='CONTEXT_EXPIRED');
  ledger.close();
});

test('Idempotency keys are scoped per chat context: same key in two chats is two operations, never a replay',()=>{
  const {ledger}=newLedger();const a=ledger.context(),b=ledger.context();
  const args={path:'C:\\work\\same.txt',content:'x'};
  const first=ledger.create('y_file_write',args,{contextHash:a.hash},{idempotencyKey:'write-1'});
  const other=ledger.create('y_file_write',args,{contextHash:b.hash},{idempotencyKey:'write-1'});
  assert.equal(first.reused,false);assert.equal(other.reused,false);assert.notEqual(first.operation.id,other.operation.id);
  const again=ledger.create('y_file_write',args,{contextHash:a.hash},{idempotencyKey:'write-1'});
  assert.equal(again.reused,true);assert.equal(again.operation.id,first.operation.id);
  assert.throws(()=>ledger.create('y_file_write',{...args,content:'y'},{contextHash:a.hash},{idempotencyKey:'write-1'}),/different arguments/);
  ledger.close();
});

test('A chat cannot use another chat\'s job even with its ID; unattributed legacy jobs keep the token-only rule',()=>{
  const {ledger}=newLedger();const a=ledger.context(),b=ledger.context();
  ledger.own('job','11111111-1111-4111-8111-111111111111',a.hash,'y_job_submit');
  const cancel=resourceIntent('y_job_cancel',{id:'11111111-1111-4111-8111-111111111111'});
  assert.equal(ownershipViolation(ledger,'y_job_cancel',cancel,a.hash),null);
  const denied=ownershipViolation(ledger,'y_job_cancel',cancel,b.hash);
  assert.equal(denied.code,'SESSION_FOREIGN');assert.equal(denied.executed,false);
  assert.equal(ownershipViolation(ledger,'y_job_cancel',cancel,null).code,'SESSION_FOREIGN');
  assert.throws(()=>ledger.own('job','11111111-1111-4111-8111-111111111111',b.hash),e=>e.code==='SESSION_FOREIGN');
  assert.equal(ownershipViolation(ledger,'y_job_status',resourceIntent('y_job_status',{id:'22222222-2222-4222-8222-222222222222'}),b.hash),null);
  assert.deepEqual(ledger.foreignCounts(b.hash),{job:1});
  // Engines enforce volatile kinds; the broker does not second-guess them.
  assert.equal(ownershipViolation(ledger,'y_browser_snapshot',resourceIntent('y_browser_snapshot',{tabId:'t'}),b.hash),null);
  ledger.close();
});

test('Volatile ownership rows do not survive a bridge restart; durable job ownership does',()=>{
  const {dir,ledger}=newLedger();const a=ledger.context();
  ledger.own('job','33333333-3333-4333-8333-333333333333',a.hash);ledger.own('search','search_1',a.hash);ledger.close();
  const reopened=new DurableLedger(path.join(dir,'ops.sqlite3'),{owner:'test-owner',vault:fakeVault});
  assert.equal(reopened.ownerOf('job','33333333-3333-4333-8333-333333333333'),a.hash);
  assert.equal(reopened.ownerOf('search','search_1'),null);
  reopened.close();
});

test('Call provenance records a short context label and transport, never the token',()=>{
  const {ledger}=newLedger();const a=ledger.context();
  const id=ledger.callStart('y_file_read',null,{context:a.hash,transport:'secure-tunnel-stdio'});
  ledger.callFinish(id,'failed',{structuredContent:{code:'STALE_PREIMAGE'}});
  const [row]=ledger.calls(5);
  assert.equal(row.context_label,contextLabel(a.hash));assert.equal(row.transport,'secure-tunnel-stdio');
  assert.ok(!JSON.stringify(ledger.calls(5)).includes(a.token));
  assert.equal(ledger.usageRows(0)[0].error_code,'STALE_PREIMAGE');
  ledger.close();
});

test('Agent boundary: Agent program/state folders and Agent process control are TARGET_FOREIGN',()=>{
  assert.equal(agentPath('c:\\users\\example\\appdata\\local\\packages\\openai.chatgpt-desktop_abc\\localstate\\x'),true);
  assert.equal(agentPath('c:\\program files\\windowsapps\\openai.chatgpt-desktop_1.0_x64__x\\app\\chatgpt.exe'),true);
  assert.equal(agentPath('c:\\users\\example\\.codex\\sessions\\1.jsonl'),true);
  assert.equal(agentPath('d:\\ai\\projects\\codex-notes\\readme.md'),false);
  assert.match(agentCommandSignal('Stop-Process -Name ChatGPT -Force'),/Agent/);
  assert.match(agentCommandSignal('taskkill /IM codex.exe /F'),/Agent/);
  assert.match(agentCommandSignal('Get-Process chatgpt | Stop-Process'),/Agent/);
  assert.equal(agentCommandSignal('npm test'),null);
  assert.equal(agentCommandSignal('Get-Content C:\\Users\\Example\\.codex\\config.toml'),null,'.codex reads keep the existing review signal');
  assert.match(agentBoundary('write_file',{path:'C:\\Users\\Example\\AppData\\Local\\OpenAI\\state.json'}),/^TARGET_FOREIGN/);
  assert.match(agentBoundary('move_file',{source:'C:\\Users\\Example\\AppData\\Roaming\\ChatGPT\\a',destination:'D:\\work\\a'}),/^TARGET_FOREIGN/);
  assert.match(agentBoundary('job_submit',{cwd:'D:\\work',argv:['C:\\Windows\\System32\\taskkill.exe','/IM','ChatGPT.exe']}),/^TARGET_FOREIGN/);
  assert.equal(agentBoundary('write_file',{path:'D:\\work\\notes.txt'}),null);
});

test('Window classification shields the Agent, its process tree and unverifiable identities',()=>{
  assert.equal(classifyWindow({process:'notepad',executablePath:'C:\\Windows\\notepad.exe'}).protected,false);
  assert.equal(classifyWindow({process:'ChatGPT',executablePath:'C:\\x\\ChatGPT.exe'}).reason,'AGENT_PROCESS');
  assert.equal(classifyWindow({process:'msedge',executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',ancestors:[{process:'ChatGPT',executablePath:'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT-Desktop_1\\app\\ChatGPT.exe'}]}).protected,true);
  assert.equal(classifyWindow({process:'app',executablePath:'C:\\a\\app.exe',signer:'CN=OpenAI, O=OpenAI, L=San Francisco'}).reason,'AGENT_SIGNER');
  assert.equal(classifyWindow({process:'secure',executablePath:null}).reason,'IDENTITY_UNVERIFIED');
  assert.equal(classifyWindow({process:'x',executablePath:'C:\\x.exe',protected:true,protectedReason:'AGENT_OWNED_WINDOW'}).reason,'AGENT_OWNED_WINDOW');
});

test('Browser configuration cannot attach to an existing browser, profile or debugging port',()=>{
  assert.equal(assertIsolatedBrowserConfig({headless:true,allowedHosts:['127.0.0.1']}),true);
  for(const bad of [{cdpUrl:'http://127.0.0.1:9222'},{userDataDir:'C:\\Users\\Example\\AppData\\Local\\Google\\Chrome\\User Data'},{args:['--remote-debugging-port=9222']}])
    assert.throws(()=>assertIsolatedBrowserConfig(bad),e=>e.code==='TARGET_FOREIGN');
});

// A fake YDesktop helper: answers the JSON protocol with a fixed inventory.
function fakeHelper(dir,windows){
  const file=path.join(dir,'fake-ydesktop.mjs');
  fs.writeFileSync(file,'#!/usr/bin/env node\nlet s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const w='+JSON.stringify(windows)+';process.stdout.write(JSON.stringify(r.action==="windows"?{ok:true,result:{windows:w,interactive:true}}:{ok:true,result:{action:r.action,hwnd:r.hwnd,protectedPaths:r.protectedPaths.length}}));});\n');
  fs.chmodSync(file,0o755);return file;
}
test('UIA targets belong to the binding chat; Agent windows cannot be bound',{skip:process.platform==='win32'?'fake helper uses a POSIX shebang':false},async()=>{
  const dir=tmp();let owner='ctx-a';
  const windows=[{hwnd:'100',pid:4100,process:'notepad',executablePath:'C:\\Windows\\notepad.exe',title:'notes',birth:'1'},{hwnd:'200',pid:4200,process:'ChatGPT',executablePath:'C:\\x\\ChatGPT.exe',title:'Agent task: private',birth:'2'}];
  const desktop=new YDesktopEngine({stateDir:dir,helper:fakeHelper(dir,windows),currentOwner:()=>owner,hashFile:async()=>'a'.repeat(64)});
  const list=await desktop.windows();
  const agent=list.windows.find(w=>w.hwnd==='200');assert.equal(agent.protected,true);assert.equal(agent.controllable,false);assert.ok(!JSON.stringify(agent).includes('private'));
  await assert.rejects(desktop.bind('200'),e=>e.code==='TARGET_FOREIGN');
  await assert.rejects(desktop.bind('100'),e=>e.code==='DESKTOP_NOT_ENROLLED','binding still requires the broker to approve the exact window first');
  desktop.enrollFromBroker(4100,'1');
  const {targetId}=await desktop.bind('100');
  assert.equal((await desktop.act(targetId,'tree')).result.action,'tree');
  owner='ctx-b';
  await assert.rejects(desktop.act(targetId,'tree'),e=>e.code==='SESSION_FOREIGN');
  assert.deepEqual(desktop.owned(),[]);assert.equal(desktop.foreignCount(),1);
  owner='ctx-a';desktop.release('ctx-a');assert.throws(()=>desktop.target(targetId),e=>e.code==='NO_TARGET');
});

test('The call scope carries the calling context to engines',async()=>{
  assert.equal(currentOwner(),null);
  await callScope.run({context:{hash:'h1'}},async()=>{await new Promise(r=>setTimeout(r,5));assert.equal(currentOwner(),'h1');});
});

test('A bridge never inherits another bridge\'s state pointer; the explicit config decides',async()=>{
  const {BrokerClient}=await import('../service/rpc.mjs');
  const {spawnSync}=await import('node:child_process');
  const dir=tmp(),entry=path.join(dir,'echo-entry.mjs');
  fs.writeFileSync(entry,"import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{stateDir:process.env.YGPT_STATE_DIR??null,config:process.env.YGPT_CONFIG}})+'\\n');});");
  const prior=process.env.YGPT_STATE_DIR;process.env.YGPT_STATE_DIR=path.join(dir,'someone-elses-state');
  try{const c=await new BrokerClient({entry,config:path.join(dir,'cfg.json'),cwd:dir}).start();assert.equal(c.info.stateDir,null);assert.equal(c.info.config,path.join(dir,'cfg.json'));await c.close();}
  finally{if(prior===undefined)delete process.env.YGPT_STATE_DIR;else process.env.YGPT_STATE_DIR=prior;}
  const cfg=path.join(dir,'ygpt.config.json');fs.writeFileSync(cfg,JSON.stringify({stateDir:path.join(dir,'own-state')}));
  const r=spawnSync(process.execPath,['--input-type=module','-e',"const {config}=await import(process.argv[1]);process.stdout.write(config.stateDir);",new URL('../runtime/config.mjs',import.meta.url).href],{env:{...process.env,YGPT_CONFIG:cfg,YGPT_STATE_DIR:path.join(dir,'inherited')},encoding:'utf8'});
  assert.equal(r.stdout,path.join(dir,'own-state'),r.stderr);
});

test('Durable job children do not inherit YGPT_* pointers, except the bundled download worker',{skip:!(()=>{try{return spawnSyncOk('python3');}catch{return false;}})()&&'python3 not available'},async()=>{
  const {spawnSync}=await import('node:child_process');
  const source=fs.readFileSync(new URL('../runtime/y_jobs.py',import.meta.url),'utf8');
  for(const copy of ['../runtime/y_jobs.py','../engine/src/workers/y_jobs.py'])assert.match(fs.readFileSync(new URL(copy,import.meta.url),'utf8'),/env=child_env\(argv\)/);
  const program=`import ast,os,sys\nfrom pathlib import Path\nsrc=open(sys.argv[1],encoding='utf-8').read()\nfn=[n for n in ast.parse(src).body if isinstance(n,ast.FunctionDef) and n.name=='child_env'][0]\nns={'os':os,'Path':Path,'__file__':sys.argv[1]}\nexec(compile(ast.Module([fn],[]),'child_env','exec'),ns)\nos.environ['YGPT_STATE_DIR']='s';os.environ['YGPT_CONFIG']='c';os.environ['KEEP_ME']='1'\nplain=ns['child_env'](['node','build.js'])\nworker=ns['child_env'](['node',str(Path(sys.argv[1]).resolve().parent/'download-worker.mjs')])\nprint(sorted(k for k in plain if k.startswith('YGPT_')),'KEEP_ME' in plain,worker.get('YGPT_STATE_DIR'))`;
  const r=spawnSync('python3',['-I','-c',program,fileURLToPath(new URL('../runtime/y_jobs.py',import.meta.url))],{encoding:'utf8'});
  assert.equal(r.stdout.trim(),"[] True s",r.stderr);assert.ok(source.length>0);
});

test('Credential and terminal windows are listed but never controllable',{skip:process.platform==='win32'?'fake helper uses a POSIX shebang':false},async()=>{
  const dir=tmp();
  const windows=[{hwnd:'300',pid:4300,process:'KeePass',executablePath:'C:\\Program Files\\KeePass\\KeePass.exe',title:'bank.kdbx - KeePass',birth:'3'},{hwnd:'301',pid:4301,process:'WindowsTerminal',executablePath:'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\wt.exe',title:'PowerShell',birth:'4'}];
  const desktop=new YDesktopEngine({stateDir:dir,helper:fakeHelper(dir,windows),currentOwner:()=>'ctx-a'});
  const list=(await desktop.windows()).windows;
  const keepass=list.find(w=>w.hwnd==='300'),terminal=list.find(w=>w.hwnd==='301');
  assert.equal(keepass.controllable,false);assert.equal(keepass.protectedReason,'PROTECTED_APPLICATION');assert.ok(!JSON.stringify(keepass).includes('bank'));
  assert.equal(terminal.controllable,false);assert.equal(terminal.title,'PowerShell');
  desktop.enrollFromBroker(4300,'3');
  await assert.rejects(desktop.bind('300'),e=>e.code==='PROTECTED_APPLICATION');
});

test('Engine denial codes reach the caller: TARGET_FOREIGN is not collapsed into a generic block',async()=>{
  const {createEngine}=await import('../engine/src/engine.mjs');
  const dir=tmp(),root=path.join(dir,'root');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'.ygpt-engine-fixture'),'YGPT disposable fixture\n');
  await assert.rejects(createEngine({mode:'fixture',root,stateDir:path.join(dir,'state'),browser:{userDataDir:'C:\\Users\\Example\\AppData\\Local\\Microsoft\\Edge\\User Data'}},{protectState:async()=>{}}),e=>e.code==='TARGET_FOREIGN');
  const engine=await createEngine({mode:'fixture',root,stateDir:path.join(dir,'state2'),legacyTools:false},{protectState:async()=>{},authorize:async()=>({allowed:false,reason:'TARGET_FOREIGN: Agent folders cannot be a YGPT working directory'})});
  try{const r=await engine.invoke('y_file_list',{path:'.'});assert.equal(r.ok,false);assert.equal(r.error.code,'TARGET_FOREIGN');}
  finally{await engine.close();}
});

test('UIA consent: inventory and reads of an approved window are automatic; bind and every action need a human',async()=>{
  const {uiaDecision,uiaPresentation,uiaChatScope,UIA_ACTION_GRANT_MS}=await import('../engine/src/uia-consent.mjs');
  assert.equal(uiaDecision('y_desktop_windows').decision,'allow');
  for(const t of ['y_desktop_inspect','y_desktop_value','y_desktop_screenshot'])assert.equal(uiaDecision(t).decision,'allow');
  for(const t of ['y_desktop_bind','y_desktop_action'])assert.equal(uiaDecision(t).decision,'approve');
  const win={hwnd:'100',pid:4100,process:'notepad',title:'notes.txt - Notepad',birth:'1',executablePath:'C:\\Windows\\notepad.exe',executableSha256:'a'.repeat(64)};
  const card=uiaPresentation('y_desktop_action',{targetId:'t1',action:'type',automationId:'Edit',value:'hello world'},win);
  for(const part of ['notepad','4100','notes.txt','hello world'])assert.ok(JSON.stringify(card).includes(part),part);
  assert.match(card.technical,/SHA-256: a{64}/);
  assert.equal(uiaChatScope('y_desktop_bind',{hwnd:'100'},win).eligible,false,'binding is Allow once only');
  const typing=uiaChatScope('y_desktop_action',{targetId:'t1',action:'type'},win),clicking=uiaChatScope('y_desktop_action',{targetId:'t1',action:'click'},win);
  assert.equal(typing.eligible,true);assert.equal(typing.ttlMs,UIA_ACTION_GRANT_MS);assert.notEqual(typing.key,clicking.key);
  assert.notEqual(typing.key,uiaChatScope('y_desktop_action',{targetId:'t1',action:'type'},{...win,executableSha256:'b'.repeat(64)}).key,'a different executable is a different grant');
  assert.equal(uiaChatScope('y_desktop_action',{targetId:'gone',action:'type'},null).eligible,false);
});

test('A UIA conversation grant lasts ten minutes, not the two-hour default',()=>{
  const {ledger}=newLedger();const ctx=ledger.context();
  const key='k'.repeat(64),hold=ledger.create('y_desktop_action',{targetId:'t',action:'type'},{contextHash:ctx.hash,chatScope:{eligible:true,key,ttlMs:600000},presentation:{title:'t'}});
  const before=Date.now();assert.equal(ledger.decideLocal(hold.operation.id,'chat','test').ok,true);
  const row=ledger.db.prepare('SELECT expires FROM chat_grants WHERE context_hash=? AND scope_key=?').get(ctx.hash,key);
  assert.ok(row.expires<=Date.now()+600000&&row.expires>=before+590000,String(row.expires-before));
  assert.equal(ledger.hasChatGrant(ctx.hash,key),true);
  assert.equal(ledger.hasChatGrant(ledger.context().hash,key),false,'another chat has no grant');
  ledger.close();
});

test('A bound window whose executable changes is unbound; binding refuses a changed executable',{skip:process.platform==='win32'?'fake helper uses a POSIX shebang':false},async()=>{
  const dir=tmp();let digest='a'.repeat(64);
  const windows=[{hwnd:'100',pid:4100,process:'notepad',executablePath:'C:\\Windows\\notepad.exe',title:'notes',birth:'1'}];
  const desktop=new YDesktopEngine({stateDir:dir,helper:fakeHelper(dir,windows),currentOwner:()=>'ctx-a',hashFile:async()=>digest});
  desktop.enrollFromBroker(4100,'1');
  await assert.rejects(desktop.bind('100',{executableSha256:'c'.repeat(64)}),e=>e.code==='PROCESS_IDENTITY_CHANGED');
  const {targetId,window}=await desktop.bind('100',{executableSha256:digest});assert.equal(window.executableSha256,digest);
  assert.equal((await desktop.act(targetId,'tree')).result.action,'tree');
  digest='d'.repeat(64);desktop.digests.clear();
  await assert.rejects(desktop.act(targetId,'tree'),e=>e.code==='PROCESS_IDENTITY_CHANGED');
  assert.throws(()=>desktop.target(targetId),e=>e.code==='NO_TARGET');
});

// A disposable file engine whose snapshot provider can be slowed down to
// expose serialization; snapshots are kept in memory (fixture only).
async function slowFileEngine(delayMs=0){
  const {YFileEngine}=await import('../engine/src/file-engine.mjs');
  const root=tmp(),snapshots=[];
  const snapshot=async info=>{await new Promise(r=>setTimeout(r,delayMs));snapshots.push(info);return {id:String(snapshots.length),durable:true};};
  return {root,snapshots,file:await YFileEngine.create(root,{snapshot})};
}
test('Writes to different files run in parallel; writes to one file queue; reads are never blocked by writers',async()=>{
  const {root,file}=await slowFileEngine(250);
  let t=Date.now();await Promise.all([file.atomicWrite('a.txt','A'),file.atomicWrite('b.txt','B')]);const parallel=Date.now()-t;
  t=Date.now();await Promise.all([file.atomicWrite('c.txt','1'),file.atomicWrite('c.txt','2')]);const queued=Date.now()-t;
  assert.ok(parallel<450,'different files took '+parallel+' ms');assert.ok(queued>=480,'same file took '+queued+' ms');
  const slow=file.atomicWrite('d.txt','D');t=Date.now();const read=await file.read('a.txt');assert.equal(read.content,'A');assert.ok(Date.now()-t<200,'read waited for an unrelated writer');await slow;
  assert.equal(fs.readFileSync(path.join(root,'b.txt'),'utf8'),'B');
});
test('Two chats editing one file with the same preimage: one commits, the other gets STALE_PREIMAGE; an external change is never overwritten',async()=>{
  const {root,file}=await slowFileEngine(50);
  fs.writeFileSync(path.join(root,'shared.txt'),'v0');const {sha256}=await file.read('shared.txt');
  const results=await Promise.allSettled([file.atomicWrite('shared.txt','from A',{expectedSha256:sha256}),file.atomicWrite('shared.txt','from B',{expectedSha256:sha256})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'STALE_PREIMAGE');
  const winner=fs.readFileSync(path.join(root,'shared.txt'),'utf8');assert.ok(['from A','from B'].includes(winner));
  const seen=(await file.read('shared.txt')).sha256;fs.writeFileSync(path.join(root,'shared.txt'),'edited by the Agent outside YGPT');
  await assert.rejects(file.replaceExact('shared.txt','edited','x',{expectedSha256:seen}),e=>e.code==='STALE_PREIMAGE');
  await assert.rejects(file.atomicWrite('shared.txt','overwrite',{expectedSha256:seen}),e=>e.code==='STALE_PREIMAGE');
  assert.equal(fs.readFileSync(path.join(root,'shared.txt'),'utf8'),'edited by the Agent outside YGPT');
});
test('Process sessions belong to their chat: another chat cannot poll, feed or cancel them; each chat has a fair share',async()=>{
  const {YTerminalEngine}=await import('../engine/src/terminal-engine.mjs');
  const root=tmp();let owner='ctx-a';
  const terminal=new YTerminalEngine({root,stateDir:path.join(root,'.state'),allowedExecutables:[process.execPath],currentOwner:()=>owner});
  const long={executable:process.execPath,args:['-e','setTimeout(()=>{},20000)'],cwd:root,timeoutMs:30000};
  try{
    const a=await terminal.start(long);
    owner='ctx-b';
    assert.throws(()=>terminal.poll(a.sessionId),e=>e.code==='SESSION_FOREIGN');
    await assert.rejects(terminal.input(a.sessionId,'x'),e=>e.code==='SESSION_FOREIGN');
    await assert.rejects(terminal.cancel(a.sessionId),e=>e.code==='SESSION_FOREIGN');
    const listed=terminal.list();assert.equal(listed.sessions.length,0);assert.equal(listed.otherChatsActive,1);
    const b=await terminal.run({executable:process.execPath,args:['-e','console.log("B ran while A is running")'],cwd:root});assert.equal(b.state,'succeeded');assert.match(b.stdout,/B ran/);
    owner='ctx-a';for(let i=0;i<3;i++)await terminal.start(long);
    await assert.rejects(terminal.start(long),e=>e.code==='CONCURRENCY_LIMIT');
    owner='ctx-b';const c=await terminal.start(long);assert.equal(c.state,'running','chat B still gets a slot');
    assert.equal(terminal.status(a.sessionId).state,'running','broker-internal status is not owner-scoped');
  }finally{await terminal.close();}
});
test('An unknown operation is never replayed: the same request key after a restart returns the recorded unknown state',()=>{
  const {dir,ledger}=newLedger();const ctx=ledger.context();
  const args={id:'44444444-4444-4444-8444-444444444444',executable:'C:\\Program Files\\nodejs\\node.exe',args:['build.js']};
  const first=ledger.create('y_job_submit',args,{contextHash:ctx.hash},{idempotencyKey:'submit-1'});assert.equal(ledger.autoClaim(first.operation.id),true);
  ledger.close();
  const reopened=new DurableLedger(path.join(dir,'ops.sqlite3'),{owner:'test-owner',vault:fakeVault});
  assert.equal(reopened.get(first.operation.id).state,'unknown');
  const again=reopened.create('y_job_submit',args,{contextHash:ctx.hash},{idempotencyKey:'submit-1'});
  assert.equal(again.reused,true);assert.equal(again.operation.id,first.operation.id);assert.equal(again.operation.state,'unknown');
  assert.equal(reopened.autoClaim(first.operation.id),false,'an unknown operation cannot be claimed again');
  reopened.close();
});

// Real headless Chromium when available (PLAYWRIGHT_BROWSERS_PATH); production
// launches channel msedge. This checks YGPT's isolation logic, not Edge itself.
const testLaunch=async()=>{const {chromium}=await import('playwright');return chromium.launch(process.platform==='win32'?{channel:'msedge',headless:true}:{headless:true});};
async function chromiumAvailable(){try{const b=await testLaunch();await b.close();return true;}catch{return false;}}
const haveChromium=await chromiumAvailable();
test('Browser: one lazy instance, a private context per chat; tabs, cookies and closing never cross chats',{skip:haveChromium?false:'no Playwright Chromium in this environment'},async()=>{
  const {YBrowserEngine}=await import('../engine/src/browser-engine.mjs');
  const http=await import('node:http');
  const server=http.createServer((req,res)=>{
    if(req.url==='/set'){res.writeHead(200,{'Set-Cookie':'session=chat-a-secret; Path=/','Content-Type':'text/html'});res.end('<title>set</title><p>cookie set</p>');return;}
    res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>show</title><p id="c">cookie='+(req.headers.cookie??'none')+'</p><a href="/show" target="_blank">popup</a>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const launches=[];let owner='ctx-a';
  const browser=new YBrowserEngine({stateDir:tmp(),currentOwner:()=>owner,launch:async o=>{launches.push(o);return testLaunch();}});
  try{
    assert.equal(launches.length,0,'nothing launches before a browser task');
    const a=await browser.open(base+'/set');await browser.navigate(a.tabId,base+'/show');
    assert.match((await browser.snapshot(a.tabId)).aria,/chat-a-secret/);
    owner='ctx-b';
    const b=await browser.open(base+'/show');assert.match(b.aria,/cookie=none/,'chat B does not see chat A cookies');
    assert.deepEqual((await browser.list()).tabs.map(t=>t.tabId),[b.tabId]);assert.equal((await browser.list()).otherChatTabs,1);
    for(const attempt of [()=>browser.snapshot(a.tabId),()=>browser.navigate(a.tabId,base+'/show'),()=>browser.act(a.tabId,'click',{role:'link',name:'popup'}),()=>browser.screenshot(a.tabId),()=>browser.closeTab(a.tabId)])
      await assert.rejects(attempt(),e=>e.code==='SESSION_FOREIGN');
    assert.equal(launches.length,1,'chats share one YGPT browser instance');assert.deepEqual(launches[0],{channel:'msedge',headless:true},'production launch options: Edge channel, no profile, no CDP');
    owner='ctx-a';await browser.act(a.tabId,'click',{role:'link',name:'popup'});
    await new Promise(r=>setTimeout(r,500));const mine=(await browser.list()).tabs;assert.equal(mine.length,2,'a popup belongs to the chat that opened it');
    await browser.closeContext('ctx-a');
    await assert.rejects(browser.snapshot(a.tabId),e=>e.code==='BROWSER_CONTEXT_CLOSED');
    owner='ctx-b';assert.match((await browser.snapshot(b.tabId)).aria,/cookie=none/,'closing chat A leaves chat B working');
    await assert.rejects(browser.snapshot(a.tabId),e=>e.code==='NO_TAB','chat B learns nothing about chat A closed tabs');
    await browser.sweep(Date.now()+YBrowserEngine.IDLE_MS+1);assert.equal(browser.browser,null,'idle contexts close and the browser with the last one');
    await assert.rejects(browser.snapshot(b.tabId),e=>e.code==='BROWSER_CONTEXT_CLOSED');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
