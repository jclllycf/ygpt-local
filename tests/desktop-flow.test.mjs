import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,unpack,decide,until} from './helpers.mjs';
import {DurableLedger} from '../runtime/durable.mjs';
import {consumeScreenshot,cleanupOldScreenshots,withoutImageBytes} from '../runtime/screenshot-cleanup.mjs';
import {desktopAccessPresentation} from '../runtime/chat-access.mjs';
import {desktopApprovalState} from '../runtime/desktop-approval-state.mjs';

test('Full Access activation returns its own in-chat card without a Windows detour or separate show call',async()=>{
 const f=fixture(),c=await f.client().start();try{
  const status=unpack(await c.call('y_chat_access'));assert.equal(status.requiresWindowsUi,false);assert.equal(status.nextAction.arguments.action,'request_full');
  const requested=await c.call('y_chat_access',{action:'request_full',durationMinutes:10}),pending=unpack(requested);assert.equal(pending.approvalDisplayed,true);assert.equal(pending.requiresWindowsUi,false);assert.ok(requested._meta.yBar.uiToken);assert.equal(requested._meta.yBar.presentation.approveLabel,'Enable Full Access');
  const ctx={contextToken:pending.contextToken};assert.equal(unpack(await c.call('y_chat_access',ctx)).mode,'standard');
  const wait=c.call('y_wait_approval',{requestId:pending.requestId,resultToken:pending.resultToken,...ctx,waitMs:5000});await new Promise(r=>setTimeout(r,100));await c.call('y_bar_decide',{requestId:pending.requestId,uiToken:requested._meta.yBar.uiToken,decision:'once'});assert.equal(unpack(await wait).state,'succeeded');assert.equal(unpack(await c.call('y_chat_access',ctx)).mode,'full');assert.equal(unpack(await c.call('y_chat_access')).mode,'standard');
 }finally{await c.close();}
});

test('Temporary desktop Full Access is exactly 100 minutes, revocable and private to its approving context',()=>{
 const f=fixture(),ledger=new DurableLedger(path.join(f.dir,'mode.sqlite3'),{owner:'test',vault:{seal:v=>'test:'+v,open:v=>v.slice(5)}});
 try{const a=ledger.context(),b=ledger.context(),args={hwnd:'fixture'},op=ledger.create('y_desktop_bind',args,{contextHash:a.hash,kind:'desktop-full-access',presentation:desktopAccessPresentation()});
  const card=desktopAccessPresentation();for(const key of ['title','target','impact','reversible','approveLabel'])assert.match(card[key],/100 minutes/);
  assert.throws(()=>ledger.enableFullAccess(a.hash,op.operation.id,100),/ACCESS_NOT_APPROVED/);assert.equal(ledger.fullAccess(a.hash),null);
  assert.equal(ledger.decideLocal(op.operation.id,'once').approved,true);assert.equal(ledger.claim(op.operation.id,'y_desktop_bind',args),true);
  assert.throws(()=>ledger.enableFullAccess(b.hash,op.operation.id,100),/ACCESS_NOT_APPROVED/);for(const duration of [10,120])assert.throws(()=>ledger.enableFullAccess(a.hash,op.operation.id,duration),/ACCESS_NOT_APPROVED/);
  const before=Date.now();ledger.enableFullAccess(a.hash,op.operation.id,100);assert.ok(ledger.fullAccess(a.hash).expires>=before+5999000);assert.ok(ledger.fullAccess(a.hash).expires<=Date.now()+6000000);assert.equal(ledger.fullAccess(b.hash),null);
  ledger.db.prepare('UPDATE chat_access SET expires=? WHERE context_hash=?').run(Date.now()-1,a.hash);assert.equal(ledger.fullAccess(a.hash),null);
  ledger.enableFullAccess(a.hash,op.operation.id,100);assert.equal(ledger.revokeFullAccess(a.hash),true);assert.equal(ledger.fullAccess(a.hash),null);
 }finally{ledger.close();}
});

