// Take-over via the YGPT browser extension, end to end. A fake extension
// (WebSocket client speaking the real extension protocol) is backed by a real
// Chromium through Playwright, translating chrome.debugger calls to CDP
// sessions — so the whole chain is exercised: relay pairing, instance choice
// between two paired profiles, group-tab adoption, background group open,
// snapshot/act through the emulated CDP endpoint, and detach survival.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {WebSocket} from 'ws';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fixture,unpack,until} from './helpers.mjs';
import net from 'node:net';

const CHROME=process.env.YGPT_TEST_CHROMIUM??'/opt/meta-chromium/chrome';
const available=fs.existsSync(CHROME);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-ext-'));
const CDP_EVENTS=['Page.frameNavigated','Page.loadEventFired','Page.lifecycleEvent','Page.frameStartedLoading','Page.frameStoppedLoading','Page.domContentEventFired','Runtime.executionContextCreated','Runtime.executionContextDestroyed','Runtime.executionContextsCleared','Runtime.exceptionThrown','Network.requestWillBeSent','Network.responseReceived','Network.loadingFinished','Network.loadingFailed','Log.entryAdded','Fetch.requestPaused','DOM.documentUpdated','Page.javascriptDialogOpening','Page.fileChooserOpened','Page.windowOpen','Page.frameAttached','Page.frameDetached','Target.targetCreated','Target.targetInfoChanged','Target.targetDestroyed','Target.attachedToTarget','Target.detachedFromTarget'];
// Fixture pages are served by intercepting https://fixture.invalid/** —
// this host's Chromium build hard-blocks navigations to 127.0.0.1
// (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, even via CDP), so a local
// HTTP fixture server cannot be navigated to from the test-double browser.
const PAGES={
  '/work':'<title>work page</title><button id="b" onclick="document.getElementById(\'c\').textContent=Number(document.getElementById(\'c\').textContent)+1">Add one</button><span id="c">0</span>',
  '/previous':'<title>previous group work</title><p>earlier</p>',
  '/user':'<title>user tab</title><p>mine</p>',
};
async function serveFixtures(context){
  await context.route('https://fixture.invalid/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    route.fulfill({contentType:'text/html',body:PAGES[pathname]??PAGES['/user']});
  });
}

