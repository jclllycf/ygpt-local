import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {ExtensionRelay} from '../engine/src/extension-relay.mjs';
import {YBrowserFacade,YExtensionBrowser} from '../engine/src/browser-engine.mjs';

async function extensionFixture(t){
  const calls=[],responses=[],listeners={};
  const event=name=>({addListener(fn){listeners[name]=fn;}});
  const tabs=new Map([[1,{id:1,groupId:-1,windowId:1,url:'https://personal.invalid/private',title:'Personal secret'}],[2,{id:2,groupId:7,windowId:1,url:'https://work.invalid/',title:'Work'}]]);
  const chrome={
    storage:{local:{get:async()=>({ygptInstanceId:'fixture'}),set:async()=>{}}},
    identity:{getProfileUserInfo:async()=>({})},
    windows:{getLastFocused:async()=>({id:1})},
    tabs:{query:async()=>[...tabs.values()],get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);},
      create:async()=>{const tab={id:3,windowId:1,groupId:-1};tabs.set(3,tab);return tab;},
      group:async()=>7,remove:async id=>{calls.push(['remove',id]);tabs.delete(id);},
      onCreated:event('tabCreated'),onUpdated:event('tabUpdated'),onRemoved:event('tabRemoved')},
    tabGroups:{query:async()=>[{id:7,windowId:1,title:'YGPT'}],update:async()=>{},onCreated:event('groupCreated'),onRemoved:event('groupRemoved'),onUpdated:event('groupUpdated')},
    debugger:{attach:async target=>{calls.push(['attach',target.tabId]);},detach:async target=>{calls.push(['detach',target.tabId]);},sendCommand:async(target,method)=>{calls.push(['send',target.tabId,method]);return {};},onEvent:event('debuggerEvent'),onDetach:event('debuggerDetach')},
    alarms:{create(){},onAlarm:event('alarm')},runtime:{onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message')}
  };
  const timers=new Set();
  const context=vm.createContext({chrome,crypto:globalThis.crypto,navigator:{userAgent:'Chrome'},Uint8Array,WebSocket:{OPEN:1},
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms).unref();timers.add(timer);return timer;},clearTimeout,
    transport:{readyState:1,send:raw=>responses.push(JSON.parse(raw))}});
  vm.runInContext(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8'),context);
  await new Promise(r=>setImmediate(r));
  vm.runInContext('ws=transport',context);
  t.after(()=>{for(const timer of timers)clearTimeout(timer);});
  const request=async(method,params={})=>{context.requestArg=JSON.stringify({type:'req',reqId:responses.length+1,method,params});await vm.runInContext('onRequest(requestArg)',context);return responses.at(-1);};
  return {request,calls,tabs,chrome,listeners,context};
}

test('Extension counts personal tabs without returning their metadata; commands stay in the group',async t=>{
  const f=await extensionFixture(t);
  const listed=await f.request('tabs.list');
  assert.equal(listed.result.totalTabs,2);assert.deepEqual(listed.result.tabs.map(t=>t.tabId),[2]);
  assert.ok(!JSON.stringify(listed).includes('Personal secret'));
  for(const method of ['debugger.attach','debugger.send','tabs.close'])assert.equal((await f.request(method,{tabId:1,method:'Runtime.evaluate'})).ok,false);
  assert.deepEqual(f.calls,[]);
  assert.equal((await f.request('debugger.attach',{tabId:2})).ok,true);
  f.tabs.get(2).groupId=-1;
  assert.equal((await f.request('debugger.send',{tabId:2,method:'Runtime.evaluate'})).ok,false);
  assert.deepEqual(f.calls,[['attach',2],['detach',2]]);
});

test('Extension coalesces debugger attaches and cleans up a tab when grouping fails',async t=>{
  const f=await extensionFixture(t);
  await Promise.all([f.request('debugger.attach',{tabId:2}),f.request('debugger.attach',{tabId:2})]);
  assert.equal(f.calls.filter(c=>c[0]==='attach').length,1);
  assert.equal((await f.request('debugger.send',{tabId:2,method:'Target.attachToTarget',params:{targetId:'foreign'}})).ok,false);
  f.chrome.tabs.group=async()=>{throw Error('window closed');};
  assert.equal((await f.request('tabs.create',{url:'https://work.invalid'})).ok,false);
  assert.ok(!f.tabs.has(3));assert.ok(f.tabs.has(1));
});

test('Extension forwards CDP events synchronously and in order, only for attached group tabs',async t=>{
  const f=await extensionFixture(t);
  await f.request('debugger.attach',{tabId:2});
  const events=[];
  const original=f.context.transport.send;
  f.context.transport.send=raw=>{const m=JSON.parse(raw);if(m.kind==='cdp')events.push(m.method);original(raw);};
  // No await between the events and the check: forwarding must be synchronous,
  // so a later command response can never overtake an earlier event.
  f.listeners.debuggerEvent({tabId:2},'Page.frameNavigated',{});
  f.listeners.debuggerEvent({tabId:1},'Network.requestWillBeSent',{url:'https://personal.invalid/private'});
  f.listeners.debuggerEvent({tabId:2},'Runtime.executionContextCreated',{});
  assert.deepEqual(events,['Page.frameNavigated','Runtime.executionContextCreated']);
});

