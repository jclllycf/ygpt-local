import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fixture,unpack,until} from './helpers.mjs';
test('Actual isolated Edge, native UIA fixture and durable job output',async()=>{
 const f=fixture(),c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 const page=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>YGPT isolated fixture</title><label>Value <input id="value"></label><button onclick="document.querySelector(\'#result\').textContent=\'Applied: \'+document.querySelector(\'#value\').value">Apply</button><p id="result">Ready</p>');});await new Promise(r=>page.listen(0,'127.0.0.1',r));let tab,target;
 try{
  const opened=await call('y_browser_open',{url:'http://127.0.0.1:'+page.address().port});tab=opened.result.tabId;
  await call('y_browser_action',{tabId:tab,action:'fill',target:{role:'textbox',name:'Value'},value:'YGPT_BROWSER_OK'});
  const clicked=await call('y_browser_action',{tabId:tab,action:'click',target:{role:'button',name:'Apply'}});assert.match(clicked.result.aria,/Applied: YGPT_BROWSER_OK/);
  const image=await call('y_browser_screenshot',{tabId:tab});assert.ok(image.result.sha256);
  const created=await call('y_desktop_fixture');const window=await until(async()=>{const inventory=await call('y_desktop_windows');return inventory.result.windows.find(w=>w.pid===created.pid);});
  const bound=await call('y_desktop_bind',{hwnd:window.hwnd});target=bound.result.targetId;
  const tree=await call('y_desktop_inspect',{targetId:target});assert.ok(tree.result.result.elements.some(e=>e.automationId==='FixtureInput'));
  await call('y_desktop_action',{targetId:target,action:'setValue',automationId:'FixtureInput',value:'YGPT_UIA_OK'});
  await call('y_desktop_action',{targetId:target,action:'invoke',automationId:'ApplyButton'});
  const value=await call('y_desktop_value',{targetId:target,automationId:'ResultLabel'});assert.equal(value.result.result.value,'Applied: YGPT_UIA_OK');
  const id=randomUUID(),job=await call('y_job_submit',{id,executable:process.execPath,args:['-e',"console.log('YGPT_JOB_OK')"],cwd:f.project});const token=job.outputToken??job.result.outputToken;assert.ok(token);
  const status=await until(async()=>{const s=await call('y_job_status',{id});return s.result.state==='succeeded'?s:false;});assert.equal(status.result.state,'succeeded');const logs=await call('y_job_logs',{id,outputToken:token});assert.match(JSON.stringify(logs),/YGPT_JOB_OK/);
 }finally{if(tab)await c.call('y_browser_close',{tabId:tab}).catch(()=>{});if(target)await c.call('y_desktop_action',{targetId:target,action:'invoke',name:'Close'}).catch(()=>{});await c.close();await new Promise(r=>page.close(r));}
});
test('Fixture decisions: Deny, bounded chat grant, context revocation; not human-host attestation',async()=>{
 const f=fixture(),c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 try{
  const input={executable:process.execPath,args:['-e',"if(false){};console.log('Clear-Disk fixture deny')"],cwd:f.project};
  const denied=await call('y_process_run',input);assert.equal(denied.state,'suspended');const card=await c.call('y_review_approval',{requestId:denied.requestId,contextToken:denied.contextToken});await call('y_bar_decide',{requestId:denied.requestId,uiToken:card._meta.yBar.uiToken,decision:'deny'});assert.equal((await call('y_call_status',{id:denied.requestId})).state,'denied');
  const exact={executable:process.execPath,args:['-e',"if(false){};console.log('Remove-Item -Recurse fixture chat')"],cwd:f.project};const pending=await call('y_process_run',exact);assert.equal(pending.state,'suspended');const review=await c.call('y_review_approval',{requestId:pending.requestId,contextToken:pending.contextToken});assert.equal(review._meta.yBar.chatScope.eligible,true);
  await call('y_bar_decide',{requestId:pending.requestId,uiToken:review._meta.yBar.uiToken,decision:'chat'});await until(async()=>(await call('y_call_status',{id:pending.requestId})).state==='succeeded');
  const repeated=await call('y_process_run',{...exact,contextToken:pending.contextToken});assert.equal(repeated.ok,true,JSON.stringify(repeated));
  await call('y_close_context',{contextToken:pending.contextToken});await assert.rejects(()=>c.call('y_process_run',{...exact,contextToken:pending.contextToken}),/context expired\/invalid/);
 }finally{await c.close();}
});
