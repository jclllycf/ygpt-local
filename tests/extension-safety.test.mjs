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

async function extensionFixture(t,saved={}){
  const calls=[],responses=[],listeners={},store={ygptInstanceId:'fixture',...saved};
  const event=name=>({addListener(fn){listeners[name]=fn;}});
  const tabs=new Map([[1,{id:1,groupId:-1,windowId:1,url:'https://personal.invalid/private',title:'Personal secret'}],[2,{id:2,groupId:7,windowId:1,url:'https://work.invalid/',title:'Work'}]]);
  const chrome={
    storage:{local:{get:async()=>({...store}),set:async o=>{Object.assign(store,JSON.parse(JSON.stringify(o)));}}},
    identity:{getProfileUserInfo:async()=>({})},
    windows:{getLastFocused:async()=>({id:1})},
    tabs:{query:async()=>[...tabs.values()],get:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);},
      create:async()=>{const tab={id:3,windowId:1,groupId:-1};tabs.set(3,tab);return tab;},
      group:async()=>7,remove:async id=>{calls.push(['remove',id]);tabs.delete(id);},
      onCreated:event('tabCreated'),onUpdated:event('tabUpdated'),onRemoved:event('tabRemoved')},
    tabGroups:{query:async q=>[{id:7,windowId:1,title:'YGPT'}].filter(g=>q?.windowId==null||g.windowId===q.windowId),update:async()=>{},onCreated:event('groupCreated'),onRemoved:event('groupRemoved'),onUpdated:event('groupUpdated')},
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
  return {request,calls,tabs,chrome,listeners,context,store};
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

test('Extension reports a group tab opener only when the opener is a group tab too',async t=>{
  const f=await extensionFixture(t);
  f.tabs.set(4,{id:4,groupId:7,windowId:1,openerTabId:2,url:'https://work.invalid/popup',title:'Popup'});
  f.tabs.set(5,{id:5,groupId:7,windowId:1,openerTabId:1,url:'https://work.invalid/from-personal',title:'From personal'});
  const listed=await f.request('tabs.list');
  assert.deepEqual(listed.result.tabs.map(t=>[t.tabId,t.openerTabId]),[[2,null],[4,2],[5,null]]);
});

test('Popup Save with an empty token field keeps the saved pairing',async t=>{
  const f=await extensionFixture(t,{ygptSettings:{host:'127.0.0.1',port:19341,token:'paired-token',groupName:'YGPT'}});
  const save=settings=>new Promise(r=>f.listeners.message({kind:'save-settings',settings},{},r));
  await save({host:'127.0.0.1',port:19342,token:''});
  assert.equal(f.store.ygptSettings.token,'paired-token','the popup never shows the token, so empty means keep it');
  assert.equal(f.store.ygptSettings.port,19342);
  await save({host:'127.0.0.1',port:19342,token:'new-token'});
  assert.equal(f.store.ygptSettings.token,'new-token');
});

test('Extension opens group tabs in a normal window and groups them where Chrome placed them',async t=>{
  const f=await extensionFixture(t);
  let asked,grouped;
  // A focused popup (id 9): Chrome opens the tab in a normal window (4) instead.
  f.chrome.windows.getLastFocused=async q=>{asked=JSON.parse(JSON.stringify(q??null));return {id:9};};
  f.chrome.tabs.create=async()=>{const tab={id:5,windowId:4,groupId:-1};f.tabs.set(5,tab);return tab;};
  f.chrome.tabs.group=async p=>{grouped=JSON.parse(JSON.stringify(p));return 8;};
  const created=await f.request('tabs.create',{url:'https://work.invalid/'});
  assert.equal(created.ok,true,created.error);
  assert.deepEqual(asked,{windowTypes:['normal']});
  assert.deepEqual(grouped,{createProperties:{windowId:4},tabIds:[5]});
  assert.equal(created.result.windowId,4);
});

