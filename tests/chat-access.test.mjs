import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DurableLedger} from '../runtime/durable.mjs';
import {chatAccessStatus,chatAccessGate} from '../runtime/chat-access.mjs';
import {resourceIntent} from '../runtime/ownership.mjs';
import {trustedRuntimeExecutable,trustedRuntimeLaunch} from '../runtime/trusted-runtime.mjs';
import {YTerminalEngine} from '../engine/src/terminal-engine.mjs';
import {DurableJobs} from '../engine/src/durable-jobs.mjs';
import {isReadOnlySshInvocation} from '../runtime/ssh-read-policy.mjs';
import {smallTrash} from '../runtime/small-trash.mjs';
import {fixture,unpack,decide} from './helpers.mjs';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-access-'));
const fakeVault={seal:v=>'fixture:'+v,open:v=>v.slice(8)};
function accessFixture(){const dir=tmp(),file=path.join(dir,'ledger.sqlite3'),ledger=new DurableLedger(file,{owner:'owner',vault:fakeVault});return {dir,file,ledger};}
function approvedGrant(ledger,context,minutes=120){const args={action:'request_full',durationMinutes:minutes},held=ledger.create('y_chat_access',args,{...chatAccessGate,contextHash:context.hash,chatScope:{eligible:false}});assert.ok(ledger.decideLocal(held.operation.id,'once','fixture').ok);assert.ok(ledger.claim(held.operation.id,'y_chat_access',args));return {id:held.operation.id,args};}

test('Full Access requires an exact claimed approval and never crosses chat contexts or owners',()=>{
 const {ledger}=accessFixture(),a=ledger.context(),b=ledger.context();
 assert.equal(chatAccessStatus(ledger,a.hash).mode,'standard');
 assert.throws(()=>ledger.enableFullAccess(a.hash,'invented'),{code:'ACCESS_NOT_APPROVED'});
 const args={action:'request_full',durationMinutes:120},pending=ledger.create('y_chat_access',args,{...chatAccessGate,contextHash:a.hash,chatScope:{eligible:false}});
 assert.throws(()=>ledger.enableFullAccess(a.hash,pending.operation.id),{code:'ACCESS_NOT_APPROVED'});
 ledger.decideLocal(pending.operation.id,'deny');
 const allowed=approvedGrant(ledger,a);
 assert.throws(()=>ledger.enableFullAccess(b.hash,allowed.id),{code:'ACCESS_NOT_APPROVED'});
 assert.throws(()=>ledger.enableFullAccess(a.hash,allowed.id,720),{code:'ACCESS_NOT_APPROVED'});
 ledger.enableFullAccess(a.hash,allowed.id);ledger.finish(allowed.id,'succeeded',{});
 assert.equal(chatAccessStatus(ledger,a.hash).mode,'full');assert.equal(chatAccessStatus(ledger,b.hash).mode,'standard');
 assert.throws(()=>ledger.enableFullAccess(a.hash,allowed.id),{code:'ACCESS_NOT_APPROVED'});
 assert.equal(ledger.revokeFullAccess(b.hash),false);assert.equal(chatAccessStatus(ledger,a.hash).mode,'full');
 assert.equal(ledger.revokeFullAccess(a.hash),true);assert.equal(chatAccessStatus(ledger,a.hash).mode,'standard');ledger.close();
});

test('Full Access expires, survives a broker restart only for its original context, and closes with that context',()=>{
 const {file,ledger}=accessFixture(),a=ledger.context(),op=approvedGrant(ledger,a,1);ledger.enableFullAccess(a.hash,op.id,1);ledger.finish(op.id,'succeeded',{});ledger.close();
 const reopened=new DurableLedger(file,{owner:'owner',vault:fakeVault});assert.ok(reopened.fullAccess(a.hash));
 const stranger=new DurableLedger(file,{owner:'other-owner',vault:fakeVault});assert.equal(stranger.fullAccess(a.hash),null);stranger.close();
 reopened.db.prepare('UPDATE chat_access SET expires=?').run(Date.now()-1);assert.equal(reopened.fullAccess(a.hash),null);
 const next=approvedGrant(reopened,a);reopened.enableFullAccess(a.hash,next.id);reopened.finish(next.id,'succeeded',{});reopened.closeContext(a.token);assert.equal(reopened.fullAccess(a.hash),null);reopened.close();
 assert.deepEqual(resourceIntent('y_chat_access',{action:'request_full'}),{creates:'chat-access'});
 assert.deepEqual(resourceIntent('y_chat_access',{action:'revoke'}),{lists:'any'});
});