class FakeExtension {
  constructor(playwright,endpoint,token,{id,email,label}){
    this.pw=playwright;this.id=id;this.email=email;this.label=label;this.tabs=new Map();this.seq=100;this.createCalls=[];
    this.ws=new WebSocket(endpoint.replace('http://','ws://')+'/ext?token='+encodeURIComponent(token),{origin:'chrome-extension://'+'a'.repeat(32)});
    this.ws.on('message',raw=>{void this.onMessage(JSON.parse(raw.toString()));});
  }
  async init(browser){
    this.browser=browser;this.context=await browser.newContext();
    await serveFixtures(this.context);
    const userPage=await this.context.newPage();await userPage.goto('https://fixture.invalid/user');
    this.tabs.set(++this.seq,{page:userPage,inGroup:false,session:null});
    const prev=await this.context.newPage();await prev.goto('https://fixture.invalid/previous');
    this.tabs.set(++this.seq,{page:prev,inGroup:true,session:null});
  }
  send(obj){this.ws.send(JSON.stringify(obj));}
  // What Chrome does when the owner presses Cancel on the debugging bar or a
  // tab becomes undebuggable: the session ends and onDetach fires.
  // A tab a group tab opened (link with target=_blank): Chrome puts it in the group.
  async openFromGroupTab(openerTabId,url){const page=await this.context.newPage();await page.goto(url);const tabId=++this.seq;this.tabs.set(tabId,{page,inGroup:true,session:null,openerTabId});this.send({type:'event',kind:'tabsChanged',totalTabs:this.tabs.size});return tabId;}
  tabIdFor(url){for(const [tabId,t] of this.tabs)if(t.page.url()===url)return tabId;return null;}
  async chromeDetach(tabId,reason){const t=this.tabs.get(tabId);await t?.session?.detach().catch(()=>{});if(t)t.session=null;this.send({type:'event',kind:'detached',tabId,reason});}
  hello(){this.send({type:'hello',id:this.id,browser:'Chrome',version:'fake',profileLabel:this.label,profile:{email:this.email||null,id:this.email?'id-'+this.id:null},totalTabs:this.tabs.size});}
  async onMessage(msg){
    if(msg.type==='registered'){this.registration=msg;return;}
    if(msg.type!=='req')return;
    const reply=(ok,payload)=>this.send({type:'res',reqId:msg.reqId,ok,...(ok?{result:payload}:{error:String(payload?.message??payload)})});
    try{
      const p=msg.params||{};
      if(msg.method==='tabs.list'){
        const tabs=[];
        for(const [tabId,t] of this.tabs)tabs.push({tabId,url:t.page.url(),title:await t.page.title().catch(()=>''),windowId:1,groupId:t.inGroup?7:-1,active:false,inGroup:t.inGroup,openerTabId:t.openerTabId??null});
        return reply(true,{tabs,totalTabs:tabs.length});
      }
      if(msg.method==='tabs.create'){
        this.createCalls.push(p);
        const page=await this.context.newPage();await page.goto(p.url);
        const tabId=++this.seq;this.tabs.set(tabId,{page,inGroup:true,session:null});
        return reply(true,{tabId,url:page.url(),title:await page.title(),windowId:1});
      }
      if(msg.method==='tabs.close'){const t=this.tabs.get(p.tabId);if(t){await t.page.close().catch(()=>{});this.tabs.delete(p.tabId);}return reply(true,{});}
      if(msg.method==='debugger.attach'){
        const t=this.tabs.get(p.tabId);if(!t)throw new Error('no such tab');
        if(!t.session){t.session=await this.context.newCDPSession(t.page);for(const ev of CDP_EVENTS)t.session.on(ev,params=>this.send({type:'event',kind:'cdp',tabId:p.tabId,method:ev,params}));}
        return reply(true,{});
      }
      if(msg.method==='debugger.detach'){const t=this.tabs.get(p.tabId);if(t?.session){await t.session.detach().catch(()=>{});t.session=null;}return reply(true,{});}
      if(msg.method==='debugger.send'){
        if(p.method==='Page.getFrameTree'&&p.tabId===this.hangFrameTreeTab)return;
        const t=this.tabs.get(p.tabId);if(!t?.session)throw new Error('debugger not attached');
        return reply(true,await t.session.send(p.method,p.params||{}));
      }
      return reply(false,new Error('unknown '+msg.method));
    }catch(e){reply(false,e);}
  }
}

