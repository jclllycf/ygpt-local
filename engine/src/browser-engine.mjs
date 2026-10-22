import {BoundedDownloads} from './bounded-download.mjs';
import {chromium} from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {EngineError,sha256} from './file-engine.mjs';
// YGPT's own Playwright Edge: launched lazily on the first browser task, never
// attached to a personal or Agent browser, profile or debugging port. Each chat
// context gets its own BrowserContext (cookies, storage, tabs); a chat sees and
// controls only its own tabs. Idle contexts close; the browser closes with the last.
export class YBrowserEngine {
  static IDLE_MS=10*60000;
  constructor({stateDir,allowedHosts=[],blockedHosts=[],channel='chrome',headless=true,currentOwner=()=>'local',launch,idleMs=YBrowserEngine.IDLE_MS}={}){
    this.stateDir=stateDir;
    // Owner blacklist (rc.13): the browser may visit any http/https site by
    // default. allowedHosts is an owner opt-in allowlist (empty = allow all);
    // the pre-rc.13 shipped default (localhost only) is migrated to allow-all
    // so upgraded installs pick up the new model without a config rewrite.
    const legacyLocalOnly=Array.isArray(allowedHosts)&&allowedHosts.length>0&&allowedHosts.every(h=>['127.0.0.1','localhost','[::1]'].includes(h));
    this.allowedHosts=new Set(legacyLocalOnly?[]:allowedHosts);
    this.blockedHosts=new Set((blockedHosts??[]).map(h=>String(h).toLowerCase()));
    this.channel=channel||'chrome';this.headless=headless;this.owner=()=>currentOwner()??'local';
    this.launcher=typeof launch==='function'?launch:options=>chromium.launch(options);this.idleMs=idleMs;
    this.contexts=new Map();this.tabs=new Map();this.closedTabs=new Map();this.downloads=new Map();
  }
  validateUrl(raw){const u=new URL(raw);if(!['http:','https:'].includes(u.protocol))throw new EngineError('URL_BLOCKED','Only http/https URLs can be opened');if(u.username||u.password)throw new EngineError('URL_BLOCKED','URLs with embedded credentials are on the blacklist');if(this.blockedHosts.has(u.hostname.toLowerCase()))throw new EngineError('URL_BLOCKED','This host is on the owner blocklist');if(this.allowedHosts.size&&!this.allowedHosts.has(u.hostname))throw new EngineError('URL_NOT_ENROLLED','Browser destination is outside the owner-configured allowlist');return u.href;}
  async ensureBrowser(){
    if(this.browser)return this.browser;
    this.starting??=this.launcher({channel:this.channel,headless:this.headless}).then(browser=>{
      this.browser=browser;browser.on?.('disconnected',()=>{if(this.browser===browser)this.forget();});
      this.sweeper=setInterval(()=>void this.sweep(),Math.min(60000,this.idleMs)).unref?.()??null;return browser;
    }).finally(()=>{this.starting=null;});
    return this.starting;
  }
  // One BrowserContext per chat context; concurrent first calls share its creation.
  async contextFor(owner){
    const known=this.contexts.get(owner);if(known){known.lastUsed=Date.now();return known.ready;}
    const entry={lastUsed:Date.now()};this.contexts.set(owner,entry);
    entry.ready=(async()=>{
      const browser=await this.ensureBrowser();
      const context=await browser.newContext({acceptDownloads:false,viewport:{width:1100,height:760},serviceWorkers:'block'});
      context.setDefaultTimeout(10000);
      await context.route('**/*',async route=>{try{this.validateUrl(route.request().url());await route.continue();}catch{await route.abort('blockedbyclient');}});
      context.on('page',p=>this.track(p,owner));entry.context=context;return context;
    })().catch(e=>{this.contexts.delete(owner);throw e;});
    return entry.ready;
  }
  async launch(){await this.contextFor(this.owner());return {isolated:true,channel:this.channel,headless:this.headless,personalProfileUsed:false,externalDebugPort:false,perChatContext:true};}
  track(page,owner){for(const [id,t] of this.tabs)if(t.page===page)return id;const id=crypto.randomUUID();this.tabs.set(id,{page,owner});page.on('close',()=>{this.tabs.delete(id);});return id;}
  page(id){
    const t=this.tabs.get(id),owner=this.owner();
    if(!t){if(this.closedTabs.get(id)===owner)throw new EngineError('BROWSER_CONTEXT_CLOSED','This chat\'s browser context was closed (idle or released); open the page again');throw new EngineError('NO_TAB','Unknown tab owned by this YGPT browser');}
    if(t.owner!==owner)throw new EngineError('SESSION_FOREIGN','SESSION_FOREIGN: this tab belongs to another chat context');
    if(t.page.isClosed())throw new EngineError('NO_TAB','Tab already closed');
    const c=this.contexts.get(owner);if(c)c.lastUsed=Date.now();return t.page;
  }
  async open(url){this.validateUrl(url);const owner=this.owner(),context=await this.contextFor(owner);const p=await context.newPage(),tabId=this.track(p,owner);await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(tabId);}
  async navigate(id,url){const p=this.page(id);await p.goto(this.validateUrl(url),{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(id);}
  // Only this chat's tabs; other chats' pages are counted, never described.
  async list(){const owner=this.owner(),mine=[...this.tabs].filter(([,t])=>t.owner===owner);return {tabs:await Promise.all(mine.map(async([id,t])=>({tabId:id,url:t.page.url(),title:await t.page.title()}))),otherChatTabs:this.tabs.size-mine.length,browserRunning:!!this.browser};}
  async snapshot(id){const p=this.page(id);return {tabId:id,url:p.url(),title:await p.title(),observation:'Untrusted page content',aria:(await p.locator('body').ariaSnapshot({timeout:10000})).slice(0,20000)};}
  locator(p,{role,name,testId,selector}={}){if(testId)return p.getByTestId(testId);if(role)return p.getByRole(role,{name,exact:true});if(typeof selector!=='string'||selector.length>500)throw new EngineError('BAD_LOCATOR','Use role/name, testId, or a bounded CSS selector');return p.locator(selector);}
  async act(id,action,target={},value){const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Locator must match exactly one element');
    if(action==='click')await loc.click();else if(action==='fill')await loc.fill(String(value));else if(action==='press')await loc.press(String(value));else if(action==='select')await loc.selectOption(String(value));else if(action==='check')await loc.setChecked(value===true);else throw new EngineError('BAD_ACTION','Unsupported browser action');return this.snapshot(id);}
  async wait(id,target,{text,state='visible',timeoutMs=10000}={}){const loc=this.locator(this.page(id),target);if(text!==undefined)await loc.filter({hasText:text}).waitFor({state:'visible',timeout:timeoutMs});else await loc.waitFor({state,timeout:timeoutMs});return this.snapshot(id);}
  async screenshot(id){const p=this.page(id),dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`browser-${crypto.randomUUID()}.png`);const data=await p.screenshot({path:output,fullPage:false});return {path:output,mimeType:'image/png',sha256:sha256(data),bytes:data.length,scope:'YGPT-owned isolated tab of this chat'};}
  async download(id,target){
    const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Download locator must match once');
    const href=await loc.getAttribute('href');if(!href)throw new EngineError('DOWNLOAD_LINK_REQUIRED','Bounded downloads require a direct HTTP(S) link; JavaScript/blob downloads are disabled');
    this.bounded??=new BoundedDownloads({directory:path.join(this.stateDir,'downloads'),validateUrl:u=>this.validateUrl(u)});
    const result=await this.bounded.save(new URL(href,p.url()).href);this.downloads.set(result.downloadId,{...result,owner:this.owner()});return result;
  }
  async closeTab(id){await this.page(id).close();return {closed:id};}
  // Close one chat's context. Its tab IDs then report BROWSER_CONTEXT_CLOSED
  // to that chat only; other chats' contexts are untouched.
  async closeContext(owner=this.owner()){
    const entry=this.contexts.get(owner);if(!entry)return {closed:false};this.contexts.delete(owner);
    for(const [id,t] of this.tabs)if(t.owner===owner){this.tabs.delete(id);this.closedTabs.set(id,owner);}
    if(this.closedTabs.size>2048)this.closedTabs.delete(this.closedTabs.keys().next().value);
    try{await (await entry.ready).close();}catch{}
    if(!this.contexts.size)await this.shutdownBrowser();
    return {closed:true};
  }
  async sweep(now=Date.now()){for(const [owner,entry] of [...this.contexts])if(now-entry.lastUsed>=this.idleMs)await this.closeContext(owner);}
  owned(owner=this.owner()){return [...this.tabs].filter(([,t])=>t.owner===owner).map(([tabId,t])=>({tabId,url:t.page.url()}));}
  forget(){for(const [id,t] of this.tabs)this.closedTabs.set(id,t.owner);this.tabs.clear();this.contexts.clear();this.browser=null;if(this.sweeper)clearInterval(this.sweeper);this.sweeper=null;}
  async shutdownBrowser(){const b=this.browser;this.forget();await b?.close().catch(()=>{});}
  async close(){await this.shutdownBrowser();this.closedTabs.clear();}
}

// The owner's OWN existing browser (Chrome or Edge), taken over through its
// Chrome DevTools Protocol endpoint. This is a separate mode from the
// isolated browser above: the human enables remote debugging on their
// browser (that opt-in is the consent), YGPT attaches, works in that
// browser's real profile and disconnects without closing it. Which mode a
// call uses is the caller's choice; the chat asks the owner for a preference
// and defaults to the isolated browser when there is no answer.
// Discover running Chrome/Edge instances that expose a DevTools endpoint:
// configured/likely ports are probed, and the DevToolsActivePort files each
// browser writes into its user-data root are read (with the profile account
// labels from its Local State) so several instances or accounts can be told
// apart and the owner can designate the right one. All file access is
// best-effort: on hosts without those files, port probing still works.
async function probeEndpoint(port){
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),1200);
  try{
    const v=await (await fetch('http://127.0.0.1:'+port+'/json/version',{signal:ctrl.signal})).json();
    let tabs=0;try{const l=await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:ctrl.signal})).json();tabs=l.filter(t=>t.type==='page').length;}catch{}
    return {port,endpoint:'http://127.0.0.1:'+port,browser:v.Browser??'Chromium',tabs};
  }catch{return null;}finally{clearTimeout(timer);}
}
function userDataRoots(){
  const roots=[],la=process.env.LOCALAPPDATA;if(!la)return roots;
  const w=path.win32;
  roots.push({kind:'chrome',root:w.join(la,'Google','Chrome','User Data')});
  roots.push({kind:'edge',root:w.join(la,'Microsoft','Edge','User Data')});
  return roots;
}
async function readActivePort(root){
  try{const raw=await fs.readFile(path.join(root,'DevToolsActivePort'),'utf8');const port=parseInt(raw.split(/\r?\n/)[0],10);return Number.isInteger(port)?port:null;}catch{return null;}
}
async function readProfiles(root){
  try{const state=JSON.parse(await fs.readFile(path.join(root,'Local State'),'utf8'));const cache=state?.profile?.info_cache??{};
    return Object.entries(cache).map(([dir,info])=>({dir,label:info.name??dir,account:info.user_name??null}));}catch{return [];}
}
export async function discoverExistingBrowsers({ports=[]}={}){
  const byPort=new Map();
  const addProbe=async(port,extra={})=>{if(!port||byPort.has(port))return;const hit=await probeEndpoint(port);if(hit)byPort.set(port,{...hit,...extra});};
  for(const p of ports)await addProbe(p);
  for(const {kind,root} of userDataRoots()){
    const port=await readActivePort(root);
    if(port&&!byPort.has(port)){const hit=await probeEndpoint(port);if(hit)byPort.set(port,{...hit,kind,userDataRoot:root,profiles:await readProfiles(root)});}
    else if(port&&byPort.has(port)&&!byPort.get(port).profiles){const c=byPort.get(port);c.kind=kind;c.userDataRoot=root;c.profiles=await readProfiles(root);}
  }
  return [...byPort.values()];
}

