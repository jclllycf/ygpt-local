import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {fixture,unpack} from './helpers.mjs';
import {BAR_URI,barHtmlForTest} from '../runtime/inline-approval.mjs';
import {DurableLedger} from '../runtime/durable.mjs';
import {createLocalReview} from '../runtime/local-review.mjs';
import {chatAccessPresentation} from '../runtime/chat-access.mjs';

test('Pending approval yields immediately for mobile mounting; old URIs remain valid and decisions stay capability-protected',async()=>{
 const f=fixture(),c=await f.client().start();
 try{
  const tools=(await c.rpc('tools/list')).tools;
  for(const name of ['y_show_approval','y_approval_center','y_preview_approval_ui'])assert.equal(tools.find(t=>t.name===name)._meta.ui.resourceUri,BAR_URI);
  assert.ok(!BAR_URI.includes('rc2'));
  const current=(await c.rpc('resources/read',{uri:BAR_URI})).contents[0];
  const old=(await c.rpc('resources/read',{uri:'ui://ygpt/approval/compact-v1-rc2.html'})).contents[0];
  assert.equal(current.text,old.text);assert.deepEqual(current._meta['openai/ui'].availableDisplayModes,['inline','fullscreen']);
  const pending=unpack(await c.call('y_process_run',{executable:process.execPath,args:['-e',"if(false){};console.log('Clear-Disk fixture')"],cwd:f.project}));
  assert.equal(pending.code,'APPROVAL_REQUIRED');
  const args={requestId:pending.requestId,resultToken:pending.resultToken,contextToken:pending.contextToken};
  const card=await c.call('y_show_approval',args);assert.equal(card.structuredContent.continueWaiting,false);
  assert.ok(!JSON.stringify(card.structuredContent).includes(card._meta.yBar.uiToken));
  const start=Date.now(),wait=unpack(await c.call('y_wait_approval',{...args,waitMs:25000}));
  assert.ok(Date.now()-start<2000);assert.equal(wait.state,'awaiting_user');assert.equal(wait.continueWaiting,false);
  await assert.rejects(c.call('y_bar_decide',{requestId:pending.requestId,uiToken:pending.resultToken,decision:'once'}),/APP_CAPABILITY_INVALID/);
  const ui={requestId:pending.requestId,uiToken:card._meta.yBar.uiToken};
  assert.equal(unpack(await c.call('y_bar_decide',{...ui,decision:'deny'})).state,'denied');
  const first=unpack(await c.call('y_bar_status',{...ui,notifyAction:'claim'})).delivery;
  assert.equal(first.granted,true);assert.equal(unpack(await c.call('y_bar_status',{...ui,notifyAction:'claim'})).delivery.granted,false);
  await c.call('y_bar_status',{...ui,notifyAction:'sent',deliveryToken:first.token});
  assert.equal(unpack(await c.call('y_bar_status',{...ui,notifyAction:'retry'})).delivery.status,'sent');
  assert.equal(unpack(await c.call('y_call_status',{id:pending.requestId})).state,'denied');
 }finally{await c.close();}
});

test('Manual Windows owner review binds the exact request and executes once; notification delivery survives reopening',async()=>{
 const f=fixture(),db=path.join(f.dir,'review.sqlite3'),vault={seal:v=>'fixture:'+v,open:v=>v.slice(8)};
 let ledger=new DurableLedger(db,{owner:'fixture',vault}),executions=0;
 const context=ledger.context(),pending=ledger.create('fixture-tool',{path:'fixture-only'},{contextHash:context.hash,presentation:{title:'Safe fixture'},chatScope:{eligible:false}});
 let review=createLocalReview({ledger,onApproved:async()=>{executions++;}});
 const entry=(await review({kind:'queue'})).entries[0];
 assert.equal((await review({kind:'queue'})).entries[0].nonce,entry.nonce,'Refreshing another owner window cannot invalidate a reviewed request');
 const choice={kind:'decision',id:entry.id,nonce:entry.nonce,requestDigest:entry.requestDigest,decision:'once'};
 assert.equal((await review({...choice,nonce:'guessed'})).code,'LOCAL_REVIEW_CAPABILITY_INVALID');
 assert.equal((await review({...choice,requestDigest:'changed'})).code,'LOCAL_REVIEW_CAPABILITY_INVALID');
 assert.equal(executions,0);assert.equal((await review(choice)).ok,true);assert.equal((await review(choice)).reused,true);
 await delay(30);assert.equal(executions,1);
 const claim=ledger.reserveUiDelivery(entry.id);assert.equal(claim.granted,true);ledger.close();
 ledger=new DurableLedger(db,{owner:'fixture',vault});assert.equal(ledger.reserveUiDelivery(entry.id).granted,false);
 ledger.finishUiDelivery(entry.id,claim.token,false);assert.equal(ledger.reserveUiDelivery(entry.id).status,'unconfirmed');
 const retry=ledger.reserveUiDelivery(entry.id,true);assert.equal(retry.granted,true);ledger.finishUiDelivery(entry.id,retry.token,true);
 assert.equal(ledger.finishUiDelivery(entry.id,retry.token,false).status,'sent','Late uncertainty cannot undo an acknowledged notification');
 assert.equal(ledger.reserveUiDelivery(entry.id,true).status,'sent');ledger.close();
});