test('Extension takeover: pairing, choice, group discipline, detach',{skip:!available&&'no chromium on this host',timeout:180000},async()=>{
  const {YExtensionBrowser}=await import('../engine/src/browser-engine.mjs');
  const {chromium}=await import('playwright');
  const base='https://fixture.invalid';
  const port=0;
  const scope=new AsyncLocalStorage();
  const engine=new YExtensionBrowser({stateDir:tmp(),port,currentOwner:()=>scope.getStore()??'local'});
  const browserA=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const browserB=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  try{
    await engine.ensureRelay();
    const {token}=await engine.relay.pairing();
    // Pairing page shows the token.
    const pageHtml=await (await fetch(engine.relay.endpoint()+'/')).text();
    assert.ok(pageHtml.includes(token),'pairing page shows the token');
    // One paired profile: attach works and adopts the pre-existing group tab.
    const fakeA=new FakeExtension(null,engine.relay.endpoint(),token,{id:'inst-a',email:'owner@example.com'});
    await fakeA.init(browserA);fakeA.hello();
    const attached=await engine.attach({});
    assert.equal(attached.attached,true);
    assert.equal(attached.identity.profileEmail,'owner@example.com');
    assert.equal(attached.adopted,1,'the pre-existing YGPT group tab is adopted');
    // Group open: background tab in the group; the user tab is untouched.
    const opened=await engine.open(base+'/work');
    assert.equal(opened.background,true);assert.equal(opened.group.name,'YGPT');
    assert.ok(fakeA.createCalls.some(c=>c.groupName==='YGPT'),'extension was asked to create the tab in the YGPT group');
    assert.ok(opened.aria.includes('Add one'),'snapshot of the group tab reads its content');
    const acted=await engine.act(opened.tabId,'click',{selector:'#b'});
    assert.ok(acted.aria.includes('1'),'click through the extension debugger path updated the page');
    const listing=await engine.list();
    assert.equal(listing.ownerTabsNotTouched,1,'exactly the one user tab is counted as untouched');
    const [chatA,chatB]=await Promise.all([
      scope.run('chat-a',()=>engine.open(base+'/work')),
      scope.run('chat-b',()=>engine.open(base+'/previous')),
    ]);
    assert.notEqual(chatA.tabId,chatB.tabId,'parallel opens receive their exact created page');
    assert.equal(chatA.url,base+'/work');assert.equal(chatB.url,base+'/previous');
    assert.deepEqual(scope.run('chat-a',()=>engine.status()).tabs.map(t=>t.tabId),[chatA.tabId]);
    await assert.rejects(scope.run('chat-a',()=>engine.snapshot(chatB.tabId)),{code:'SESSION_FOREIGN'});
    // Detach is per chat: the shared connection stays while another chat works.
    const partial=await scope.run('chat-a',()=>engine.detach());
    assert.equal(partial.sharedConnectionKept,true,'chat A detaching keeps chat B connected');
    assert.match((await scope.run('chat-b',()=>engine.snapshot(chatB.tabId))).aria,/earlier/,'chat B still works after chat A detached');
    await scope.run('chat-b',()=>engine.detach());
    // Second profile pairs: a fresh attach must not guess between accounts.
    const full=await engine.detach();
    assert.equal(full.sharedConnectionKept,undefined,'the last chat to detach closes the shared connection');
    const fakeB=new FakeExtension(null,engine.relay.endpoint(),token,{id:'inst-b',email:'second@example.com'});
    await fakeB.init(browserB);fakeB.hello();
    const choice=await engine.attach({});
    assert.equal(choice.needsChoice,true);assert.equal(choice.candidates.length,2);
    const designated=await engine.attach({instance:'second@example.com'});
    assert.equal(designated.identity.profileEmail,'second@example.com');
    assert.match((await engine.snapshot(designated.tabs[0].tabId)).aria,/earlier/,'profile switch resolves fresh frame IDs even when tab IDs are reused');
    await engine.detach();
    // Detach survival: browsers and extension connections live on.
    assert.ok(browserA.isConnected()&&browserB.isConnected(),'both daily browsers still running after detach');
    assert.equal(engine.relay.instancesList().length,2,'extensions stay paired after detach');
  }finally{
    await engine.close().catch(()=>{});
    await browserA.close().catch(()=>{});await browserB.close().catch(()=>{});
  }
});

test('Extension takeover: a session Chrome ended is dropped and re-adopted; Cancel ends the take-over',{skip:!available&&'no chromium on this host',timeout:120000},async()=>{
  const {YExtensionBrowser}=await import('../engine/src/browser-engine.mjs');
  const {chromium}=await import('playwright');
  const engine=new YExtensionBrowser({stateDir:tmp(),port:0});
  const browser=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const until=async(check,what)=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,25));}assert.fail('timed out waiting for '+what);};
  try{
    await engine.ensureRelay();
    const {token}=await engine.relay.pairing();
    const fake=new FakeExtension(null,engine.relay.endpoint(),token,{id:'inst-d',email:'owner@example.com'});
    await fake.init(browser);fake.hello();
    await engine.attach({});
    const opened=await engine.open('https://fixture.invalid/work');
    const fakeTab=fake.seq;
    await fake.chromeDetach(fakeTab,'target_closed');
    await until(()=>!engine.has(opened.tabId),'Playwright to drop the detached page');
    await assert.rejects(engine.snapshot(opened.tabId),{code:'NO_TAB'});
    fake.send({type:'event',kind:'tabsChanged',totalTabs:fake.tabs.size});
    await until(async()=>(await engine.list()).tabs.some(t=>t.url.endsWith('/work')),'the group tab to be adopted again');
    const readopted=(await engine.list()).tabs.find(t=>t.url.endsWith('/work'));
    assert.match((await engine.snapshot(readopted.tabId)).aria,/Add one/,'the fresh session works');
    await fake.chromeDetach(fakeTab,'canceled_by_user');
    await until(()=>!engine.status().attached,'the take-over to end');
    assert.ok(browser.isConnected(),'the daily browser keeps running');
    assert.equal(engine.relay.instancesList().length,1,'the extension stays paired');
    assert.equal((await engine.attach({})).attached,true,'a later attach works again');
  }finally{
    await engine.close().catch(()=>{});await browser.close().catch(()=>{});
  }
});

