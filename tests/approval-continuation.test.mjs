import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,unpack,until} from './helpers.mjs';
import {launchFixtureBrowser} from './browser-fixture.mjs';
import {barHtmlForTest} from '../runtime/inline-approval.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

test('Approved command timeout retains the decision and original owned output without a second approval',async()=>{
 const f=fixture(),c=await f.client().start(),marker=path.join(f.project,'once.txt');
 try{
  const script="require('fs').appendFileSync(process.argv[1],'once\\n');console.log('Clear-Disk is a fixture string only');setTimeout(()=>{},10000);";
  const requested=unpack(await c.call('y_process_run',{executable:process.execPath,args:['-e',script,marker],cwd:f.project,timeoutMs:1500}));
  assert.equal(requested.code,'APPROVAL_REQUIRED');const ctx={contextToken:requested.contextToken},args={requestId:requested.requestId,resultToken:requested.resultToken,...ctx};
  const card=await c.call('y_show_approval',args),ui={requestId:requested.requestId,uiToken:card._meta.yBar.uiToken};
  await c.call('y_bar_decide',{...ui,decision:'once'});
  let done;await until(async()=>{done=unpack(await c.call('y_wait_approval',{...args,waitMs:1000}));return !done.continueWaiting;},15000);
  assert.equal(done.state,'unknown');assert.equal(done.decisionSaved,true);assert.equal(done.permissionGranted,true);assert.equal(done.executionError.code,'PROCESS_TIMEOUT');assert.match(done.stateLabel,/Approved.*timed out/);
  const result=done.result.structuredContent;assert.equal(result.error.outcomeUnknown,true);assert.equal(result.result.timeoutMs,1500);assert.ok(result.result.outputToken);
  const original=unpack(await c.call('y_process_poll',{sessionId:result.result.sessionId,outputToken:result.result.outputToken,...ctx}));assert.equal(original.result.state,'timed_out');
  assert.equal((await c.call('y_process_poll',{sessionId:result.result.sessionId,outputToken:result.result.outputToken})).isError,true);
  const repeated=unpack(await c.call('y_bar_decide',{...ui,decision:'once'}));assert.equal(repeated.reused,true);
  const status=unpack(await c.call('y_bar_status',ui));assert.equal(status.permissionGranted,true);assert.equal(status.executionError.code,'PROCESS_TIMEOUT');
  assert.equal(fs.readFileSync(marker,'utf8'),'once\n');
 }finally{await c.close();}
});

test('Repeated bounded waits keep approval and executing work pending, then return the original result once',async()=>{
 const f=fixture(),c=await f.client().start();
 try{
  const requested=unpack(await c.call('y_process_run',{executable:process.execPath,args:['-e',"setTimeout(()=>console.log('Clear-Disk fixture, never executed as a command'),1800)"],cwd:f.project}));assert.equal(requested.code,'APPROVAL_REQUIRED');
  const args={requestId:requested.requestId,resultToken:requested.resultToken,contextToken:requested.contextToken},card=await c.call('y_show_approval',args),ui={requestId:requested.requestId,uiToken:card._meta.yBar.uiToken};
  for(let n=0;n<2;n++){const waiting=unpack(await c.call('y_wait_approval',{...args,waitMs:100}));assert.equal(waiting.state,'awaiting_user');assert.equal(waiting.taskPending,true);assert.equal(waiting.shouldEndTurn,false);assert.equal(waiting.nextAction.tool,'y_wait_approval');assert.equal(waiting.result,null);}
  await c.call('y_bar_decide',{...ui,decision:'once'});
  const running=unpack(await c.call('y_wait_approval',{...args,waitMs:100}));assert.ok(['approved','running'].includes(running.state));assert.equal(running.requiresUserInteraction,false);assert.equal(running.taskPending,true);assert.equal(running.shouldEndTurn,false);assert.equal(running.continueWaiting,true);
  const completed=unpack(await c.call('y_wait_approval',{...args,waitMs:5000}));assert.equal(completed.state,'succeeded');assert.equal(completed.taskPending,false);assert.equal(completed.continueWaiting,false);assert.match(completed.result.structuredContent.result.stdout,/never executed as a command/);
  assert.equal(unpack(await c.call('y_bar_status',ui)).continuation,'result-returned');
  const existing=unpack(await c.call('y_wait_approval',{...args,waitMs:100}));assert.deepEqual(existing.result,completed.result);
 }finally{await c.close();}
});

for(const route of ['wait-ended-without-result','result-returned'])test('A terminal card reconciles '+route+' without replaying the decision',async()=>{
 let browser,state='awaiting_user',active=true,returned=false,decisions=0,messages=0,reads=0,reservations=0,sent=false;
 const bar={requestId:'CONTINUATION_FIXTURE',instanceId:route,uiToken:'private-fixture-only',state,presentation:{title:'Review fixture',target:'No production operation',impact:'Fixture only'},enabled:true,chatScope:{eligible:false}};
 try{
  browser=await launchFixtureBrowser({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.exposeFunction('fixtureContinuationTool',async(name,args)=>{
   const continuation=active?'waiting-tool':returned?'result-returned':'follow-up';
   if(name==='y_bar_decide'){decisions++;state='succeeded';return {structuredContent:{state,continuation}};}
   assert.equal(name,'y_bar_status');reads++;let delivery;
   if(args.notifyAction==='claim'){reservations++;delivery={granted:!sent,token:'fixture-delivery-token',status:sent?'sent':'reserved'};}
   if(args.notifyAction==='sent')sent=true;
   return {structuredContent:{state,continuation,notificationSent:sent,...(delivery?{delivery}:{})}};
  });
  await page.exposeFunction('fixtureContinueChat',()=>{messages++;});
  await page.addInitScript(bar=>{window.openai={toolResponseMetadata:{yBar:bar},callTool:(n,a)=>window.fixtureContinuationTool(n,a),sendFollowUpMessage:()=>window.fixtureContinueChat()};},bar);
  await page.route('https://ygpt-fixture.invalid/',r=>r.fulfill({body:barHtmlForTest(),contentType:'text/html'}));await page.goto('https://ygpt-fixture.invalid/');await until(()=>reads>0);
  await page.getByRole('button',{name:'Allow once',exact:true}).click();await page.locator('#state').filter({hasText:'Completed'}).waitFor();assert.equal(messages,0);assert.equal(decisions,1);
  active=false;returned=route==='result-returned';
  if(returned){await until(()=>page.locator('main').getAttribute('data-delivery').then(x=>x==='returned'),10000);const before=reads;await delay(3400);assert.equal(reads,before);assert.equal(messages,0);assert.equal(reservations,0);}
  else{await until(()=>messages===1,10000);await until(()=>sent);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await delay(200);assert.equal(messages,1);assert.equal(reservations,1);}
  assert.equal(decisions,1);assert.equal(await page.getByRole('button',{name:'Resume chat',exact:true}).isVisible(),false);
 }finally{await browser?.close();}
});
