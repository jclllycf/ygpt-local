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
export class YExistingBrowser {
  constructor({stateDir,currentOwner=()=>'local',port=9222,validateUrl}={}){
    this.stateDir=stateDir;this.owner=()=>currentOwner()??'local';this.defaultPort=port;
    this.validateUrl=typeof validateUrl==='function'?validateUrl:u=>new URL(u).href;
    this.browser=null;this.tabs=new Map();this.endpoint=null;
  }
  async attach({port}={}){
    if(this.browser)return this.status();
    const p=port??this.defaultPort,endpoint='http://127.0.0.1:'+p;
    let browser;
    try{browser=await chromium.connectOverCDP(endpoint,{timeout:8000});}
    catch{throw new EngineError('BROWSER_ATTACH_FAILED','No existing browser answered on '+endpoint+'. Start Chrome or Edge with remote debugging enabled (for example: chrome.exe --remote-debugging-port='+p+') and try again. Nothing was changed.');}
    this.browser=browser;this.endpoint=endpoint;
    browser.on('disconnected',()=>{if(this.browser===browser){this.browser=null;this.tabs.clear();}});
    for(const ctx of browser.contexts()){for(const pg of ctx.pages())this.track(pg);ctx.on('page',pg=>this.track(pg));}
    return this.status();
  }
  status(){return {attached:!!this.browser,endpoint:this.endpoint,browserVersion:this.browser?this.browser.version():null,tabs:[...this.tabs].map(([tabId,t])=>({tabId,url:t.page.url()}))};}
  track(page){for(const [,t] of this.tabs)if(t.page===page)return;const id=crypto.randomUUID();this.tabs.set(id,{page,owner:this.owner()});page.on('close',()=>{this.tabs.delete(id);});}
  has(id){return this.tabs.has(id);}
  page(id){
    const t=this.tabs.get(id),owner=this.owner();
    if(!t)throw new EngineError('NO_TAB','Unknown tab in the existing browser; attach and list its tabs again');
    if(t.owner!==owner)throw new EngineError('SESSION_FOREIGN','SESSION_FOREIGN: this existing-browser tab was attached by another chat context');
    if(t.page.isClosed())throw new EngineError('NO_TAB','Tab already closed');
    return t.page;
  }
  async open(url){this.validateUrl(url);if(!this.browser)await this.attach({});const ctx=this.browser.contexts()[0];if(!ctx)throw new EngineError('BROWSER_ATTACH_FAILED','The existing browser exposed no usable context');const p=await ctx.newPage();this.track(p);await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000});const id=[...this.tabs].find(([,t])=>t.page===p)?.[0];return this.snapshot(id);}
  async list(){const owner=this.owner(),mine=[...this.tabs].filter(([,t])=>t.owner===owner);return {attached:!!this.browser,tabs:await Promise.all(mine.map(async([id,t])=>({tabId:id,url:t.page.url(),title:await t.page.title().catch(()=>''),mode:'existing'})))};}
  async snapshot(id){const p=this.page(id);return {tabId:id,url:p.url(),title:await p.title(),observation:'Untrusted page content',aria:(await p.locator('body').ariaSnapshot({timeout:10000})).slice(0,20000)};}
  locator(p,{role,name,testId,selector}={}){if(testId)return p.getByTestId(testId);if(role)return p.getByRole(role,{name,exact:true});if(typeof selector!=='string'||selector.length>500)throw new EngineError('BAD_LOCATOR','Use role/name, testId, or a bounded CSS selector');return p.locator(selector);}
  async navigate(id,url){const p=this.page(id);await p.goto(this.validateUrl(url),{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(id);}
  async act(id,action,target={},value){const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Locator must match exactly one element');
    if(action==='click')await loc.click();else if(action==='fill')await loc.fill(String(value));else if(action==='press')await loc.press(String(value));else if(action==='select')await loc.selectOption(String(value));else if(action==='check')await loc.setChecked(value===true);else throw new EngineError('BAD_ACTION','Unsupported browser action');return this.snapshot(id);}
  async wait(id,target,{text,state='visible',timeoutMs=10000}={}){const loc=this.locator(this.page(id),target);if(text!==undefined)await loc.filter({hasText:text}).waitFor({state:'visible',timeout:timeoutMs});else await loc.waitFor({state,timeout:timeoutMs});return this.snapshot(id);}
  async screenshot(id){const p=this.page(id),dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`browser-existing-${crypto.randomUUID()}.png`);const data=await p.screenshot({path:output,fullPage:false});return {path:output,mimeType:'image/png',sha256:sha256(data),bytes:data.length,scope:'Owner existing-browser tab controlled by this chat'};}
  async download(id,target){
    const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Download locator must match once');
    const href=await loc.getAttribute('href');if(!href)throw new EngineError('DOWNLOAD_LINK_REQUIRED','Bounded downloads require a direct HTTP(S) link; JavaScript/blob downloads are disabled');
    this.bounded??=new BoundedDownloads({directory:path.join(this.stateDir,'downloads'),validateUrl:u=>this.validateUrl(u)});
    return this.bounded.save(new URL(href,p.url()).href);
  }
  async closeTab(id){await this.page(id).close();return {closed:id};}
  owned(owner=this.owner()){return [...this.tabs].filter(([,t])=>t.owner===owner).map(([tabId,t])=>({tabId,url:t.page.url(),mode:'existing'}));}
  async detach(){const b=this.browser;this.browser=null;this.tabs.clear();await b?.close().catch(()=>{});return {detached:true,note:'Disconnected from the existing browser; the browser itself was left running'};}
}

// One browser surface for the tool catalog: the isolated engine by default,
// the existing browser once attached. Tab IDs route to whichever engine owns
// them, so the y_browser_* tools work unchanged across both modes.
export class YBrowserFacade {
  constructor(opts={}){
    this.isolated=new YBrowserEngine(opts);
    this.existing=new YExistingBrowser({stateDir:opts.stateDir,currentOwner:opts.currentOwner,port:opts.existingPort??opts.existing?.port??9222,validateUrl:u=>this.isolated.validateUrl(u)});
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
