import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {launchFixtureBrowser} from './browser-fixture.mjs';
import {barHtmlForTest} from '../runtime/inline-approval.mjs';
test('Branded approval bundle executes with its real browser CSP; not a ChatGPT host test',async()=>{
 const html=barHtmlForTest(),server=http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await launchFixtureBrowser({channel:'msedge',headless:true});const page=await browser.newPage(),violations=[];page.on('console',m=>{if(/content security policy|refused to execute|refused to apply/i.test(m.text()))violations.push(m.text());});await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#note').filter({hasText:'Open this component inside the YGPT app in ChatGPT.'}).waitFor({timeout:5000});assert.equal(await page.getByRole('button',{name:'Allow once',exact:true}).isDisabled(),true);assert.deepEqual(violations,[]);assert.ok(await page.locator('.mark img').evaluate(img=>img.complete&&img.naturalWidth>=512));fs.mkdirSync('build',{recursive:true});await page.screenshot({path:'build/approval-rc18.png'});}
 finally{await browser?.close();await new Promise(r=>server.close(r));}
});
test('Browser fixtures handle current metadata with the matching App tool names; not host attestation',async()=>{
 const html=barHtmlForTest(),server=http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await launchFixtureBrowser({channel:'msedge',headless:true});
  for(const legacy of [false]){
   const page=await browser.newPage();
   await page.addInitScript(({legacy})=>{
    const bar={requestId:'LOCAL_UI_FIXTURE',uiToken:'fixture-only',presentation:{title:'YGPT fixture',target:'No real action',impact:'No execution'},chatScope:{eligible:true},state:'awaiting_user',expiresAt:new Date(Date.now()+60000).toISOString(),enabled:true};
    window.fixtureCalls=[];let state='awaiting_user';
    window.openai={toolResponseMetadata:legacy?{yukiBar:bar}:{yBar:bar},callTool:async(name,args)=>{
     window.fixtureCalls.push(name);if(name.endsWith('bar_decide'))state=args.decision==='deny'?'denied':'succeeded';
     return {structuredContent:{state,continuation:'waiting-tool'}};
    }};
   },{legacy});
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.getByRole('button',{name:'Deny',exact:true}).click();
   await page.locator('#state').filter({hasText:'Denied'}).waitFor();
   const calls=await page.evaluate(()=>window.fixtureCalls);
   assert.ok(calls.includes(legacy?'yuki_bar_decide':'y_bar_decide'),JSON.stringify(calls));
   await page.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