function bar(){return {requestId:'CROSS_DEVICE_FIXTURE',uiToken:'private-widget-fixture',presentation:{title:'Review fixture action',target:'No production operation',impact:'Fixture only'},chatScope:{eligible:true},state:'awaiting_user',expiresAt:new Date(Date.now()+60000).toISOString(),enabled:true};}
test('Phone-sized and desktop cards receive delayed metadata, synchronize an external decision and notify once',async()=>{
 const html=barHtmlForTest(),server=http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,state='awaiting_user',reserved=false,sent=false,messages=0,decisions=0;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const pages=[];
  for(const viewport of [{width:390,height:844},{width:1100,height:760}]){
   const context=await browser.newContext({viewport}),page=await context.newPage();pages.push(page);
   await page.exposeFunction('fixtureTool',async(name,args)=>{
    assert.equal(args.uiToken,'private-widget-fixture');
    if(name==='y_bar_decide'){decisions++;state=args.decision==='deny'?'denied':'succeeded';}
    let delivery;
    if(args.notifyAction==='claim'||args.notifyAction==='retry'){
     delivery=reserved?{granted:false,status:sent?'sent':'unconfirmed'}:{granted:true,token:'delivery-fixture',status:'reserved'};reserved=true;
    }else if(args.notifyAction==='sent'){sent=true;delivery={status:'sent'};}
    else if(args.notifyAction==='uncertain')delivery={status:'unconfirmed'};
    return {structuredContent:{state,continuation:'follow-up',delivery}};
   });
   await page.exposeFunction('fixtureMessage',async({prompt})=>{assert.ok(!prompt.includes('private-widget-fixture'));messages++;return {};});
   await page.addInitScript(()=>{window.openai={toolResponseMetadata:null,callTool:(n,a)=>window.fixtureTool(n,a),sendFollowUpMessage:a=>window.fixtureMessage(a),setWidgetState:()=>{}};});
   await page.goto('http://127.0.0.1:'+server.address().port);
   assert.equal(await page.getByRole('button',{name:'Allow once',exact:true}).isDisabled(),true);
   await page.evaluate(value=>{window.openai.toolResponseMetadata={status:'success',mcp_tool_result:{_meta:{yBar:value}}};window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{toolResponseMetadata:window.openai.toolResponseMetadata}}}));},bar());
   await page.getByRole('button',{name:'Allow once',exact:true}).waitFor();
  }
  const box=await pages[0].getByRole('button',{name:'Allow once',exact:true}).boundingBox();assert.ok(box.height>=44);
  assert.ok(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await pages[1].getByRole('button',{name:'Deny',exact:true}).click();
  await pages[0].locator('#state').filter({hasText:'Denied'}).waitFor({timeout:10000});assert.equal(decisions,1);
  assert.equal(messages,1);
  await pages[0].evaluate(value=>{window.openai.toolResponseMetadata={yBar:value};window.dispatchEvent(new Event('openai:set_globals'));},bar());
  assert.equal(await pages[0].locator('#state').textContent(),'Denied');
  await pages[0].reload();await pages[0].evaluate(value=>{window.openai.toolResponseMetadata={yBar:value};window.dispatchEvent(new Event('openai:set_globals'));},bar());
  await pages[0].locator('#state').filter({hasText:'Denied'}).waitFor({timeout:6000});assert.equal(messages,1);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});

