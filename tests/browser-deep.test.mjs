import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {AsyncLocalStorage} from 'node:async_hooks';
import {waitForBrowser,BrowserDiagnostics} from '../engine/src/browser-diagnostics.mjs';import {BrowserExtensions} from '../engine/src/browser-extensions.mjs';import {YDesktopEngine} from '../engine/src/desktop-engine.mjs';import {ApprovalNotifications} from '../runtime/approval-notifications.mjs';import {launchFixtureBrowser} from './browser-fixture.mjs';import {fixture,unpack,decide} from './helpers.mjs';
import {withoutImageBytes} from '../runtime/screenshot-cleanup.mjs';

test('Transient browser observations reach the live caller but are omitted from local ledger payloads',()=>{
 const live={ok:true,result:{transientObservation:true,value:'fixture-private-observation'}},reply={structuredContent:live,content:[{type:'text',text:JSON.stringify(live)}]};assert.ok(JSON.stringify(reply).includes('fixture-private-observation'));assert.ok(!JSON.stringify(withoutImageBytes(reply)).includes('fixture-private-observation'));assert.ok(!JSON.stringify(withoutImageBytes(live)).includes('fixture-private-observation'));assert.equal(live.result.value,'fixture-private-observation');
});

test('Read-only browser wait times out normally, can sample again and preserves foreign ownership errors',async()=>{
 let ready=false;const page={isClosed:()=>false},browser={page:()=>page,locator:()=>({waitFor:async()=>{if(!ready)throw Object.assign(Error('deadline'),{name:'TimeoutError'});}}),snapshot:async()=>({observed:true})};
 assert.deepEqual((await waitForBrowser(browser,'tab',{},{})).status,'timeout');ready=true;assert.equal((await waitForBrowser(browser,'tab',{},{})).status,'satisfied');
 browser.page=()=>{throw Object.assign(Error('foreign'),{code:'SESSION_FOREIGN'});};await assert.rejects(waitForBrowser(browser,'tab',{},{}),/foreign/);
});

test('Debugging collects bounded redacted logs, exposes network request IDs and reads a response through the same CDP session',async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type',q.url.startsWith('/data')?'application/json':'text/html');r.end(q.url.startsWith('/data')?'[1,2,3]':'<!doctype html><title>YGPT owned fixture</title>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await launchFixtureBrowser({channel:'msedge',headless:true});const page=await browser.newPage(),diag=new BrowserDiagnostics();diag.track(page);await page.goto('http://127.0.0.1:'+server.address().port);assert.equal((await diag.run(page,{})).cdpAvailable,true);
 await page.evaluate(async()=>{console.log('token=fixture-secret');await fetch('/data?token=fixture-secret').then(r=>r.text());});
 const logs=await diag.run(page,{action:'console'});assert.ok(JSON.stringify(logs).includes('[REDACTED]'));assert.ok(!JSON.stringify(logs).includes('fixture-secret'));
 const network=await diag.run(page,{action:'network'}),entry=network.entries.find(e=>e.url?.endsWith('/data'));assert.ok(entry?.requestId);assert.ok(!JSON.stringify(network).includes('fixture-secret'));
 const body=await diag.run(page,{action:'cdp',method:'Network.getResponseBody',params:{requestId:entry.requestId}});assert.equal(body.result.body,'[1,2,3]');
 assert.equal((await diag.run(page,{action:'evaluate',expression:"'x'.repeat(100000)"})).value.truncated,true);await assert.rejects(diag.run(page,{action:'cdp',method:'Browser.close'}),/tab-scoped/);
 await page.close();assert.equal(diag.pages.get(page).network.length,0);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});

test('Extension operations serialize per chat, isolate sessions and preserve uncertain mutation outcomes',async()=>{
 const scope=new AsyncLocalStorage(),started=[],clients=[];let running=0;
 const adapter=new BrowserExtensions({stateDir:os.tmpdir(),root:process.cwd(),currentOwner:()=>scope.getStore(),connect:async()=>{const client={listTools:async()=>({tools:[{name:'list_extensions'}]}),callTool:async({name})=>{assert.equal(running,0);running++;started.push(name);await new Promise(r=>setTimeout(r,15));running--;if(name==='reload_extension')throw Error('disconnected');return {content:[{type:'text',text:'fixture'}]};},close:async()=>{client.closed=true;}};clients.push(client);return client;}});
 try{await scope.run('chat-one',()=>Promise.all([adapter.run({action:'list'}),adapter.run({action:'list'})]));assert.equal(clients.length,1);await scope.run('chat-two',()=>adapter.run({action:'status'}));assert.equal(clients.length,2);
 await assert.rejects(scope.run('chat-one',()=>adapter.run({action:'reload',id:'a'.repeat(32)})),e=>e.outcomeUnknown===true&&e.effectStarted===true);
 await adapter.closeContext('chat-one');assert.equal(clients[0].closed,true);assert.equal(clients[1].closed,undefined);
 }finally{await adapter.close();}
});