test('Extension reports a debugger session Chrome ended, once, and never one it detached itself',async t=>{
  const f=await extensionFixture(t);
  const events=[];const original=f.context.transport.send;
  f.context.transport.send=raw=>{const m=JSON.parse(raw);if(m.kind==='detached')events.push(m);original(raw);};
  await f.request('debugger.attach',{tabId:2});
  f.listeners.debuggerDetach({tabId:2},'canceled_by_user');
  f.listeners.debuggerDetach({tabId:2},'canceled_by_user');
  f.listeners.debuggerDetach({tabId:1},'target_closed');
  assert.deepEqual(events,[{type:'event',kind:'detached',tabId:2,reason:'canceled_by_user'}]);
  await f.request('debugger.attach',{tabId:2});await f.request('debugger.detach',{tabId:2});
  f.listeners.debuggerDetach({tabId:2},'target_closed');
  assert.equal(events.length,1,'a detach the relay asked for is not reported back');
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
  const ws=new WebSocket(relay.endpoint().replace('http:','ws:')+'/devtools/browser/ygpt',{headers:relay.cdpHeaders()});
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

test('Relay ends sessions Chrome detached; Cancel on the debugging bar ends the take-over',async t=>{
  const relay=await relayFixture(t),ext=await fakeExtension(relay);relay.bind('fixture');const c=await cdpClient(relay);
  const events=[];c.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.method)events.push(m);});
  const sid=(await c.send('Target.attachToTarget',{targetId:'2'})).result.sessionId;
  ext.ws.send(JSON.stringify({type:'event',kind:'detached',tabId:2,reason:'target_closed'}));
  for(let i=0;i<200&&!events.some(e=>e.method==='Target.detachedFromTarget');i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(events.find(e=>e.method==='Target.detachedFromTarget')?.params,{sessionId:sid,targetId:'fixture-frame-2'});
  assert.equal((await c.send('Runtime.evaluate',{expression:'1'},sid)).error?.code,-32001,'the dead session is gone, not silently re-attached');
  assert.equal(relay.boundId,'fixture','a single tab detaching keeps the take-over');
  const again=(await c.send('Target.attachToTarget',{targetId:'fixture-frame-2'})).result.sessionId;
  assert.ok(again&&again!==sid,'the tab can be attached again with a fresh session');
  const closed=once(c.ws,'close');
  ext.ws.send(JSON.stringify({type:'event',kind:'detached',tabId:2,reason:'canceled_by_user'}));
  await closed;
  assert.equal(relay.boundId,null,'Cancel on the debugging bar ends the take-over');
  assert.ok(relay.instances.has('fixture'),'the extension stays paired');
});