test('Extension dispatches one tab\'s commands in arrival order although each group check is asynchronous',async t=>{
  const f=await extensionFixture(t);
  await f.request('debugger.attach',{tabId:2});
  // The first group check is slow, the second fast: dispatch order must still follow arrival order.
  const get=f.chrome.tabs.get;let n=0;
  f.chrome.tabs.get=async id=>{const delay=n++===0?40:0;await new Promise(r=>setTimeout(r,delay));return get(id);};
  const send=(reqId,method)=>vm.runInContext('onRequest('+JSON.stringify(JSON.stringify({type:'req',reqId,method:'debugger.send',params:{tabId:2,method}}))+')',f.context);
  await Promise.all([send(101,'Input.dispatchMouseEvent:pressed'),send(102,'Input.dispatchMouseEvent:released')]);
  assert.deepEqual(f.calls.filter(c=>c[0]==='send').map(c=>c[2]),['Input.dispatchMouseEvent:pressed','Input.dispatchMouseEvent:released']);
});

test('Extension sends a keepalive while connected and stops when the socket is replaced',async t=>{
  const f=await extensionFixture(t);
  let tick=null,cleared=0;
  f.context.setInterval=fn=>{tick=fn;return 1;};f.context.clearInterval=()=>{cleared++;};
  const sent=[];const original=f.context.transport.send;f.context.transport.send=raw=>{sent.push(JSON.parse(raw).type);original(raw);};
  vm.runInContext('startKeepalive(ws)',f.context);
  assert.equal(vm.runInContext('KEEPALIVE_MS',f.context)<30000,true,'keepalive interval stays below the 30 s worker idle limit');
  tick();assert.deepEqual(sent,['ping']);
  vm.runInContext('ws={readyState:1,send(){}}',f.context);
  tick();assert.deepEqual(sent,['ping'],'a replaced socket gets no keepalive');assert.ok(cleared>0);
});

async function relayFixture(t){
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-relay-safety-'));
  const relay=new ExtensionRelay({stateDir,port:0});await relay.start();
  t.after(async()=>{await relay.stop();await fs.rm(stateDir,{recursive:true,force:true});});
  return relay;
}
async function fakeExtension(relay,id='fixture'){
  const calls=[],tabs=[{tabId:2,inGroup:true,title:'Work',url:'https://work.invalid/'},{tabId:1,inGroup:false,title:'Personal',url:'https://personal.invalid/'}];
  let failClose=false;
  const ws=new WebSocket(relay.endpoint().replace('http:','ws:')+'/ext?token='+relay.token);
  ws.on('message',raw=>{
    const m=JSON.parse(raw);calls.push(m);let result={};
    if(m.method==='tabs.list')result={tabs,totalTabs:tabs.length};
    if(m.method==='debugger.send'&&m.params.method==='Page.getFrameTree')result={frameTree:{frame:{id:id+'-frame-'+m.params.tabId}}};
    ws.send(JSON.stringify({type:'res',reqId:m.reqId,ok:!(m.method==='tabs.close'&&failClose),result,error:'close failed'}));
  });
  await once(ws,'open');ws.send(JSON.stringify({type:'hello',id,browser:'Chrome'}));
  for(let i=0;i<100&&relay.instances.get(id)?.ws.readyState!==WebSocket.OPEN;i++)await new Promise(r=>setTimeout(r,5));
  // Ensure replacement hello has been processed even while the old id exists.
  await new Promise(r=>setTimeout(r,10));
  return {ws,calls,tabs,failClose:()=>{failClose=true;}};
}
async function cdpClient(relay){
  const ws=new WebSocket(relay.endpoint().replace('http:','ws:')+'/devtools/browser/ygpt');
  const pending=new Map();let seq=0;
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
  await once(ws,'open');
  return {ws,send:(method,params={},sessionId)=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params,sessionId}));})};
}

test('Relay rejects foreign targets, rechecks moved tabs, and reports failed closes',async t=>{
  const relay=await relayFixture(t),ext=await fakeExtension(relay);relay.bind('fixture');const c=await cdpClient(relay);
  assert.match((await c.send('Target.attachToTarget',{targetId:'1'})).error.message,/group/);
  assert.match((await c.send('Target.closeTarget',{targetId:'1'})).error.message,/group/);
  assert.ok(!ext.calls.some(c=>['debugger.attach','tabs.close'].includes(c.method)&&c.params.tabId===1));
  const attached=await c.send('Target.attachToTarget',{targetId:'2'}),sid=attached.result.sessionId;
  const info=await c.send('Target.getTargetInfo',{targetId:'fixture-frame-2'});assert.equal(info.result.targetInfo.type,'page');
  ext.failClose();assert.match((await c.send('Target.closeTarget',{targetId:'2'})).error.message,/close failed/);
  ext.tabs[0].inGroup=false;
  assert.match((await c.send('Runtime.evaluate',{expression:'document.title'},sid)).error.message,/group/);
  assert.ok(!ext.calls.some(c=>c.method==='debugger.send'&&c.params.method==='Runtime.evaluate'));
});