test('Generated screenshot bytes return inline, files are removed and history excludes image payloads',()=>{
 const f=fixture(),state=path.join(f.dir,'data','state'),dir=path.join(state,'artifacts');fs.mkdirSync(dir,{recursive:true});const filename=path.join(dir,'desktop-'+randomUUID()+'.png'),bytes=Buffer.from('fixture-png-bytes');fs.writeFileSync(filename,bytes);
 const meta={path:filename,mimeType:'image/png'},image=consumeScreenshot(meta,state);assert.equal(image.data,bytes.toString('base64'));assert.equal(fs.existsSync(filename),false);assert.equal(meta.path,undefined);assert.equal(meta.localFileRemoved,true);
 const result={content:[image,{type:'text',text:'metadata retained'}],structuredContent:{result:meta}},stored=withoutImageBytes(result);assert.ok(!JSON.stringify(stored).includes(image.data));assert.equal(result.content[0].data,image.data);assert.equal(stored.structuredContent.result.localFileRemoved,true);
 const ledger=new DurableLedger(path.join(f.dir,'images.sqlite3'),{owner:'test',vault:{seal:v=>'test:'+v,open:v=>v.slice(5)}});try{const id=ledger.callStart('y_desktop_screenshot');ledger.callFinish(id,'succeeded',result);assert.ok(!JSON.stringify(ledger.call(id,true)).includes(image.data));}finally{ledger.close();}
 const large=path.join(dir,'browser-'+randomUUID()+'.png');fs.writeFileSync(large,Buffer.alloc(4*1024*1024+1));assert.throws(()=>consumeScreenshot({path:large},state),/SCREENSHOT_TOO_LARGE/);assert.equal(fs.existsSync(large),false);
 const old=path.join(dir,'desktop-'+randomUUID()+'.png'),recent=path.join(dir,'browser-existing-'+randomUUID()+'.png'),keep=path.join(dir,'personal.png');for(const p of [old,recent,keep])fs.writeFileSync(p,'keep unless owned and old');fs.utimesSync(old,1,1);const cleaned=cleanupOldScreenshots(state);assert.equal(cleaned.removed,1);assert.equal(fs.existsSync(old),false);assert.equal(fs.existsSync(recent),true);assert.equal(fs.existsSync(keep),true);assert.throws(()=>consumeScreenshot({path:keep},state),/SCREENSHOT_PATH_NOT_OWNED/);
});