test('Extension takeover: a popup opened by one chat\'s group tab stays with that chat',{skip:!available&&'no chromium on this host',timeout:120000},async()=>{
  const {YExtensionBrowser}=await import('../engine/src/browser-engine.mjs');
  const {chromium}=await import('playwright');
  const scope=new AsyncLocalStorage();
  const engine=new YExtensionBrowser({stateDir:tmp(),port:0,currentOwner:()=>scope.getStore()??'local'});
  const browser=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const until=async(check,what)=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,25));}assert.fail('timed out waiting for '+what);};
  try{
    await engine.ensureRelay();
    const {token}=await engine.relay.pairing();
    const fake=new FakeExtension(null,engine.relay.endpoint(),token,{id:'inst-p',email:'owner@example.com'});
    await fake.init(browser);fake.hello();
    await scope.run('chat-a',()=>engine.attach({}));
    await scope.run('chat-b',()=>engine.attach({}));
    await scope.run('chat-a',()=>engine.open('https://fixture.invalid/a-tab'));
    await scope.run('chat-b',()=>engine.open('https://fixture.invalid/b-tab'));
    await fake.openFromGroupTab(fake.tabIdFor('https://fixture.invalid/b-tab'),'https://fixture.invalid/b-popup');
    await until(()=>scope.run('chat-b',()=>engine.status()).tabs.some(t=>t.url.endsWith('/b-popup')),'chat B to own its popup');
    assert.ok(!scope.run('chat-a',()=>engine.status()).tabs.some(t=>t.url.endsWith('/b-popup')),'chat A never sees chat B\'s popup');
  }finally{
    await engine.close().catch(()=>{});await browser.close().catch(()=>{});
  }
});


test('Extension takeover: unsigned Chrome profiles attach by stable identity and never guess between profiles',{skip:!available&&'no chromium on this host',timeout:120000},async()=>{
  const {YExtensionBrowser}=await import('../engine/src/browser-engine.mjs');
  const {chromium}=await import('playwright');
  const engine=new YExtensionBrowser({stateDir:tmp(),port:0});
  const a=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']}),b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  try{
    await engine.ensureRelay();const {token}=await engine.relay.pairing();
    // Run the pairing page with its real HTTP CSP. Proxy a fixture origin
    // because this host Chromium blocks direct loopback navigations.
    const pairing=await a.newPage();
    await pairing.route('https://pairing.invalid/**',async route=>{
      const response=await fetch(engine.relay.endpoint()+new URL(route.request().url()).pathname);
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    });
    await pairing.goto('https://pairing.invalid/');assert.match(await pairing.locator('#instances').innerText(),/No extension/);
    const first=new FakeExtension(null,engine.relay.endpoint(),token,{id:'unsigned-a',email:''});await first.init(a);first.hello();
    const attached=await engine.attach({});assert.equal(attached.identity.profileEmail,null);assert.equal(attached.identity.profileLabel,'Chrome profile unsigned-a');
    assert.equal(first.registration.id,'unsigned-a');
    await pairing.waitForFunction(()=>document.getElementById('instances').textContent.includes('Chrome profile unsigned-a'));
    assert.match((await engine.snapshot(attached.tabs[0].tabId)).aria,/earlier/);
    const second=new FakeExtension(null,engine.relay.endpoint(),token,{id:'unsigned-b',email:''});await second.init(b);second.hello();
    await new Promise(r=>setTimeout(r,50));
    await assert.rejects(engine.attach({instance:'unsigned-b'}),{code:'BROWSER_ALREADY_ATTACHED'});
    await engine.detach();
    const choice=await engine.attach({});assert.equal(choice.needsChoice,true);
    assert.deepEqual(choice.candidates.map(c=>c.profileLabel),['Chrome profile unsigned-a','Chrome profile unsigned-b']);
    await pairing.waitForFunction(()=>document.getElementById('instances').textContent.includes('Chrome profile unsigned-b'));
    const page=await pairing.locator('#instances').innerText();for(const c of choice.candidates)assert.ok(page.includes(c.profileLabel));
    const ambiguous=await engine.attach({instance:'Chrome'});assert.equal(ambiguous.needsChoice,true);assert.equal(engine.status().attached,false);
    const designated=await engine.attach({instance:'unsigned-b'});assert.equal(designated.identity.instance,'unsigned-b');
    assert.match((await engine.snapshot(designated.tabs[0].tabId)).aria,/earlier/);
    await engine.open('https://fixture.invalid/work');assert.equal(first.createCalls.length,0);assert.equal(second.createCalls.length,1);
    assert.equal((await engine.list()).ownerTabsNotTouched,1);
  }finally{await engine.close().catch(()=>{});await a.close();await b.close();}
});

