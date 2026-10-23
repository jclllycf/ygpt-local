import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fixture,unpack,until,decide} from './helpers.mjs';
test('Actual isolated Edge, native UIA fixture and durable job output',async()=>{
 const f=fixture(),c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 const page=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>YGPT isolated fixture</title><label>Value <input id="value"></label><button onclick="document.querySelector(\'#result\').textContent=\'Applied: \'+document.querySelector(\'#value\').value">Apply</button><p id="result">Ready</p>');});await new Promise(r=>page.listen(0,'127.0.0.1',r));let tab,target,created,ctx;
 try{
  // The first owned resource mints this chat's context; later calls carry it.
  const opened=await call('y_browser_open',{url:'http://127.0.0.1:'+page.address().port,keepAlive:true});tab=opened.result.tabId;ctx={contextToken:opened.ygptContext.contextToken};
  await call('y_browser_action',{tabId:tab,action:'fill',target:{role:'textbox',name:'Value'},value:'YGPT_BROWSER_OK',...ctx});
  const clicked=await call('y_browser_action',{tabId:tab,action:'click',target:{role:'button',name:'Apply'},...ctx});assert.match(clicked.result.aria,/Applied: YGPT_BROWSER_OK/);
  const image=await call('y_browser_screenshot',{tabId:tab,...ctx});assert.ok(image.result.sha256);
  const other=await c.call('y_browser_snapshot',{tabId:tab});assert.ok(other.isError&&/SESSION_FOREIGN/.test(JSON.stringify(other)),'another chat cannot read this tab');
  assert.equal((await call('y_browser_tabs')).result.tabs.length,0,'another chat lists no tabs of this chat');
  created=await call('y_desktop_fixture');const window=await until(async()=>{
    // Read-only UIA inventory may transiently time out on a heavily loaded Windows runner.
    // Retry the observation only; never replay UIA actions or approvals.
    const response=await c.call('y_desktop_windows');
    if(response.isError){
      if(response.structuredContent?.error?.code==='UIA_TIMEOUT')return false;
      assert.fail(JSON.stringify(response));
    }
    return unpack(response).result.windows.find(w=>w.pid===created.pid);
  },120000);
  // UIA is available but never silent: bind and each action wait for a decision.
  const pendingBind=await call('y_desktop_bind',{hwnd:window.hwnd,...ctx});assert.equal(pendingBind.code,'APPROVAL_REQUIRED');
  const bound=await decide(c,pendingBind,'once',ctx.contextToken);assert.equal(bound.state,'succeeded',JSON.stringify(bound));target=bound.result.structuredContent.result.targetId;
  const tree=await call('y_desktop_inspect',{targetId:target,...ctx});assert.ok(tree.result.result.elements.some(e=>e.automationId==='FixtureInput'));
  const foreign=await c.call('y_desktop_inspect',{targetId:target});assert.ok(foreign.isError&&/SESSION_FOREIGN/.test(JSON.stringify(foreign)),'another chat cannot read this window');
  const setValue=await call('y_desktop_action',{targetId:target,action:'setValue',automationId:'FixtureInput',value:'YGPT_UIA_OK',...ctx});assert.equal(setValue.code,'APPROVAL_REQUIRED');
  const before=await call('y_desktop_value',{targetId:target,automationId:'FixtureInput',...ctx});assert.notEqual(before.result.result.value,'YGPT_UIA_OK','no input before approval');
  assert.equal((await decide(c,setValue,'once',ctx.contextToken)).state,'succeeded');
  const invoke=await call('y_desktop_action',{targetId:target,action:'invoke',automationId:'ApplyButton',...ctx});assert.equal((await decide(c,invoke,'once',ctx.contextToken)).state,'succeeded');
  const value=await call('y_desktop_value',{targetId:target,automationId:'ResultLabel',...ctx});assert.equal(value.result.result.value,'Applied: YGPT_UIA_OK');
  const refused=await call('y_desktop_action',{targetId:target,action:'invoke',automationId:'ApplyButton',...ctx});assert.equal((await decide(c,refused,'deny',ctx.contextToken)).state,'denied');
  assert.equal(unpack(await c.call('y_call_status',{id:refused.requestId})).state,'denied','Deny executes nothing and is not retried');
  const id=randomUUID(),job=await call('y_job_submit',{id,executable:process.execPath,args:['-e',"console.log('YGPT_JOB_OK')"],cwd:f.project,...ctx});const token=job.outputToken??job.result.outputToken;assert.ok(token);
  const status=await until(async()=>{const s=await call('y_job_status',{id,...ctx});return s.result.state==='succeeded'?s:false;});assert.equal(status.result.state,'succeeded');const logs=await call('y_job_logs',{id,outputToken:token,...ctx});
  const stranger=await c.call('y_job_logs',{id,outputToken:token});assert.ok(stranger.isError&&/SESSION_FOREIGN/.test(JSON.stringify(stranger)),'the output token alone does not make another chat the owner');assert.match(JSON.stringify(logs),/YGPT_JOB_OK/);
 }finally{if(tab)await c.call('y_browser_close',{tabId:tab,...ctx}).catch(()=>{});if(created?.pid)try{process.kill(created.pid);}catch{}await c.close();await new Promise(r=>page.close(r));}
});
test('Fixture decisions: Deny, bounded chat grant, context revocation; not human-host attestation',async()=>{
 const f=fixture(),c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 try{
  const input={executable:process.execPath,args:['-e',"if(false){};console.log('Clear-Disk fixture deny')"],cwd:f.project};
  const denied=await call('y_process_run',input);assert.equal(denied.state,'suspended');const card=await c.call('y_show_approval',{requestId:denied.requestId,resultToken:denied.resultToken,contextToken:denied.contextToken});await call('y_bar_decide',{requestId:denied.requestId,uiToken:card._meta.yBar.uiToken,decision:'deny'});assert.equal((await call('y_call_status',{id:denied.requestId})).state,'denied');
  const exact={executable:process.execPath,args:['-e',"if(false){};console.log('Remove-Item -Recurse fixture chat')"],cwd:f.project};const pending=await call('y_process_run',exact);assert.equal(pending.state,'suspended');const review=await c.call('y_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,contextToken:pending.contextToken});assert.equal(review._meta.yBar.chatScope.eligible,true);
  await call('y_bar_decide',{requestId:pending.requestId,uiToken:review._meta.yBar.uiToken,decision:'chat'});await until(async()=>(await call('y_call_status',{id:pending.requestId})).state==='succeeded');
  const repeated=await call('y_process_run',{...exact,contextToken:pending.contextToken});assert.equal(repeated.ok,true,JSON.stringify(repeated));
  await call('y_close_context',{contextToken:pending.contextToken});const expired=await c.call('y_process_run',{...exact,contextToken:pending.contextToken});assert.equal(expired.isError,true);assert.match(JSON.stringify(expired),/context expired|CONTEXT_EXPIRED/i);
 }finally{await c.close();}
});
