import test from 'node:test';
import assert from 'node:assert/strict';
import {launchFixtureBrowser} from './browser-fixture.mjs';
import {barHtmlForTest} from '../runtime/inline-approval.mjs';
import {until} from './helpers.mjs';

test('Notification reconciliation and restored terminal cards retain the real command error on phone and desktop',async()=>{
 let browser;
 try{
  browser=await launchFixtureBrowser({channel:'msedge',headless:true});
  for(const viewport of [{width:390,height:844},{width:1100,height:760}])for(const restored of [false,true]){
   const page=await browser.newPage({viewport});let state=restored?'failed':'awaiting_user',decisions=0,sent=false,reads=0;
   const failed={state:'failed',tool:'y_process_run',permissionGranted:true,decisionSaved:true,stateLabel:'Approved · command timed out',executionError:{code:'PROCESS_TIMEOUT',message:'Command reached its execution time limit (16000 ms).',outcomeUnknown:true}};
   const card={requestId:'OUTCOME_FIXTURE',instanceId:'fresh',uiToken:'fixture-only',state,enabled:!restored,presentation:{title:'Review local command',target:'Fixture only'},chatScope:{eligible:false}};
   await page.exposeFunction('outcomeFixtureTool',async(name,args)=>{
    if(name==='y_bar_decide'){decisions++;state='failed';return {structuredContent:{state:'approved',decisionSaved:true,continuation:'follow-up'}};}
    assert.equal(name,'y_bar_status');reads++;
    if(args.notifyAction==='sent')sent=true;
    return {structuredContent:{...(state==='failed'?failed:{state}),continuation:'follow-up',notificationSent:sent,...(args.notifyAction==='claim'?{delivery:{granted:true,token:'fixture-notification'}}:{})}};
   });
   await page.addInitScript(card=>{window.openai={toolResponseMetadata:{yBar:card},callTool:(n,a)=>window.outcomeFixtureTool(n,a),sendFollowUpMessage:async()=>({})};},card);
   await page.route('https://ygpt-outcome.invalid/',r=>r.fulfill({body:barHtmlForTest(),contentType:'text/html'}));await page.goto('https://ygpt-outcome.invalid/');await until(()=>reads>0);
   if(!restored)await page.getByRole('button',{name:'Allow once',exact:true}).click();
   await page.locator('#state').filter({hasText:'Approved · command timed out'}).waitFor();
   await until(async()=>/PROCESS_TIMEOUT/.test(await page.locator('#note').textContent()));
   const note=await page.locator('#note').textContent();assert.match(note,/Approval saved/);assert.match(note,/16000 ms/);assert.match(note,/no command was resubmitted/);assert.doesNotMatch(note,/desktop|Inspect the window/);
   await page.evaluate(()=>{const old=window.openai.toolResponseMetadata.yBar;window.openai.toolResponseMetadata={yBar:{...old,state:'awaiting_user',instanceId:'stale-metadata'}};window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{}}}));});
   assert.match(await page.locator('#note').textContent(),/PROCESS_TIMEOUT/);assert.equal(await page.locator('#actions').isVisible(),false);assert.equal(decisions,restored?0:1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.close();
  }
 }finally{await browser?.close();}
});