test('Two chats concurrently control two profiles with overlapping Chrome tab ids without crossing accounts',{skip:!available&&'no chromium on this host',timeout:120000},async()=>{
  const {YBrowserFacade}=await import('../engine/src/browser-engine.mjs');
  const {chromium}=await import('playwright');const scope=new AsyncLocalStorage();
  const facade=new YBrowserFacade({stateDir:tmp(),currentOwner:()=>scope.getStore()??'local',extension:{port:0}});
  const browsers=await Promise.all([chromium.launch({executablePath:CHROME}),chromium.launch({executablePath:CHROME})]);
  try{
    await facade.existing.ensureRelay();const relay=facade.existing.relay;
    const fakes=await Promise.all(browsers.map(async(browser,i)=>{const fake=new FakeExtension(null,relay.endpoint(),relay.token,{id:'profile-'+i,email:''});await fake.init(browser);fake.hello();return fake;}));
    for(let i=0;i<100&&relay.instancesList().length<2;i++)await new Promise(r=>setTimeout(r,20));
    assert.equal((await scope.run('unselected',()=>facade.attach())).needsChoice,true);
    await Promise.all([scope.run('chat-a',()=>facade.attach({instance:'profile-0'})),scope.run('chat-b',()=>facade.attach({instance:'profile-1'}))]);
    const [a,b]=await Promise.all([scope.run('chat-a',()=>facade.open('https://fixture.invalid/work',{target:'existing'})),scope.run('chat-b',()=>facade.open('https://fixture.invalid/work',{target:'existing'}))]);
    await scope.run('chat-a',()=>facade.act(a.tabId,'click',{role:'button',name:'Add one'}));
    assert.match((await scope.run('chat-a',()=>facade.snapshot(a.tabId))).aria,/1/);
    assert.match((await scope.run('chat-b',()=>facade.snapshot(b.tabId))).aria,/0/);
    await assert.rejects(scope.run('chat-a',()=>facade.snapshot(b.tabId)),{code:'SESSION_FOREIGN'});
    await scope.run('chat-a',()=>facade.detach());assert.equal(scope.run('chat-b',()=>facade.attachStatus()).identity.instance,'profile-1');
    assert.equal(fakes[0].createCalls.length,1);assert.equal(fakes[1].createCalls.length,1);
    assert.ok(browsers.every(b=>b.isConnected()),'personal browsers remain running');
  }finally{await facade.close();await Promise.all(browsers.map(b=>b.close()));}
});