test('Relay names a popup\'s group-tab opener so Playwright keeps it with that chat',async t=>{
  const relay=await relayFixture(t),ext=await fakeExtension(relay);relay.bind('fixture');const c=await cdpClient(relay);
  ext.tabs.push({tabId:3,inGroup:true,openerTabId:2,title:'Popup',url:'https://work.invalid/popup'},{tabId:4,inGroup:true,openerTabId:null,title:'Other',url:'https://work.invalid/other'});
  const infos=(await c.send('Target.getTargets')).result.targetInfos;
  assert.equal(infos.find(i=>i.targetId==='fixture-frame-3').openerId,'fixture-frame-2');
  assert.equal('openerId' in infos.find(i=>i.targetId==='fixture-frame-4'),false);
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

test('Relay CDP endpoint answers only the engine holding this process secret',async t=>{
  const relay=await relayFixture(t);
  for(const headers of [{},{'x-ygpt-relay':'guess'},{'x-ygpt-relay':relay.cdpSecret+'x'}]){
    assert.equal((await fetch(relay.endpoint()+'/json/version',{headers})).status,401);
    assert.equal((await fetch(relay.endpoint()+'/json/list',{headers})).status,401);
    const ws=new WebSocket(relay.endpoint().replace('http:','ws:')+'/devtools/browser/ygpt',{headers});
    await assert.rejects(once(ws,'open'));
  }
  const version=await (await fetch(relay.endpoint()+'/json/version',{headers:relay.cdpHeaders()})).json();
  assert.match(version.webSocketDebuggerUrl,/\/devtools\/browser\/ygpt$/);
  const c=await cdpClient(relay);assert.equal((await c.send('Browser.getVersion')).result.product,'Chrome/YGPT-Extension');
  // The pairing page never shows the CDP secret; it is not stored in the state folder.
  assert.ok(!(await (await fetch(relay.endpoint()+'/')).text()).includes(relay.cdpSecret));
  assert.ok(!(await fs.readFile(path.join(relay.stateDir,'extension-pairing.json'),'utf8')).includes(relay.cdpSecret));
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

function stubPage(url,opener=null){const handlers={};return {url:()=>url,isClosed:()=>false,opener:async()=>opener,on(name,fn){handlers[name]=fn;},close(){handlers.close?.();}};}
test('Pages that appear after attach follow their opener; without one they are never guessed between chats',async()=>{
  let owner='chat-a';const engine=new YExtensionBrowser({stateDir:'/unused',currentOwner:()=>owner});
  const pages=[];let closed=0;
  engine.browser={contexts:()=>[{pages:()=>pages}],close:async()=>{closed++;}};engine.relay.unbind=()=>{};
  const settle=()=>new Promise(r=>setImmediate(r));
  owner='chat-a';await engine.attach({});owner='chat-b';await engine.attach({});
  const bPage=stubPage('https://b.invalid/');pages.push(bPage);engine.track(bPage,'chat-b');
  const popup=stubPage('https://b.invalid/popup',bPage);pages.push(popup);engine.onNewPage(popup);await settle();
  owner='chat-b';assert.ok(engine.status().tabs.some(t=>t.url==='https://b.invalid/popup'),'a popup stays with the chat whose tab opened it');
  owner='chat-a';assert.deepEqual(engine.status().tabs,[]);
  const orphan=stubPage('https://moved-into-group.invalid/');pages.push(orphan);engine.onNewPage(orphan);await settle();
  assert.equal([...engine.tabs.values()].some(t=>t.page===orphan),false,'two chats hold the connection: nobody gets it by guess');
  owner='chat-a';assert.equal((await engine.attach({})).adopted,1,'an explicit attach adopts it');
  owner='chat-a';const left=await engine.detach();assert.equal(left.sharedConnectionKept,true);
  const later=stubPage('https://later.invalid/');pages.push(later);engine.onNewPage(later);await settle();
  owner='chat-b';assert.ok(engine.status().tabs.some(t=>t.url==='https://later.invalid/'),'the only remaining holder gets it, not the chat that left');
  assert.equal(closed,0);
});
test('A chat that attached without tabs keeps the shared connection when another chat detaches',async()=>{
  let owner='chat-a';const engine=new YExtensionBrowser({stateDir:'/unused',currentOwner:()=>owner});
  let closed=0;engine.browser={contexts:()=>[{pages:()=>[]}],close:async()=>{closed++;}};engine.relay.unbind=()=>{};
  await engine.attach({});owner='chat-b';await engine.attach({});
  owner='chat-a';assert.equal((await engine.detach()).sharedConnectionKept,true);assert.equal(closed,0);
  owner='chat-b';assert.equal((await engine.detach()).sharedConnectionKept,undefined);assert.equal(closed,1);
});
test('Take-over detach is per chat: the shared connection stays for other chats and closes with the last',async()=>{
  let owner='chat-a';const engine=new YExtensionBrowser({stateDir:'/unused',currentOwner:()=>owner});
  const pages=[stubPage('https://a.invalid/'),stubPage('https://b.invalid/'),stubPage('https://left-over.invalid/')];let closed=0,unbound=0;
  engine.browser={contexts:()=>[{pages:()=>pages}],close:async()=>{closed++;}};engine.relay.unbind=()=>{unbound++;};
  const a=engine.track(pages[0],'chat-a'),b=engine.track(pages[1],'chat-b');
  owner='chat-a';const first=await engine.detach();
  assert.equal(first.sharedConnectionKept,true);assert.equal(first.released,1);assert.equal(closed+unbound,0,'chat B keeps the shared connection');
  owner='chat-b';assert.equal(engine.page(b),pages[1]);assert.equal(engine.has(a),false);
  // A later attach adopts group tabs no chat holds (released or left over).
  const again=await engine.attach({});assert.equal(again.adopted,2);assert.deepEqual(again.tabs.map(t=>t.url).sort(),['https://a.invalid/','https://b.invalid/','https://left-over.invalid/']);
  const last=await engine.detach();assert.equal(last.sharedConnectionKept,undefined);assert.equal(closed,1);assert.equal(unbound,1);assert.equal(engine.browser,null);
});

test('Closing a chat context releases its daily-browser tabs without closing them',async()=>{
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-facade-release-'));
  let owner='chat-a';const facade=new YBrowserFacade({stateDir,currentOwner:()=>owner,extension:{port:0}});
  try{
    const page=stubPage('https://work.invalid/');let pageClosed=false;page.close=()=>{pageClosed=true;};
    facade.existing.browser={contexts:()=>[{pages:()=>[page]}],close:async()=>{}};
    const id=facade.existing.track(page,'chat-a');
    const r=await facade.closeContext('chat-a');
    assert.equal(r.dailyBrowserTabsReleased,1);assert.equal(facade.existing.has(id),false);assert.equal(pageClosed,false);
    owner='chat-b';assert.equal((await facade.existing.attach({})).adopted,1,'the released tab can be adopted again');
  }finally{facade.existing.browser=null;await facade.close();await fs.rm(stateDir,{recursive:true,force:true});}
});

test('The first attach after the relay starts waits for a paired extension that reconnects late',async t=>{
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-late-extension-'));
  const engine=new YExtensionBrowser({stateDir,port:0});
  t.after(async()=>{await engine.close();await fs.rm(stateDir,{recursive:true,force:true});});
  await engine.ensureRelay();
  // The extension's alarm/backoff brings it back several seconds later than
  // the old 4.7 s attach window.
  setTimeout(()=>{void fakeExtension(engine.relay,'late');},5500);
  const started=Date.now(),attached=await engine.attach({});
  assert.equal(attached.attached,true);assert.equal(attached.identity.instance,'late');
  assert.ok(Date.now()-started>=5000);
  await engine.detach();
});