test('Shared desktop input queues while read-only inspection remains available and window ownership stays separate',async()=>{
 const scope=new AsyncLocalStorage(),desktop=new YDesktopEngine({currentOwner:()=>scope.getStore()});const events=[];let release;
 desktop.verified=async id=>{if(id!==scope.getStore())throw Error('foreign');return {hwnd:'fixture'};};desktop.request=async({action})=>{events.push(action);if(action==='click')await new Promise(r=>release=r);return {};};
 const one=scope.run('one',()=>desktop.act('one','click')),two=scope.run('two',()=>desktop.act('two','keys'));await new Promise(r=>setTimeout(r,10));await scope.run('two',()=>desktop.act('two','tree'));assert.deepEqual(events,['click','tree']);release();await Promise.all([one,two]);assert.deepEqual(events,['click','tree','keys']);await assert.rejects(scope.run('one',()=>desktop.act('two','keys')),/foreign/);
});

test('Approval notifications identify chats, batch pending requests and omit already resolved requests',async()=>{
 const messages=[],pending=new Set(['one','two']);const notices=new ApprovalNotifications({enabled:true,send:async m=>messages.push(m),isPending:id=>pending.has(id)});
 try{assert.equal(notices.enqueue({id:'one',state:'awaiting_user',chatLabel:'Build app',tool:'y_process_run'}),true);assert.equal(notices.enqueue({id:'one',state:'awaiting_user'}),false);notices.enqueue({id:'two',state:'awaiting_user',chatLabel:'Check browser',tool:'y_desktop_bind'});pending.delete('two');await notices.flush();assert.equal(messages.length,1);assert.match(messages[0].body,/Build app/);assert.ok(!messages[0].body.includes('Check browser'));
 }finally{notices.close();}
});

test('A pending approval in one chat does not block parallel work or labels in another chat',async()=>{
 const f=fixture(),c=await f.client().start();try{const hold=unpack(await c.call('y_chat_access',{action:'request_full',label:'Pending fixture'}));assert.equal(hold.code,'APPROVAL_REQUIRED');
 const other=unpack(await c.call('y_chat_access',{label:'Working fixture'}));assert.notEqual(other.contextToken,hold.contextToken);assert.equal(other.chatLabel,'Working fixture');
 const results=await Promise.all(Array.from({length:8},()=>c.call('y_file_list',{path:f.project,contextToken:other.contextToken})));assert.ok(results.every(r=>unpack(r).ok));assert.equal(unpack(await c.call('y_call_status',{id:hold.requestId})).state,'awaiting_user');await decide(c,hold,'deny');
 }finally{await c.close();}
});

test('Official developer browser installs, inventories, reloads and removes an owned unpacked extension',{skip:process.env.YGPT_TEST_EXTENSION_DEVTOOLS!=='1',timeout:120000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-devtools-test-')),ext=path.join(dir,'extension');await fs.mkdir(ext);await fs.writeFile(path.join(ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'YGPT disposable extension',version:'1.0',background:{service_worker:'worker.js'},action:{}}));await fs.writeFile(path.join(ext,'worker.js'),"chrome.action.onClicked.addListener(()=>{});");const adapter=new BrowserExtensions({stateDir:path.join(dir,'state'),root:dir});
 try{const installed=await adapter.run({action:'install',target:'developer',extensionPath:ext});assert.equal(installed.ok,true,JSON.stringify(installed));const id=JSON.stringify(installed.result).match(/[a-p]{32}/)?.[0];assert.ok(id);assert.equal((await adapter.run({action:'list',target:'developer'})).ok,true);assert.equal((await adapter.run({action:'reload',target:'developer',id})).ok,true);assert.equal((await adapter.run({action:'trigger',target:'developer',id})).ok,true);assert.equal((await adapter.run({action:'uninstall',target:'developer',id})).ok,true);
 }finally{await adapter.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});