test('Broker attach returns a private chat context that preserves profile selection on subsequent tool calls',{skip:!available&&'no chromium on this host',timeout:120000},async()=>{
  const {chromium}=await import('playwright');
  const f=fixture(),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  f.config.browser.extension.port=port;fs.writeFileSync(f.file,JSON.stringify(f.config));
  const c=await f.client().start(),browsers=[],fakes=[];
  const call=async(name,args={})=>{const r=await c.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
  try{
    const pairing=await until(async()=>{try{return JSON.parse(fs.readFileSync(path.join(f.config.stateDir,'extension-pairing.json'),'utf8'));}catch{return null;}});
    for(const [i,label] of ['Work profile','Personal profile'].entries()){
      const browser=await chromium.launch({executablePath:CHROME});browsers.push(browser);
      const fake=new FakeExtension(null,'http://127.0.0.1:'+port,pairing.token,{id:'broker-profile-'+i,email:'',label});fakes.push(fake);
      await fake.init(browser);fake.hello();await until(()=>fake.registration);
    }
    const choice=await call('y_browser_attach');assert.equal(choice.result.needsChoice,true);
    assert.ok(choice.ygptContext?.contextToken,'even the profile picker must return this chat context');
    const a=await call('y_browser_attach',{instance:'Work profile',contextToken:choice.ygptContext.contextToken});
    assert.equal(a.result.identity.profileLabel,'Work profile');
    const b=await call('y_browser_attach',{instance:'Personal profile'});
    assert.ok(b.ygptContext?.contextToken,'a different chat creates its own context at attach');
    const ac={contextToken:choice.ygptContext.contextToken},bc={contextToken:b.ygptContext.contextToken};
    assert.notEqual(ac.contextToken,bc.contextToken);
    const [openedA,openedB]=await Promise.all([
      call('y_browser_open',{url:'https://fixture.invalid/work',target:'existing',...ac}),
      call('y_browser_open',{url:'https://fixture.invalid/work',target:'existing',...bc})
    ]);
    await call('y_browser_action',{tabId:openedA.result.tabId,action:'click',target:{role:'button',name:'Add one'},...ac});
    assert.match((await call('y_browser_snapshot',{tabId:openedA.result.tabId,...ac})).result.aria,/1/);
    assert.match((await call('y_browser_snapshot',{tabId:openedB.result.tabId,...bc})).result.aria,/0/);
    const foreign=await c.call('y_browser_snapshot',{tabId:openedB.result.tabId,...ac});assert.ok(foreign.isError);assert.equal(unpack(foreign).error.code,'SESSION_FOREIGN');
    await call('y_browser_attach',{instance:'Personal profile',...ac});
    const switched=await call('y_browser_open',{url:'https://fixture.invalid/work',target:'existing',...ac});
    const mine=(await call('y_browser_tabs',ac)).result.tabs;
    assert.ok(mine.some(t=>t.tabId===openedA.result.tabId&&t.profileLabel==='Work profile'));
    assert.ok(mine.some(t=>t.tabId===switched.result.tabId&&t.profileLabel==='Personal profile'));
    assert.match((await call('y_browser_snapshot',{tabId:openedA.result.tabId,...ac})).result.aria,/1/,'switching preserves the first profile tab');
    const expired=await c.call('y_browser_detach',{contextToken:'invalid-context'});assert.equal(unpack(expired).code,'CONTEXT_EXPIRED');
    await call('y_browser_detach',ac);
    assert.equal((await call('y_browser_tabs',bc)).result.existingAttached,true);
    assert.equal(fakes[0].createCalls.length,1);assert.equal(fakes[1].createCalls.length,2);
    assert.ok(browsers.every(browser=>browser.isConnected()),'detaching leaves both browser processes running');
  }finally{await c.close();await Promise.all(browsers.map(browser=>browser.close()));}
});

test('An unresponsive old group tab cannot block profile attach or new group tabs',{skip:!available&&'no chromium on this host',timeout:60000},async()=>{
  const {YExtensionBrowser}=await import('../engine/src/browser-engine.mjs');
  const {chromium}=await import('playwright');
  const engine=new YExtensionBrowser({stateDir:tmp(),port:0});
  const browser=await chromium.launch({executablePath:CHROME});
  try{
    await engine.ensureRelay();const fake=new FakeExtension(null,engine.relay.endpoint(),engine.relay.token,{id:'stalled-profile',email:'',label:'Work profile'});
    await fake.init(browser);fake.hello();await until(()=>fake.registration);
    fake.hangFrameTreeTab=fake.tabIdFor('https://fixture.invalid/previous');
    await fake.openFromGroupTab(fake.hangFrameTreeTab,'https://fixture.invalid/work');
    const started=Date.now(),attached=await engine.attach({instance:'stalled-profile'});
    assert.equal(attached.attached,true);assert.equal(attached.adopted,1);
    assert.ok(Date.now()-started<9000,'one frozen renderer cannot consume the 10-second connection deadline');
    const opened=await engine.open('https://fixture.invalid/work');
    assert.match((await engine.act(opened.tabId,'click',{role:'button',name:'Add one'})).aria,/1/);
    assert.equal(fake.tabs.has(fake.hangFrameTreeTab),true,'the skipped group tab is preserved');
    assert.equal((await engine.list()).ownerTabsNotTouched,1);
  }finally{await engine.close();await browser.close();}
});