test('Relay dispatches one tab\'s commands in arrival order and rejects unknown sessions',async t=>{
  const relay=await relayFixture(t),ext=await fakeExtension(relay);relay.bind('fixture');const c=await cdpClient(relay);
  const sid=(await c.send('Target.attachToTarget',{targetId:'2'})).result.sessionId;
  // Delay only the next group check (tabs.list), so a naive relay would let
  // the second command overtake the first.
  const original=ext.ws.listeners('message')[0];ext.ws.removeAllListeners('message');let delayed=false;
  ext.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='tabs.list'&&!delayed){delayed=true;setTimeout(()=>original(raw),40);return;}original(raw);});
  const [first,second]=await Promise.all([c.send('Input.dispatchMouseEvent',{type:'mousePressed'},sid),c.send('Input.dispatchMouseEvent',{type:'mouseReleased'},sid)]);
  assert.ok(first.result&&second.result,'both commands answered');
  assert.deepEqual(ext.calls.filter(m=>m.method==='debugger.send'&&m.params.method==='Input.dispatchMouseEvent').map(m=>m.params.params.type),['mousePressed','mouseReleased']);
  const unknown=await c.send('Runtime.evaluate',{expression:'1'},'ygpt-session-unknown');
  assert.equal(unknown.error?.code,-32001);
  assert.equal((await c.send('Target.detachFromTarget',{},'ygpt-session-unknown')).error,undefined,'detaching an unknown session stays harmless');
});

test('Relay replacement retains the new extension, disconnects old CDP clients and clears frame IDs',async t=>{
  const relay=await relayFixture(t);await fakeExtension(relay);relay.bind('fixture');const c=await cdpClient(relay);
  await c.send('Target.attachToTarget',{targetId:'2'});assert.equal(relay.frameIds.size,1);
  const closed=once(c.ws,'close');const next=await fakeExtension(relay);await closed;
  assert.equal(relay.instancesList().length,1);assert.equal(relay.boundId,null);assert.equal(relay.frameIds.size,0);
  assert.equal(next.ws.readyState,WebSocket.OPEN);
});

test('Relay blocks hostile web origins and DNS rebinding hosts',async t=>{
  const relay=await relayFixture(t);
  assert.equal((await fetch(relay.endpoint()+'/',{headers:{Origin:'https://attacker.invalid'}})).status,403);
  const rebound=await new Promise((resolve,reject)=>{http.get(relay.endpoint()+'/',{headers:{Host:'attacker.invalid:'+relay.port}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
  assert.equal(rebound,403);
  for(const pathname of ['/devtools/browser/ygpt','/ext?token='+relay.token]){
    const ws=new WebSocket(relay.endpoint().replace('http:','ws:')+pathname,{origin:'https://attacker.invalid'});
    await assert.rejects(once(ws,'open'));
  }
  const page=await fetch(relay.endpoint()+'/');assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
});

test('Relay startup retries after a busy port; facade shutdown releases the listener',async t=>{
  const busy=http.createServer();busy.listen(0,'127.0.0.1');await once(busy,'listening');
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-relay-retry-'));
  const facade=new YBrowserFacade({stateDir,extension:{port:busy.address().port}});
  t.after(async()=>{await facade.close();await fs.rm(stateDir,{recursive:true,force:true});});
  await assert.rejects(facade.existing.ensureRelay(),{code:'EADDRINUSE'});
  await new Promise(r=>busy.close(r));await facade.existing.ensureRelay();
  const port=facade.existing.relay.port;await facade.close();
  const probe=http.createServer();probe.listen(port,'127.0.0.1');await once(probe,'listening');await new Promise(r=>probe.close(r));
});

test('Attached status exposes only the calling chat tabs and account selectors never guess',async()=>{
  let owner='chat-a';const engine=new YExtensionBrowser({stateDir:'/unused',currentOwner:()=>owner});
  const page={url:()=> 'https://private-chat.invalid/',on(){}};engine.track(page);
  owner='chat-b';assert.deepEqual(engine.status().tabs,[]);
  engine.ensureRelay=async()=>{};engine.relay.instancesList=()=>[{id:'a',browser:'Chrome',profileEmail:'a@example.com'},{id:'b',browser:'Chrome',profileEmail:'b@example.com'}];
  const result=await engine.attach({instance:'Chrome'});assert.equal(result.needsChoice,true);assert.equal(result.candidates.length,2);
});