test('Standard MCP Apps bridge accepts canonical metadata delivered after initialization',async()=>{
 const html=barHtmlForTest(),fixtureBar=bar();let browser;
 const outer='<!doctype html><iframe id="app" style="width:390px;height:700px;border:0" src="/frame"></iframe><script>window.addEventListener("message",event=>{if(event.source!==document.getElementById("app").contentWindow)return;const m=event.data;if(m.method==="ui/initialize"){event.source.postMessage({jsonrpc:"2.0",id:m.id,result:{hostCapabilities:{}}},"*");setTimeout(()=>event.source.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:{call_tool_result:{_meta:{yBar:'+JSON.stringify(fixtureBar)+'}}}},"*"),100);}else if(m.method==="tools/call")event.source.postMessage({jsonrpc:"2.0",id:m.id,result:{structuredContent:{state:"awaiting_user",continuation:"follow-up"}}},"*");});</script>';
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(q.url==='/frame'?html:outer);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);const button=page.frameLocator('#app').getByRole('button',{name:'Allow once',exact:true});await button.waitFor();await assert.doesNotReject(()=>button.click({trial:true,timeout:5000}));}
 finally{await browser?.close();await new Promise(r=>server.close(r));}
});

test('Unsupported standard methods use compatibility once; an uncertain decision is reconciled without replay',async()=>{
 const html=barHtmlForTest(),fixtureBar=bar();let browser;
 const outer='<!doctype html><iframe id="app" style="width:390px;height:700px;border:0" src="/frame"></iframe><script>window.addEventListener("message",event=>{if(event.source!==document.getElementById("app").contentWindow)return;const m=event.data;if(m.method==="ui/initialize")event.source.postMessage({jsonrpc:"2.0",id:m.id,result:{hostCapabilities:{}}},"*");else if(m.id)event.source.postMessage({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"Unsupported fixture method"}},"*");});</script>';
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(q.url==='/frame'?html:outer);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let state='awaiting_user',decisions=0,messages=0,reserved=false;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
  await page.exposeFunction('fixtureCompatibility',async(name,args)=>{
   assert.equal(args.uiToken,fixtureBar.uiToken);
   if(name==='y_bar_decide'){decisions++;state='denied';throw Error('Reply lost after the decision committed');}
   let delivery;
   if(args.notifyAction==='claim'){delivery={granted:!reserved,token:'fixture-delivery',status:reserved?'unconfirmed':'reserved'};reserved=true;}
   if(args.notifyAction==='sent')delivery={status:'sent'};
   return {structuredContent:{state,continuation:'follow-up',delivery}};
  });
  await page.exposeFunction('fixtureContinuation',async()=>{messages++;return {};});
  await page.addInitScript(value=>{window.openai={toolResponseMetadata:{yBar:value},callTool:(n,a)=>window.fixtureCompatibility(n,a),sendFollowUpMessage:()=>window.fixtureContinuation()};},fixtureBar);
  await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frameLocator('#app');await frame.locator('#state').filter({hasText:'Awaiting approval'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('iframe').contentWindow!==null);
  await frame.getByRole('button',{name:'Deny',exact:true}).click();await frame.locator('#state').filter({hasText:'Denied'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('main').dataset.delivery==='sent');
  assert.equal(decisions,1);assert.equal(messages,1);assert.equal(await frame.getByRole('button',{name:'Deny',exact:true}).isVisible(),false);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});

test('Full Access card names the chat scope, duration and explicit action on phone and desktop',async()=>{
 const html=barHtmlForTest(),card={...bar(),presentation:chatAccessPresentation({durationMinutes:120}),chatScope:{eligible:false,explanation:'Only this chat, for the displayed duration.'}};
 let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const viewport of [{width:390,height:844},{width:1100,height:760}]){
   const page=await browser.newPage({viewport});
   await page.addInitScript(value=>{window.openai={toolResponseMetadata:{yBar:value},callTool:async()=>({structuredContent:{state:'awaiting_user'}})};},card);
   await page.route('https://ygpt-fixture.invalid/',route=>route.fulfill({body:html,contentType:'text/html'}));await page.goto('https://ygpt-fixture.invalid/');
   const button=page.getByRole('button',{name:'Enable Full Access',exact:true});await button.waitFor();assert.equal(await button.isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'Always allow in this chat',exact:true}).isVisible(),false);
   assert.match(await page.locator('#target').textContent(),/This chat only.*120 minutes/);
   await page.locator('details').evaluateAll(elements=>elements.forEach(e=>e.open=true));
   assert.match(await page.locator('#impact').textContent(),/Other chats keep/);assert.match(await page.locator('#risk').textContent(),/action=revoke/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   fs.mkdirSync('build',{recursive:true});await page.screenshot({path:'build/chat-access-'+viewport.width+'.png',fullPage:true});await page.close();
  }
 }finally{await browser?.close();}
});