// The owner's OWN existing browser (Chrome or Edge), taken over through its
// Chrome DevTools Protocol endpoint. Separate mode from the isolated
// browser: the human enables remote debugging on their browser (that opt-in
// is the consent), YGPT attaches, works and disconnects without closing it.
//
// Work discipline (learned from agent-style work): YGPT operates ONLY in
// its own tab group — tabs it creates in the background (never activated,
// never stealing focus), stamped with a window.name marker so the group can
// be found again and adopted on a later attach. The owner's own tabs are
// counted, never read, moved or closed.
export class YExistingBrowser {
  constructor({stateDir,currentOwner=()=>'local',port=9222,endpoints=[],groupName='YGPT',validateUrl}={}){
    this.stateDir=stateDir;this.owner=()=>currentOwner()??'local';this.defaultPort=port;
    this.endpoints=Array.isArray(endpoints)?endpoints:[];
    this.groupName=groupName||'YGPT';
    this.validateUrl=typeof validateUrl==='function'?validateUrl:u=>new URL(u).href;
    this.browser=null;this.tabs=new Map();this.endpoint=null;this.identity=null;this.groupId=null;
  }
  candidatePorts(){const set=new Set([this.defaultPort]);for(const e of this.endpoints)if(e?.port)set.add(e.port);return [...set];}
  async attach({port,profile}={}){
    if(this.browser)return this.status();
    const candidates=await discoverExistingBrowsers({ports:[...this.candidatePorts(),...(port?[port]:[])]});
    let pool=candidates;
    if(port)pool=pool.filter(c=>c.port===port);
    if(profile){const needle=String(profile).toLowerCase();pool=pool.filter(c=>(c.profiles??[]).some(p=>p.dir.toLowerCase()===needle||p.label.toLowerCase().includes(needle)||(p.account??'').toLowerCase().includes(needle))||String(c.kind??'').includes(needle));}
    if(pool.length===0)throw new EngineError('BROWSER_ATTACH_FAILED','No existing browser with remote debugging was found. Since Chrome 136 the debugging port is ignored for the default profile folder, so launch a dedicated debugging instance, for example: chrome.exe --remote-debugging-port='+(port??this.defaultPort)+' --user-data-dir="%LOCALAPPDATA%\\YGPTChromeDebug" (Edge works the same way), or open the browser\'s debug endpoint yourself and tell me its port. Taking over the daily profile in place is only possible through the browser extension route, which is not built in yet. Nothing was changed.');
    if(pool.length>1)return {needsChoice:true,note:'Several browsers/profiles are available. Ask the owner which one to use, then attach again with its port — do not guess: accounts must not be mixed.',candidates:pool.map(c=>({port:c.port,browser:c.browser,kind:c.kind??null,profiles:c.profiles??[],tabs:c.tabs}))};
    const chosen=pool[0];
    let browser;
    try{browser=await chromium.connectOverCDP(chosen.endpoint,{timeout:8000});}
    catch{throw new EngineError('BROWSER_ATTACH_FAILED','The browser at '+chosen.endpoint+' stopped answering before the connection completed. Nothing was changed.');}
    this.browser=browser;this.endpoint=chosen.endpoint;
    this.identity={browser:chosen.browser,kind:chosen.kind??null,port:chosen.port,profiles:chosen.profiles??[]};
    this.groupId='ygpt-'+crypto.randomUUID().slice(0,8);
    browser.on('disconnected',()=>{if(this.browser===browser){this.browser=null;this.tabs.clear();}});
    let adopted=0;
    for(const ctx of browser.contexts()){ctx.on('page',pg=>{void this.adoptIfMarked(pg);});for(const pg of ctx.pages()){if(await this.adoptIfMarked(pg))adopted++;}}
    return {...this.status(),adopted};
  }
  async pageMarker(page){
    try{return await page.evaluate(()=>window.name);}catch{return '';}
  }
  async adoptIfMarked(page){
    const marker=await this.pageMarker(page);
    if(typeof marker==='string'&&marker.startsWith('ygpt:')){this.track(page,marker.slice(5));return true;}
    return false;
  }
  status(){return {attached:!!this.browser,endpoint:this.endpoint,identity:this.identity,group:this.browser?{id:this.groupId,name:this.groupName,tabs:this.tabs.size}:null,tabs:[...this.tabs].map(([tabId,t])=>({tabId,url:t.page.url(),groupId:t.groupId}))};}
  track(page,groupId){
    for(const [,t] of this.tabs)if(t.page===page)return;
    const id=crypto.randomUUID();this.tabs.set(id,{page,owner:this.owner(),groupId:groupId??this.groupId});
    page.on('close',()=>{this.tabs.delete(id);});
  }
  has(id){return this.tabs.has(id);}
  page(id){
    const t=this.tabs.get(id),owner=this.owner();
    if(!t)throw new EngineError('NO_TAB','Unknown tab in the YGPT group of the existing browser; attach and list its tabs again');
    if(t.owner!==owner)throw new EngineError('SESSION_FOREIGN','SESSION_FOREIGN: this existing-browser tab was attached by another chat context');
    if(t.page.isClosed())throw new EngineError('NO_TAB','Tab already closed');
    return t.page;
  }
  // Create a tab for this chat's group WITHOUT disturbing the owner: the CDP
  // Target.createTarget background flag keeps the owner's current tab active
  // and their window unfocused. Falls back to a normal new page only if the
  // browser refuses background creation.
  async createGroupTab(url){
    const session=await this.browser.newBrowserCDPSession();
    let targetId=null;
    try{({targetId}=await session.send('Target.createTarget',{url,background:true}));}catch{}
    if(targetId){
      for(let i=0;i<24;i++){
        for(const ctx of this.browser.contexts())for(const pg of ctx.pages()){
          try{const ps=await ctx.newCDPSession(pg);const info=await ps.send('Target.getTargetInfo');if(info?.targetInfo?.targetId===targetId){return pg;}}catch{}
        }
        await new Promise(r=>setTimeout(r,250));
      }
    }
    const ctx=this.browser.contexts()[0];if(!ctx)throw new EngineError('BROWSER_ATTACH_FAILED','The existing browser exposed no usable context');
    return ctx.newPage();
  }
  async stampGroup(page){
    const marker='ygpt:'+this.groupId;
    try{await page.evaluate(n=>{try{window.name=n;}catch{}},marker);}catch{}
    try{const ps=await page.context().newCDPSession(page);await ps.send('Page.addScriptToEvaluateOnNewDocument',{source:'try{window.name='+JSON.stringify(marker)+'}catch(e){}'});}catch{}
  }
  async open(url){
    this.validateUrl(url);
    if(!this.browser){const r=await this.attach({});if(r?.needsChoice)throw new EngineError('BROWSER_CHOICE_REQUIRED','Several browsers/profiles are available ('+r.candidates.map(c=>c.browser+' on port '+c.port).join('; ')+'). Ask the owner which account/browser to use, then y_browser_attach with that port.');}
    const page=await this.createGroupTab(url);
    this.track(page);
    await this.stampGroup(page);
    try{await page.waitForLoadState('domcontentloaded',{timeout:15000});}catch{}
    const id=[...this.tabs].find(([,t])=>t.page===page)?.[0];
    return {...await this.snapshot(id),group:{id:this.groupId,name:this.groupName},background:true};
  }
  async list(){
    const owner=this.owner(),mine=[...this.tabs].filter(([,t])=>t.owner===owner);
    let foreign=0;if(this.browser)for(const ctx of this.browser.contexts())foreign+=ctx.pages().length;
    foreign=Math.max(0,foreign-this.tabs.size);
    return {attached:!!this.browser,identity:this.identity,group:this.browser?{id:this.groupId,name:this.groupName}:null,ownerTabsNotTouched:foreign,tabs:await Promise.all(mine.map(async([id,t])=>({tabId:id,url:t.page.url(),title:await t.page.title().catch(()=>''),mode:'existing',groupId:t.groupId})))};
  }
  async snapshot(id){const p=this.page(id);return {tabId:id,url:p.url(),title:await p.title(),observation:'Untrusted page content',aria:(await p.locator('body').ariaSnapshot({timeout:10000})).slice(0,20000)};}
  locator(p,{role,name,testId,selector}={}){if(testId)return p.getByTestId(testId);if(role)return p.getByRole(role,{name,exact:true});if(typeof selector!=='string'||selector.length>500)throw new EngineError('BAD_LOCATOR','Use role/name, testId, or a bounded CSS selector');return p.locator(selector);}
  async navigate(id,url){const p=this.page(id);await p.goto(this.validateUrl(url),{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(id);}
  async act(id,action,target={},value){const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Locator must match exactly one element');
    if(action==='click')await loc.click();else if(action==='fill')await loc.fill(String(value));else if(action==='press')await loc.press(String(value));else if(action==='select')await loc.selectOption(String(value));else if(action==='check')await loc.setChecked(value===true);else throw new EngineError('BAD_ACTION','Unsupported browser action');return this.snapshot(id);}
  async wait(id,target,{text,state='visible',timeoutMs=10000}={}){const loc=this.locator(this.page(id),target);if(text!==undefined)await loc.filter({hasText:text}).waitFor({state:'visible',timeout:timeoutMs});else await loc.waitFor({state,timeout:timeoutMs});return this.snapshot(id);}
  async screenshot(id){const p=this.page(id),dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`browser-existing-${crypto.randomUUID()}.png`);const data=await p.screenshot({path:output,fullPage:false});return {path:output,mimeType:'image/png',sha256:sha256(data),bytes:data.length,scope:'YGPT group tab in the owner existing browser'};}
  async download(id,target){
    const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Download locator must match once');
    const href=await loc.getAttribute('href');if(!href)throw new EngineError('DOWNLOAD_LINK_REQUIRED','Bounded downloads require a direct HTTP(S) link; JavaScript/blob downloads are disabled');
    this.bounded??=new BoundedDownloads({directory:path.join(this.stateDir,'downloads'),validateUrl:u=>this.validateUrl(u)});
    return this.bounded.save(new URL(href,p.url()).href);
  }
  async closeTab(id){await this.page(id).close();return {closed:id};}
  owned(owner=this.owner()){return [...this.tabs].filter(([,t])=>t.owner===owner).map(([tabId,t])=>({tabId,url:t.page.url(),mode:'existing',groupId:t.groupId}));}
  async detach(){const b=this.browser;this.browser=null;this.tabs.clear();await b?.close().catch(()=>{});return {detached:true,note:'Disconnected. The browser was left running and the YGPT group tabs were left in place, marked for adoption on the next attach'};}
}

export class YBrowserFacade {
  constructor(opts={}){
    this.isolated=new YBrowserEngine(opts);
    this.existing=new YExistingBrowser({stateDir:opts.stateDir,currentOwner:opts.currentOwner,port:opts.existingPort??opts.existing?.port??9222,endpoints:opts.existing?.endpoints??[],groupName:opts.existing?.groupName??'YGPT',validateUrl:u=>this.isolated.validateUrl(u)});
    this.stateDir=opts.stateDir;
  }
  validateUrl(u){return this.isolated.validateUrl(u);}
  page(id){if(this.existing.has(id))return this.existing.page(id);return this.isolated.page(id);}
  engineFor(id){return this.existing.has(id)?this.existing:this.isolated;}
  async open(url,{target}={}){if(target==='existing'){await this.existing.attach({});return this.existing.open(url);}return this.isolated.open(url);}
  async attach(a={}){return this.existing.attach(a);}
  async detach(){return this.existing.detach();}
  attachStatus(){return this.existing.status();}
  async list(){const a=await this.isolated.list(),b=await this.existing.list();return {tabs:[...a.tabs.map(t=>({...t,mode:'isolated'})),...b.tabs],otherChatTabs:a.otherChatTabs,browserRunning:a.browserRunning,existingAttached:b.attached};}
  async navigate(id,url){return this.engineFor(id).navigate(id,url);}
  async snapshot(id){return this.engineFor(id).snapshot(id);}
  async act(id,action,target,value){return this.engineFor(id).act(id,action,target,value);}
  async wait(id,target,opts){return this.engineFor(id).wait(id,target,opts);}
  async screenshot(id){return this.engineFor(id).screenshot(id);}
  async download(id,target){return this.engineFor(id).download(id,target);}
  async closeTab(id){return this.engineFor(id).closeTab(id);}
  async closeContext(owner){return this.isolated.closeContext(owner);}
  owned(owner){return [...this.isolated.owned(owner),...this.existing.owned(owner)];}
  async close(){await Promise.allSettled([this.isolated.close(),this.existing.detach()]);}
}
