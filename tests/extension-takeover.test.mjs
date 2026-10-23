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
import http from 'node:http';
import {WebSocket} from 'ws';
import {AsyncLocalStorage} from 'node:async_hooks';

const CHROME=process.env.YGPT_TEST_CHROMIUM??'/opt/meta-chromium/chrome';
const available=fs.existsSync(CHROME);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-ext-'));
async function freePort(){return new Promise(res=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});}
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
  constructor(playwright,endpoint,token,{id,email}){
    this.pw=playwright;this.id=id;this.email=email;this.tabs=new Map();this.seq=100;this.createCalls=[];
    this.ws=new WebSocket(endpoint.replace('http://','ws://')+'/ext?token='+encodeURIComponent(token));
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
  hello(){this.send({type:'hello',id:this.id,browser:'Chrome',version:'fake',profile:{email:this.email,id:'id-'+this.id},totalTabs:this.tabs.size});}
  async onMessage(msg){
    if(msg.type!=='req')return;
    const reply=(ok,payload)=>this.send({type:'res',reqId:msg.reqId,ok,...(ok?{result:payload}:{error:String(payload?.message??payload)})});
    try{
      const p=msg.params||{};
      if(msg.method==='tabs.list'){
        const tabs=[];
        for(const [tabId,t] of this.tabs)tabs.push({tabId,url:t.page.url(),title:await t.page.title().catch(()=>''),windowId:1,groupId:t.inGroup?7:-1,active:false,inGroup:t.inGroup});
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
  const port=await freePort();
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
    // Second profile pairs: a fresh attach must not guess between accounts.
    await engine.detach();
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
