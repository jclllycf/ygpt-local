import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,unpack,until,decide} from './helpers.mjs';
test('Actual isolated Edge, native UIA fixture and durable job output',async()=>{
 const f=fixture(),c=await f.client().start(),call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 const page=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>YGPT isolated fixture</title><label>Value <input id="value"></label><button onclick="document.querySelector(\'#result\').textContent=\'Applied: \'+document.querySelector(\'#value\').value">Apply</button><p id="result">Ready</p>');});await new Promise(r=>page.listen(0,'127.0.0.1',r));let tab,target,created,second,ctx;
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
  // A single explicit decision enables ten-minute Full Access and binds once.
  const binding=await call('y_desktop_bind',{hwnd:window.hwnd,...ctx});assert.equal(binding.code,'APPROVAL_REQUIRED');
  const enabled=await decide(c,binding,'once',ctx.contextToken);const bound=unpack(enabled.result);assert.equal(bound.ok,true);target=bound.result.targetId;
  const tree=await call('y_desktop_inspect',{targetId:target,...ctx});assert.ok(tree.result.result.elements.some(e=>e.automationId==='FixtureInput'));
  const limited=await call('y_desktop_inspect',{targetId:target,maxNodes:1,...ctx});assert.equal(limited.result.result.elements.length,1);assert.equal(limited.result.result.truncated,true);assert.ok(limited.result.result.truncationReasons.includes('maxNodes'));
  const scoped=await call('y_desktop_inspect',{targetId:target,automationId:'FixtureInput',maxDepth:1,maxNodes:10,...ctx});assert.equal(scoped.result.result.scoped,true);assert.equal(scoped.result.result.elements[0].automationId,'FixtureInput');assert.equal(scoped.result.result.maxDepth,1);
  const foreign=await c.call('y_desktop_inspect',{targetId:target});assert.ok(foreign.isError&&/SESSION_FOREIGN/.test(JSON.stringify(foreign)),'another chat cannot read this window');
  const setValue=await call('y_desktop_action',{targetId:target,action:'setValue',automationId:'FixtureInput',value:'YGPT_UIA_OK',...ctx});assert.equal(setValue.ok,true);
  const invoke=await call('y_desktop_action',{targetId:target,action:'invoke',automationId:'ApplyButton',...ctx});assert.equal(invoke.ok,true);
  const value=await call('y_desktop_value',{targetId:target,automationId:'ResultLabel',...ctx});assert.equal(value.result.result.value,'Applied: YGPT_UIA_OK');
  const invalid=await c.call('y_desktop_action',{targetId:target,action:'keys',value:'CTRL+INVALIDKEY',...ctx});assert.equal(invalid.structuredContent.error.code,'BAD_KEY_CHORD');assert.equal(invalid.structuredContent.error.effectStarted,false);assert.match(invalid.structuredContent.error.hresult,/^0x[0-9A-F]{8}$/);
  await call('y_desktop_action',{targetId:target,action:'type',automationId:'FixtureInput',value:'',...ctx});await call('y_desktop_action',{targetId:target,action:'keys',value:'CTRL+A',...ctx});await call('y_desktop_action',{targetId:target,action:'type',automationId:'FixtureInput',value:'YGPT_KEYS_OK',...ctx});assert.equal((await call('y_desktop_value',{targetId:target,automationId:'FixtureInput',...ctx})).result.result.value,'YGPT_KEYS_OK');
  const captured=await c.call('y_desktop_screenshot',{targetId:target,...ctx});assert.equal(captured.isError,false);assert.ok(captured.content.some(b=>b.type==='image'&&b.data));const metadata=unpack(captured).result;assert.equal(metadata.localFileRemoved,true);assert.equal(metadata.path,undefined);assert.ok(!fs.readdirSync(path.join(f.config.stateDir,'artifacts')).some(n=>n.startsWith('desktop-')));
  second=await call('y_desktop_fixture');const secondWindow=await until(async()=>(await call('y_desktop_windows')).result.windows.find(w=>w.pid===second.pid));const secondBound=await call('y_desktop_bind',{hwnd:secondWindow.hwnd,...ctx});assert.equal(secondBound.ok,true);assert.equal((await call('y_desktop_action',{targetId:secondBound.result.targetId,action:'setValue',automationId:'FixtureInput',value:'SECOND_WINDOW_OK',...ctx})).ok,true);
  await call('y_chat_access',{action:'revoke',...ctx});
  const refused=await call('y_desktop_action',{targetId:target,action:'invoke',automationId:'ApplyButton',...ctx});assert.equal((await decide(c,refused,'deny',ctx.contextToken)).state,'denied');
  assert.equal(unpack(await c.call('y_call_status',{id:refused.requestId})).state,'denied','Deny executes nothing and is not retried');
  const id=randomUUID(),job=await call('y_job_submit',{id,executable:process.execPath,args:['-e',"console.log('YGPT_JOB_OK')"],cwd:f.project,...ctx});const token=job.outputToken??job.result.outputToken;assert.ok(token);
  const status=await until(async()=>{const s=await call('y_job_status',{id,...ctx});return s.result.state==='succeeded'?s:false;});assert.equal(status.result.state,'succeeded');const logs=await call('y_job_logs',{id,outputToken:token,...ctx});
  const stranger=await c.call('y_job_logs',{id,outputToken:token});assert.ok(stranger.isError&&/SESSION_FOREIGN/.test(JSON.stringify(stranger)),'the output token alone does not make another chat the owner');assert.match(JSON.stringify(logs),/YGPT_JOB_OK/);
 }finally{if(tab)await c.call('y_browser_close',{tabId:tab,...ctx}).catch(()=>{});for(const child of [created,second])if(child?.pid)try{process.kill(child.pid);}catch{}await c.close();await new Promise(r=>page.close(r));}
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