test('Trusted runtime is an exact shipped path plus hash; altered binaries and unrelated files do not inherit trust',()=>{
 const dir=tmp(),exe=path.join(dir,'runtimes/node/npx.cmd');fs.mkdirSync(path.dirname(exe),{recursive:true});fs.writeFileSync(exe,'fixture-runtime');
 const bytes=fs.readFileSync(exe);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({product:'YGPT Local',files:[{path:'runtimes/node/npx.cmd',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
 assert.equal(trustedRuntimeExecutable(exe,dir),true);fs.writeFileSync(exe,'changed-runtime');assert.equal(trustedRuntimeExecutable(exe,dir),false);
 const other=path.join(dir,'runtimes/node/unreviewed.cmd');fs.writeFileSync(other,'fixture-runtime');assert.equal(trustedRuntimeExecutable(other,dir),false);
 assert.equal(trustedRuntimeExecutable(path.join(dir,'../npx.cmd'),dir),false);
});

test('Windows short-path aliases keep exact runtime trust without trusting linked ancestors',{skip:process.platform!=='win32'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-runtime-long-alias-fixture-')),exe=path.join(dir,'runtimes/node/npx.cmd');fs.mkdirSync(path.dirname(exe),{recursive:true});fs.writeFileSync(exe,'fixture-runtime');
 const bytes=fs.readFileSync(exe);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({product:'YGPT Local',files:[{path:'runtimes/node/npx.cmd',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),short=execFileSync(ps,['-NoProfile','-NonInteractive','-Command',"(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:YGPT_ALIAS_FIXTURE).ShortPath"],{encoding:'utf8',windowsHide:true,env:{...process.env,YGPT_ALIAS_FIXTURE:dir}}).trim();
 if(short.toLowerCase()===dir.toLowerCase()){t.skip('8.3 aliases are disabled on this fixture volume');return;}
 assert.equal(trustedRuntimeExecutable(path.join(short,'runtimes/node/npx.cmd'),short),true);assert.equal(trustedRuntimeExecutable(exe,short),true);
 const linked=path.join(dir,'linked-node');fs.symlinkSync(path.dirname(exe),linked,'junction');assert.equal(trustedRuntimeExecutable(path.join(linked,'npx.cmd'),dir),false);
});

test('SSH diagnostics using a private key are reads; mutation, shell injection and forwarding are not classified as reads',()=>{
 const base={executable:'C:/Tools/plink.exe',args:['-batch','-ssh','-i','D:/Example/.ssh/test.ppk','user@example.invalid']};
 for(const command of ['hostname','uname -a','systemctl --no-pager status example.service','cat /etc/os-release | head -n 3','cat "/tmp/example file"'])assert.equal(isReadOnlySshInvocation({...base,args:[...base.args,command]}),true,command);
 for(const command of ['hostname changed-name','systemctl restart example.service','cat /etc/os-release; rm /tmp/x','cat /tmp/$(touch-x)','cat /tmp/x > /tmp/y','cat"evil"','cat /tmp/x && uname -a','sh -c hostname','curl https://example.invalid','find /tmp -delete'])assert.equal(isReadOnlySshInvocation({...base,args:[...base.args,command]}),false,command);
 assert.equal(isReadOnlySshInvocation({executable:'ssh.exe',args:['-o','ProxyCommand=evil','example.invalid','hostname']}),false);
 assert.equal(isReadOnlySshInvocation({executable:'ssh.exe',args:['-L','1234:host:80','example.invalid','hostname']}),false);
});

test('Verified npm/npx shims run as exact Node argv in sessions and durable jobs, without shell expansion',async()=>{
 const dir=tmp(),node=path.join(dir,'runtimes/node/node.exe'),shim=path.join(dir,'runtimes/node/npx.cmd'),cli=path.join(dir,'runtimes/node/node_modules/npm/bin/npx-cli.js');
 fs.mkdirSync(path.dirname(cli),{recursive:true});fs.copyFileSync(process.execPath,node);fs.writeFileSync(shim,'This wrapper must never run');fs.writeFileSync(cli,'console.log(JSON.stringify(process.argv.slice(2)))');
 const files=[node,shim,cli].map(file=>{const bytes=fs.readFileSync(file);return {path:path.relative(dir,file).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({product:'YGPT Local',files}));
 const terminal=new YTerminalEngine({root:dir,allowedExecutables:[shim],prepareExecutable:spec=>trustedRuntimeLaunch(spec,dir,{platform:'win32'})});
 try{
  const args=['space value','a&b','100%','semi;colon','quote"value','$(not-a-command)'],result=await terminal.run({executable:shim,args});assert.equal(result.state,'succeeded',JSON.stringify(result));assert.deepEqual(JSON.parse(result.stdout),args);
  const jobs=new DurableJobs({terminal});jobs.call=async request=>request;
  const durable=await jobs.submit({id:'fixture',executable:shim,args});assert.deepEqual(durable.argv,[node,cli,...args]);
  fs.appendFileSync(cli,'\n// changed');await assert.rejects(terminal.validate({executable:shim,args}),{code:'EXECUTION_TARGET_CHANGED'});
  const ordinary={executable:path.join(dir,'other.cmd'),args};assert.equal(trustedRuntimeLaunch(ordinary,dir,{platform:'win32'}),ordinary);
 }finally{await terminal.close();}
});

test('Small cleanup is bounded, refuses sensitive descendants, and retains major deletion review',()=>{
 const dir=tmp(),a=path.join(dir,'a.txt'),sub=path.join(dir,'small');fs.writeFileSync(a,'a');fs.mkdirSync(sub);fs.writeFileSync(path.join(sub,'b.txt'),'b');
 const route=p=>({target:p,permission:'project',sensitive:path.basename(p)==='.env'});
 assert.equal(smallTrash([a,sub],{route}),true);assert.equal(smallTrash([dir],{route,projectRoots:[dir]}),false);
 fs.writeFileSync(path.join(sub,'.env'),'fixture');assert.equal(smallTrash([sub],{route}),false);fs.unlinkSync(path.join(sub,'.env'));
 assert.equal(smallTrash([sub],{route,maxEntries:1}),false);assert.equal(smallTrash([sub],{route,maxBytes:0}),false);
});

test('Broker Full Access is requested through a card, applies only to this chat, and revocation restores review',async()=>{
 const f=fixture(),c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 try{
  assert.equal((await call('y_chat_access')).mode,'standard');
  const pending=await call('y_chat_access',{action:'request_full',durationMinutes:30});assert.equal(pending.code,'APPROVAL_REQUIRED');assert.equal(pending.chatScopeAvailable,false);const ctx={contextToken:pending.contextToken};assert.ok(ctx.contextToken);
  assert.equal((await call('y_chat_access',ctx)).mode,'standard');
  const card=await c.call('y_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,...ctx});assert.equal(card._meta.yBar.presentation.approveLabel,'Enable Full Access');assert.match(card._meta.yBar.presentation.impact,/Other chats/);
  await assert.rejects(c.call('y_chat_access',{action:'status',fullAccess:true,...ctx}),/Invalid tool arguments/);
  const granted=await decide(c,pending,'once',ctx.contextToken);assert.equal(granted.state,'succeeded',JSON.stringify(granted));
  assert.equal((await call('y_chat_access',ctx)).mode,'full');assert.equal((await call('y_chat_access')).mode,'standard');
  const benign={executable:process.execPath,args:['-e',"if(false){}; console.log('Clear-Disk fixture')"],cwd:f.project};
  const run=await call('y_process_run',{...benign,...ctx});assert.equal(run.result.state,'succeeded');
  const own=await call('y_process_start',{executable:process.execPath,args:['-e',"console.log('owned fixture')"],cwd:f.project,...ctx});
  const badToken=await c.call('y_process_poll',{sessionId:own.result.sessionId,outputToken:'0'.repeat(64),...ctx});assert.equal(badToken.isError,true);assert.match(JSON.stringify(badToken),/outputToken/);
  const foreign=await call('y_process_start',{executable:process.execPath,args:['-e',"console.log('other fixture')"],cwd:f.project});
  const foreignRead=await c.call('y_process_poll',{sessionId:foreign.result.sessionId,outputToken:foreign.result.outputToken,...ctx});assert.equal(foreignRead.isError,true);assert.match(JSON.stringify(foreignRead),/SESSION_FOREIGN/);
  const other=await call('y_process_run',benign);assert.equal(other.code,'APPROVAL_REQUIRED');await decide(c,other,'deny');
  assert.equal((await call('y_chat_access',{action:'revoke',...ctx})).revoked,true);
  const reviewed=await call('y_process_run',{...benign,...ctx});assert.equal(reviewed.code,'APPROVAL_REQUIRED');await decide(c,reviewed,'deny',ctx.contextToken);
  const expired=await c.call('y_chat_access',{action:'status',contextToken:'not-a-context'});assert.equal(unpack(expired).code,'CONTEXT_EXPIRED');
 }finally{await c.close();}
});

test('Standard mode reads protected files and dry-run patches automatically; ordinary edits keep snapshots',async()=>{
 const f=fixture(),privateFile=path.join(f.project,'.ssh','fixture.txt'),ordinary=path.join(f.project,'ordinary.txt');
 fs.mkdirSync(path.dirname(privateFile));fs.writeFileSync(privateFile,'fixture before\n');fs.writeFileSync(ordinary,'ordinary before\n');
 const c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 try{
  assert.match(JSON.stringify(await call('y_file_read',{path:privateFile})),/fixture before/);
  assert.equal((await call('y_file_read_many',{paths:[privateFile,ordinary]})).ok,true);
  assert.equal((await call('y_project_inspect',{path:path.dirname(privateFile)})).ok,true);
  assert.equal((await call('y_search_text',{directory:path.dirname(privateFile),pattern:'fixture'})).ok,true);
  const input={path:privateFile,expectedSha256:createHash('sha256').update(fs.readFileSync(privateFile)).digest('hex'),hunks:[{oldText:'before',newText:'after'}]};
  assert.equal((await call('y_file_patch',{...input,dryRun:true})).result.dryRun,true);assert.match(fs.readFileSync(privateFile,'utf8'),/before/);
  const pending=await call('y_file_patch',input);assert.equal(pending.code,'APPROVAL_REQUIRED');
  const ctx={contextToken:pending.contextToken},full=await call('y_chat_access',{action:'request_full',...ctx});await decide(c,full,'once',ctx.contextToken);
  assert.equal((await call('y_call_status',{id:pending.requestId})).state,'awaiting_user','enabling Full Access never executes an earlier pending edit');assert.match(fs.readFileSync(privateFile,'utf8'),/before/);
  const changed=await call('y_file_patch',{...input,...ctx});assert.ok(changed.result.snapshotId);assert.match(fs.readFileSync(privateFile,'utf8'),/after/);await decide(c,pending,'deny',ctx.contextToken);
  await call('y_chat_access',{action:'revoke',...ctx});
  const edited=await call('y_file_edit',{path:ordinary,oldText:'before',newText:'after'});assert.ok(edited.result.snapshotId);
  const protectedAgain=await call('y_file_edit',{path:privateFile,oldText:'after',newText:'next',...ctx});assert.equal(protectedAgain.code,'APPROVAL_REQUIRED');await decide(c,protectedAgain,'deny',ctx.contextToken);
 }finally{await c.close();}
});

test('Small cleanup uses verified snapshots and the actual Windows Recycle Bin',async t=>{
 const f=fixture(),bin=path.join(path.parse(f.project).root,'$Recycle.Bin');
 if(process.platform!=='win32'||!fs.existsSync(bin)){t.skip('No existing Windows Recycle Bin on this fixture volume; snapshot policy is tested separately');return;}
 const c=await f.client().start();try{
  const trash=[path.join(f.project,'cleanup-a.txt'),path.join(f.project,'cleanup-b.txt')];for(const file of trash)fs.writeFileSync(file,'disposable fixture');
  const response=await c.call('y_file_trash',{paths:trash});assert.ok(!response.isError,JSON.stringify(response));const cleaned=unpack(response);assert.ok(cleaned.snapshotId);assert.equal(cleaned.coverage,'complete');assert.ok(trash.every(file=>!fs.existsSync(file)));
 }finally{await c.close();}
});
