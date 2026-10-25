import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {YDesktopEngine} from '../engine/src/desktop-engine.mjs';
import {fixture,until} from './helpers.mjs';

test('Deep Chrome extension controls, honest truncation and an actual unpacked-extension reload',{skip:process.platform!=='win32'||!process.env.YGPT_TEST_CHROMIUM,timeout:60000},async()=>{
 const f=fixture(),extension=path.join(f.dir,'extension');fs.mkdirSync(extension);let starts=0,pid,context;
 const receiver=http.createServer((req,res)=>{if(req.url==='/start')starts++;res.setHeader('Cache-Control','no-store');res.end('owned fixture');});await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+receiver.address().port;
 const manifest={manifest_version:3,name:'YGPT Disposable Reload Probe',version:'1.0',host_permissions:[origin+'/*'],background:{service_worker:'worker.js'}};
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(extension,'worker.js'),'fetch('+JSON.stringify(origin+'/start')+',{cache:"no-store"});');
 try{
  // All debugging flags and extension setup belong to this throwaway profile.
  context=await chromium.launchPersistentContext(path.join(f.dir,'profile'),{executablePath:process.env.YGPT_TEST_CHROMIUM,headless:false,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--force-renderer-accessibility','--lang=en-US']});
  const cdp=await context.browser().newBrowserCDPSession();pid=(await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(x=>x.type==='browser').id;
  const page=context.pages()[0];await page.goto('chrome://extensions/');const loaded=await cdp.send('Extensions.loadUnpacked',{path:extension});await until(()=>starts===1);
  const desktop=new YDesktopEngine({stateDir:f.dir,currentOwner:()=>'owned-chrome-fixture'}),win=await until(async()=>(await desktop.windows()).windows.find(w=>w.pid===pid&&w.title.startsWith('Extensions - ')));desktop.enrollFromBroker(win.pid,win.birth);const {targetId}=await desktop.bind(win.hwnd);
  const shallow=(await desktop.act(targetId,'tree',{maxDepth:8})).result;assert.equal(shallow.truncated,true);assert.ok(shallow.truncationReasons.includes('maxDepth'));assert.ok(!shallow.elements.some(e=>e.automationId==='dev-reload-button'));
  let tree=(await desktop.act(targetId,'tree')).result;assert.equal(tree.truncated,false);assert.ok(tree.elements.some(e=>e.automationId==='dev-reload-button'&&e.depth>8));
  const dev=tree.elements.find(e=>e.automationId==='devMode');assert.ok(['On','Off'].includes(dev.toggleState));if(dev.toggleState==='Off')await desktop.act(targetId,'click',{runtimeId:dev.runtimeId});
  tree=(await desktop.act(targetId,'tree')).result;assert.equal(tree.elements.find(e=>e.automationId==='devMode').toggleState,'On');
  const reloads=tree.elements.filter(e=>e.name==='Reload'&&e.type==='ControlType.Button');assert.ok(reloads.length>=2,'Page reload and extension reload must stay distinct');const reload=reloads.find(e=>e.automationId==='dev-reload-button');assert.ok(reload);
  const subtree=(await desktop.act(targetId,'tree',{runtimeId:reload.runtimeId})).result;assert.equal(subtree.scoped,true);assert.equal(subtree.elements[0].runtimeId,reload.runtimeId);assert.equal(subtree.truncated,false);
  manifest.version='1.1';fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));const clicked=await desktop.act(targetId,'invoke',{runtimeId:reload.runtimeId});assert.equal(clicked.result.method,'browser-verified-pointer-click');await until(()=>starts===2);
  const actual=(await cdp.send('Extensions.getExtensions')).extensions.find(e=>e.id===loaded.id);assert.equal(actual.version,'1.1');assert.equal(actual.enabled,true);
  const evidence={scope:'Actual Windows UIA and Chrome in a disposable profile; no personal browser or real extension touched',shallowDepth8ReportedTruncated:true,deepReloadVisible:true,distinctReloadButtons:true,developerModeStateVerified:true,scopedInspectionPassed:true,verifiedPointerClick:true,extensionVersionBefore:'1.0',extensionVersionAfter:actual.version,extensionEnabled:actual.enabled,workerStarts:starts,at:new Date().toISOString()};
  fs.mkdirSync('build',{recursive:true});fs.writeFileSync('build/desktop-extension-smoke.json',JSON.stringify(evidence,null,2));
 }finally{
  // Stop only the process returned by this fixture's own browser connection.
  if(pid)try{process.kill(pid);}catch(e){if(e.code!=='ESRCH')throw e;}
  if(context)await context.close();await new Promise(r=>receiver.close(r));
 }
});