test('A window closed while awaiting consent preserves approved chat access and recovers with a fresh bind',async()=>{
 const f=fixture(),c=await f.client().start(),children=[];
 const call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 const windows=async()=>{const r=await c.call('y_desktop_windows');if(r.structuredContent?.error?.code==='UIA_TIMEOUT')return [];assert.ok(!r.isError,JSON.stringify(r));return unpack(r).result.windows;};
 try{
  const first=await call('y_desktop_fixture');children.push(first.pid);
  const original=await until(async()=>(await windows()).find(w=>w.pid===first.pid),120000);
  const pending=await call('y_desktop_bind',{hwnd:original.hwnd}),ctx={contextToken:pending.contextToken};assert.equal(pending.code,'APPROVAL_REQUIRED');
  const card=await c.call('y_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,...ctx}),ui={requestId:pending.requestId,uiToken:card._meta.yBar.uiToken};
  process.kill(first.pid);await until(async()=>!(await windows()).some(w=>w.pid===first.pid));
  assert.equal((await call('y_chat_access',ctx)).active,false);
  const wait=c.call('y_wait_approval',{requestId:pending.requestId,resultToken:pending.resultToken,...ctx,waitMs:25000});
  await call('y_bar_decide',{...ui,decision:'once'});
  const done=unpack(await wait);assert.equal(done.state,'failed');assert.equal(done.continueWaiting,false);assert.equal(done.desktopAccess.active,true);assert.equal(done.stateLabel,'Access granted');
  const failed=done.result.structuredContent;assert.equal(failed.code,'DESKTOP_TARGET_STALE');assert.equal(failed.executed,false);assert.equal(failed.error.nativeCode,'NO_WINDOW');assert.equal(failed.error.outcomeUnknown,false);assert.equal(failed.desktopAccess.active,true);assert.equal(failed.recovery.requiresNewApproval,false);assert.equal(failed.recovery.repeatOriginalAction,false);
  const saved=(await call('y_call_result',{id:pending.requestId,resultToken:pending.resultToken,...ctx})).result.structuredContent;assert.deepEqual(saved,failed,'Exact diagnostic is durable, not a transient catch result');
  assert.equal((await call('y_bar_status',ui)).desktopAccess.active,true);assert.equal((await call('y_bar_status',ui)).executionError.code,'DESKTOP_TARGET_STALE');
  const reopened=await c.call('y_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,...ctx});assert.equal(reopened._meta.yBar.stateLabel,'Access granted');assert.equal(reopened._meta.yBar.executionError.code,'DESKTOP_TARGET_STALE');
  const access=await call('y_chat_access',ctx);assert.equal(access.mode,'full');assert.ok(Date.parse(access.expiresAt)>Date.now()+99*60000);assert.equal((await call('y_chat_access')).mode,'standard');
  const next=await call('y_desktop_fixture');children.push(next.pid);const fresh=await until(async()=>(await windows()).find(w=>w.pid===next.pid),120000);
  const binding=await call('y_desktop_bind',{hwnd:fresh.hwnd,...ctx});assert.equal(binding.ok,true);assert.equal(binding.code,undefined,'Fresh binding needs no second approval');
  await call('y_desktop_action',{targetId:binding.result.targetId,action:'setValue',automationId:'FixtureInput',value:'RECOVERED_AFTER_CONSENT',...ctx});
  assert.equal((await call('y_desktop_value',{targetId:binding.result.targetId,automationId:'FixtureInput',...ctx})).result.result.value,'RECOVERED_AFTER_CONSENT');
  assert.equal((await call('y_call_status',{id:pending.requestId,...ctx})).state,'failed','Original action remains terminal and is never replayed');
  await call('y_chat_access',{action:'revoke',...ctx});const revoked=await call('y_bar_status',ui);assert.equal(revoked.desktopAccess.active,false);assert.equal(revoked.stateLabel,undefined);
 }finally{for(const pid of children)try{process.kill(pid);}catch{}await c.close();}
});

test('Failed historical, denied and expired desktop approvals never gain access from status rendering',()=>{
 const f=fixture(),ledger=new DurableLedger(path.join(f.dir,'historical.sqlite3'),{owner:'test',vault:{seal:v=>'test:'+v,open:v=>v.slice(5)}});
 try{const ctx=ledger.context();for(const state of ['failed','denied','expired']){
  const args={hwnd:state},p=ledger.create('y_desktop_bind',args,{contextHash:ctx.hash,kind:'desktop-full-access',presentation:desktopAccessPresentation()});
  if(state==='failed'){ledger.decideLocal(p.operation.id,'once');ledger.claim(p.operation.id,'y_desktop_bind',args);ledger.finish(p.operation.id,'failed',null,'Fixture legacy failure before grant');}
  else if(state==='denied')ledger.decideLocal(p.operation.id,'deny');
  else{ledger.db.prepare('UPDATE operations SET expires=? WHERE id=?').run(Date.now()-1,p.operation.id);ledger.prune();}
  assert.equal(ledger.get(p.operation.id).state,state);
  assert.equal(desktopApprovalState(ledger,ledger.get(p.operation.id)).desktopAccess.active,false);assert.equal(ledger.fullAccess(ctx.hash),null);
 }}finally{ledger.close();}
});

test('Only current tool names resolve and a pending wait resumes once after its decision',async()=>{
 const f=fixture(),c=await f.client().start();try{
  const catalog=(await c.rpc('tools/list')).tools;assert.equal(new Set(catalog.map(t=>t.name)).size,catalog.length);assert.ok(catalog.some(t=>t.name==='y_desktop_action'));assert.ok(!catalog.some(t=>/^y_local_|^y_task_|^yuki_|^y_review_approval$|^y_approval_center$/.test(t.name)));
  for(const name of ['y_local_read_file','y_task_submit','yuki_file_read','y_review_approval','y_approval_center']){const value=unpack(await c.call(name));assert.equal(value.code,'NO_TOOL');assert.equal(value.executed,false);assert.equal(value.replacement,undefined);}
  const pending=unpack(await c.call('y_process_run',{executable:process.execPath,args:['-e',"if(false){}; console.log('Clear-Disk fixture')"],cwd:f.project})),args={requestId:pending.requestId,resultToken:pending.resultToken,contextToken:pending.contextToken};
  const card=await c.call('y_show_approval',args);const waiting=c.call('y_wait_approval',{...args,waitMs:5000});await new Promise(r=>setTimeout(r,350));
  const decision=unpack(await c.call('y_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yBar.uiToken,decision:'once'}));assert.equal(decision.continuation,'waiting-tool');const result=unpack(await waiting);assert.equal(result.state,'succeeded');assert.equal(result.continueWaiting,false);assert.match(result.result.structuredContent.result.stdout,/Clear-Disk fixture/);
 }finally{await c.close();}
});
