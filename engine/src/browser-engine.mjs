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
  static IDLE_MS=30000;
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
    await this.closing;
    if(this.browser)return this.browser;
    this.starting??=this.launcher({channel:this.channel,headless:this.headless}).then(browser=>{
      this.browser=browser;browser.on?.('disconnected',()=>{if(this.browser===browser)this.forget();});
      this.sweeper=setInterval(()=>void this.sweep(),Math.min(1000,this.idleMs)).unref?.()??null;return browser;
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
      entry.context=context;
      context.setDefaultTimeout(10000);
      await context.route('**/*',async route=>{try{this.validateUrl(route.request().url());await route.fallback();}catch{await route.abort('blockedbyclient');}});
      context.on('page',p=>this.track(p,owner));entry.context=context;return context;
    })().catch(async e=>{if(this.contexts.get(owner)===entry)this.contexts.delete(owner);await entry.context?.close().catch(()=>{});if(!this.contexts.size)await this.shutdownBrowser();throw e;});
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
  async open(url){this.validateUrl(url);const owner=this.owner(),context=await this.contextFor(owner);const p=await context.newPage(),tabId=this.track(p,owner);try{await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000});return await this.snapshot(tabId);}catch(e){await p.close().catch(()=>{});if(!this.owned(owner).length)await this.closeContext(owner);throw e;}}
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
  async closeTab(id){const owner=this.owner();await this.page(id).close();if(!this.owned(owner).length)await this.closeContext(owner);return {closed:id,browserRunning:!!this.browser};}
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
  async shutdownBrowser(){const b=this.browser;this.browser=null;if(this.sweeper)clearInterval(this.sweeper);this.sweeper=null;this.closing=b?.close().catch(()=>{});try{await this.closing;}finally{this.closing=null;}}
  async close(){for(const owner of [...this.contexts.keys()])await this.closeContext(owner);await this.shutdownBrowser();this.closedTabs.clear();}
}

// The owner's REAL daily browser (Chrome or Edge, default profile, their
// accounts and tabs), taken over through the YGPT browser extension. This is
// the single take-over mode: the extension lives inside the daily browser,
// pairs with the local relay (engine/src/extension-relay.mjs) using a token,
// and the relay re-exposes the browser as a CDP endpoint that only ever
// lists the YGPT tab group's tabs. Group tabs are real Chrome tab-group
// members, created in the background by the extension; the owner's own tabs
// are counted, never exposed, read, moved or closed.
import {ExtensionRelay} from './extension-relay.mjs';
export class YExtensionBrowser {
  // A paired extension reconnects on its own schedule (MV3 alarm/backoff, up
  // to about 30 s) after YGPT or the browser starts. While the relay is that
  // new, attach waits longer for the first announcement; the total stays
  // under the 30 s HTTP request limit even with the 10 s CDP connect.
  static FRESH_RELAY_MS=35000;static FRESH_WAIT_MS=15000;static SETTLED_WAIT_MS=4000;
  constructor({stateDir,currentOwner=()=>'local',port=19341,groupName='YGPT',validateUrl,relay}={}){
    this.stateDir=stateDir;this.owner=()=>currentOwner()??'local';
    this.groupName=groupName||'YGPT';
    this.validateUrl=typeof validateUrl==='function'?validateUrl:u=>new URL(u).href;
    this.relay=relay??new ExtensionRelay({stateDir,port,groupName:this.groupName});
    this.relayReady=null;
    this.browser=null;this.tabs=new Map();this.identity=null;
    this.holders=new Set(); // chats currently attached to the shared connection
  }
  async ensureRelay(){if(!this.relayReady)this.relayReady=this.relay.start().catch(e=>{this.relayReady=null;throw e;});await this.relayReady;}
  // Production starts the relay with the service, so a paired extension is
  // normally connected long before the first y_browser_attach. A busy port is
  // not fatal here; attach retries and reports it.
  prestart(){void this.ensureRelay().catch(()=>{});}
  pairingUrl(){return this.relay.endpoint()+'/';}
  async attach({instance}={}){
    if(this.attaching){await this.attaching;return this.attach({instance});}
    this.attaching=this.attachBrowser({instance});
    try{return await this.attaching;}finally{this.attaching=null;}
  }
  async attachBrowser({instance}={}){
    // The take-over connection is shared by every chat. A later attach adopts
    // group tabs no chat holds (left over, or released by a detach).
    if(this.browser&&!instance){this.holders.add(this.owner());const adopted=this.adoptUnowned(this.owner());return {...this.status(),adopted};}
    await this.ensureRelay();
    let candidates=this.relay.instancesList();
    const fresh=Date.now()-(this.relay.startedAt??0)<YExtensionBrowser.FRESH_RELAY_MS;
    const deadline=Date.now()+(fresh?YExtensionBrowser.FRESH_WAIT_MS:YExtensionBrowser.SETTLED_WAIT_MS);
    while(candidates.length===0&&Date.now()<deadline){await new Promise(r=>setTimeout(r,250));candidates=this.relay.instancesList();}
    if(candidates.length===0)throw new EngineError('BROWSER_EXTENSION_MISSING','The YGPT browser extension is not connected, so there is no daily browser to take over. If the owner already installed and paired it, the browser may be closed or may still be reconnecting (it retries about every 30 seconds after YGPT or the browser starts): wait briefly and call y_browser_attach again. Otherwise ask the owner to: (1) load the YGPT extension from the "extension" folder of their YGPT Local installation (chrome://extensions or edge://extensions, Developer mode, Load unpacked), (2) open '+this.pairingUrl()+' in that browser and copy the pairing token, (3) paste it into the extension popup. Nothing was changed.');
    // Pairing announcements can arrive in a burst (several browsers
    // reconnecting when the service starts). With exactly one candidate and
    // no explicit choice, settle briefly so a second profile that is pairing
    // right now is offered as a choice instead of being silently skipped —
    // attaching must never guess between accounts.
    if(candidates.length===1&&!instance){await new Promise(r=>setTimeout(r,700));candidates=this.relay.instancesList();}
    let chosen=null;
    if(instance){const needle=String(instance).toLowerCase();const exact=candidates.find(c=>c.id===instance);const matches=exact?[exact]:candidates.filter(c=>(c.profileEmail??'').toLowerCase().includes(needle)||c.browser.toLowerCase()===needle);if(matches.length>1)return {needsChoice:true,note:'That account/browser matches several paired profiles. Choose an exact instance id.',candidates:matches.map(c=>({instance:c.id,browser:c.browser,profileEmail:c.profileEmail,profileLabel:c.profileLabel,tabs:c.totalTabs}))};chosen=matches[0]??null;if(!chosen)throw new EngineError('BROWSER_INSTANCE_UNKNOWN','No connected browser matches "'+instance+'". Connected: '+candidates.map(c=>c.profileLabel+' ['+c.id+']').join('; '));}
    else if(candidates.length>1)return {needsChoice:true,note:'Several browsers/profiles are paired. Ask the owner which account/browser to use, then attach again with its instance id or profile email — do not guess: accounts must not be mixed.',candidates:candidates.map(c=>({instance:c.id,browser:c.browser,profileEmail:c.profileEmail,profileLabel:c.profileLabel,tabs:c.totalTabs}))};
    else chosen=candidates[0];
    if(this.browser){
      if(this.identity.instance!==chosen.id)throw new EngineError('BROWSER_ALREADY_ATTACHED','The daily browser is already attached to '+this.identity.instance+'. Detach before selecting '+chosen.id+'; the existing profile was left in place.');
      this.holders.add(this.owner());const adopted=this.adoptUnowned(this.owner());return {...this.status(),adopted};
    }
    this.relay.bind(chosen.id);
    let browser;
    try{browser=await chromium.connectOverCDP(this.relay.cdpEndpoint?.()??this.relay.endpoint(),{timeout:10000,headers:this.relay.cdpHeaders()});}
    catch{this.relay.unbind();throw new EngineError('BROWSER_ATTACH_FAILED','The paired browser stopped answering before the connection completed. Nothing was changed.');}
    this.browser=browser;
    this.identity={via:'YGPT browser extension',browser:chosen.browser,profileEmail:chosen.profileEmail,profileLabel:chosen.profileLabel,instance:chosen.id,extensionVersion:chosen.extensionVersion??'unknown'};
    browser.on('disconnected',()=>{if(this.browser===browser){this.browser=null;this.tabs.clear();this.identity=null;this.holders.clear();}});
    let adopted=0;
    const owner=this.owner();this.holders=new Set([owner]);
    for(const ctx of browser.contexts()){ctx.on('page',pg=>this.onNewPage(pg));for(const pg of ctx.pages()){this.track(pg,owner);adopted++;}}
    return {...this.status(),adopted};
  }
  // A page that appears after attach (a popup or link opened by a group tab,
  // a tab re-adopted after Chrome ended its session, a tab the owner moved
  // into the group) belongs to its opener's chat. Without a known opener it
  // goes to the only chat holding the connection; with several it stays
  // unowned for the next y_browser_attach — never guessed between chats.
  onNewPage(pg){
    void pg.opener().then(opener=>{
      if(pg.isClosed()||[...this.tabs.values()].some(t=>t.page===pg))return; // createGroupTab claimed it
      const parent=opener?[...this.tabs.values()].find(t=>t.page===opener):null;
      const owner=parent?.owner??(this.holders.size===1?[...this.holders][0]:null);
      if(owner!=null)this.track(pg,owner);
    }).catch(()=>{});
  }
  status(){const mine=[...this.tabs].filter(([,t])=>t.owner===this.owner());return {attached:!!this.browser,identity:this.identity,group:this.browser?{name:this.groupName,tabs:mine.length}:null,pairingUrl:this.pairingUrl(),tabs:mine.map(([tabId,t])=>({tabId,url:t.page.url()}))};}
  track(page,owner=this.owner(),claim=false){
    for(const [id,t] of this.tabs)if(t.page===page){if(claim)t.owner=owner;return id;}
    const id=crypto.randomUUID();this.tabs.set(id,{page,owner});
    page.on('close',()=>{this.tabs.delete(id);});
    return id;
  }
  adoptUnowned(owner){let n=0;if(!this.browser)return n;for(const ctx of this.browser.contexts())for(const pg of ctx.pages())if(!pg.isClosed()&&![...this.tabs.values()].some(t=>t.page===pg)){this.track(pg,owner);n++;}return n;}
  // Forget this chat's tabs without closing them; they stay in the YGPT group
  // for a later attach. Used by detach and by y_close_context.
  release(owner=this.owner()){this.holders.delete(owner);let n=0;for(const [id,t] of this.tabs)if(t.owner===owner){this.tabs.delete(id);n++;}return n;}
  has(id){return this.tabs.has(id);}
  page(id){
    const t=this.tabs.get(id),owner=this.owner();
    if(!t)throw new EngineError('NO_TAB','Unknown tab in the YGPT group of the daily browser; attach and list its tabs again');
    if(t.owner!==owner)throw new EngineError('SESSION_FOREIGN','SESSION_FOREIGN: this daily-browser tab was attached by another chat context');
    if(t.page.isClosed())throw new EngineError('NO_TAB','Tab already closed');
    return t.page;
  }
  async createGroupTab(url){
    const ctx=this.browser.contexts()[0];if(!ctx)throw new EngineError('BROWSER_ATTACH_FAILED','The daily browser exposed no usable context');
    // Playwright associates newPage with its exact Target.createTarget reply.
    // The relay always creates that target in the background YGPT group;
    // set-difference matching races with concurrent opens and page popups.
    const page=await ctx.newPage();
    this.holders.add(this.owner());this.track(page,this.owner(),true);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
    return page;
  }
  async open(url){
    this.validateUrl(url);
    if(!this.browser){const r=await this.attach({});if(r?.needsChoice)throw new EngineError('BROWSER_CHOICE_REQUIRED','Several browsers/profiles are paired ('+r.candidates.map(c=>c.profileLabel+' ['+c.instance+']').join('; ')+'). Ask the owner which account/browser to use, then y_browser_attach with that instance.');}
    const page=await this.createGroupTab(url);
    this.track(page);
    try{await page.waitForLoadState('domcontentloaded',{timeout:15000});}catch{}
    const id=[...this.tabs].find(([,t])=>t.page===page)?.[0];
    return {...await this.snapshot(id),group:{name:this.groupName},background:true};
  }
  async list(){
    const owner=this.owner(),mine=[...this.tabs].filter(([,t])=>t.owner===owner);
    let total=0,groupTabs=0;
    if(this.browser){try{total=await this.relay.boundTotalTabs();groupTabs=(await this.relay.boundGroupTabs()).length;}catch{}}
    return {attached:!!this.browser,identity:this.identity,group:this.browser?{name:this.groupName}:null,ownerTabsNotTouched:Math.max(0,total-groupTabs),tabs:await Promise.all(mine.map(async([id,t])=>({tabId:id,url:t.page.url(),title:await t.page.title().catch(()=>''),mode:'existing'})))};
  }
  async snapshot(id){const p=this.page(id);return {tabId:id,url:p.url(),title:await p.title(),observation:'Untrusted page content',aria:(await p.locator('body').ariaSnapshot({timeout:10000})).slice(0,20000)};}
  locator(p,{role,name,testId,selector}={}){if(testId)return p.getByTestId(testId);if(role)return p.getByRole(role,{name,exact:true});if(typeof selector!=='string'||selector.length>500)throw new EngineError('BAD_LOCATOR','Use role/name, testId, or a bounded CSS selector');return p.locator(selector);}
  async navigate(id,url){const p=this.page(id);await p.goto(this.validateUrl(url),{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(id);}
  async act(id,action,target={},value){const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Locator must match exactly one element');
    if(action==='click')await loc.click();else if(action==='fill')await loc.fill(String(value));else if(action==='press')await loc.press(String(value));else if(action==='select')await loc.selectOption(String(value));else if(action==='check')await loc.setChecked(value===true);else throw new EngineError('BAD_ACTION','Unsupported browser action');return this.snapshot(id);}
  async wait(id,target,{text,state='visible',timeoutMs=10000}={}){const loc=this.locator(this.page(id),target);if(text!==undefined)await loc.filter({hasText:text}).waitFor({state:'visible',timeout:timeoutMs});else await loc.waitFor({state,timeout:timeoutMs});return this.snapshot(id);}
  async screenshot(id){const p=this.page(id),dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`browser-existing-${crypto.randomUUID()}.png`);const data=await p.screenshot({path:output,fullPage:false});return {path:output,mimeType:'image/png',sha256:sha256(data),bytes:data.length,scope:'YGPT group tab in the owner daily browser'};}
  async download(id,target){
    const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Download locator must match once');
    const href=await loc.getAttribute('href');if(!href)throw new EngineError('DOWNLOAD_LINK_REQUIRED','Bounded downloads require a direct HTTP(S) link; JavaScript/blob downloads are disabled');
    this.bounded??=new BoundedDownloads({directory:path.join(this.stateDir,'downloads'),validateUrl:u=>this.validateUrl(u)});
    return this.bounded.save(new URL(href,p.url()).href);
  }
  async closeTab(id){await this.page(id).close();return {closed:id};}
  owned(owner=this.owner()){return [...this.tabs].filter(([,t])=>t.owner===owner).map(([tabId,t])=>({tabId,url:t.page.url(),mode:'existing'}));}
  // Chat-scoped: one chat detaching must not cut off another chat that still
  // works in the daily browser. The shared connection closes with the last.
  async detach(){
    await this.attaching?.catch(()=>{});
    const released=this.release(this.owner());
    if(this.browser&&(this.holders.size||this.tabs.size))return {detached:true,released,sharedConnectionKept:true,note:'This chat released its YGPT group tabs; they stay open in the group. Another chat is still working in the daily browser, so the shared connection stays open. Nothing was closed.'};
    await this.disconnect();
    return {detached:true,released,note:'Disconnected. The daily browser was left running, the extension stays paired, and the YGPT tab group was left in place for the next attach'};
  }
  async disconnect(){const b=this.browser;this.browser=null;this.tabs.clear();this.identity=null;this.holders.clear();await b?.close().catch(()=>{});this.relay.unbind();}
  async close(){await this.attaching?.catch(()=>{});await this.disconnect().catch(()=>{});await this.relay.stop().catch(()=>{});this.relayReady=null;}
}

// Each chat selects its own profile; each profile has a separate CDP relay.
// A second chat never implicitly inherits the first chat's signed-in account.
export class YMultiExtensionBrowser {
  constructor(opts={}){this.opts=opts;this.owner=()=>opts.currentOwner?.()??'local';this.relay=new ExtensionRelay({stateDir:opts.stateDir,port:opts.port??19341,groupName:opts.groupName??'YGPT'});this.engines=new Map();this.selections=new Map();}
  async ensureRelay(){await this.relay.start();}
  prestart(){void this.ensureRelay().catch(()=>{});}
  pairingUrl(){return this.relay.endpoint()+'/';}
  selected(){return this.engines.get(this.selections.get(this.owner()));}
  async attach({instance}={}){
    const owner=this.owner();await this.ensureRelay();
    const current=this.selected();if(current?.browser&&!instance)return current.attach({});
    let candidates=this.relay.instancesList();
    if(!candidates.length){const end=Date.now()+YExtensionBrowser.FRESH_WAIT_MS;while(!candidates.length&&Date.now()<end){await new Promise(r=>setTimeout(r,250));candidates=this.relay.instancesList();}}
    if(!candidates.length)throw new EngineError('BROWSER_EXTENSION_MISSING','No YGPT extension is paired. Open '+this.pairingUrl()+' in each intended browser profile and pair its extension. Personal profiles are never loaded or copied automatically.');
    const matches=instance?candidates.filter(c=>c.id===instance||c.profileEmail?.toLowerCase()===String(instance).toLowerCase()||c.browser.toLowerCase()===String(instance).toLowerCase()||c.profileLabel?.toLowerCase()===String(instance).toLowerCase()):candidates;
    if(matches.length!==1){if(!matches.length)throw new EngineError('BROWSER_INSTANCE_UNKNOWN','The selected paired profile is not connected');return {needsChoice:true,candidates:matches.map(c=>({instance:c.id,browser:c.browser,profileEmail:c.profileEmail,profileLabel:c.profileLabel,tabs:c.totalTabs})),note:'Select an exact instance. Each chat keeps its own browser profile selection.'};}
    const id=matches[0].id;
    if(current&&this.selections.get(owner)!==id&&current.owned(owner).length)throw new EngineError('BROWSER_PROFILE_IN_USE','Detach this chat before changing its profile; its current tabs were preserved');
    let engine=this.engines.get(id);if(!engine){engine=new YExtensionBrowser({...this.opts,relay:this.relay.profileRelay(id)});this.engines.set(id,engine);}
    const result=await engine.attach({instance:id});this.selections.set(owner,id);return result;
  }
  status(){return {...(this.selected()?.status()??{attached:false}),pairingUrl:this.pairingUrl(),candidates:this.relay.instancesList().map(c=>({instance:c.id,browser:c.browser,profileLabel:c.profileLabel}))};}
  has(id){return [...this.engines.values()].some(e=>e.has(id));}
  forTab(id){const engine=[...this.engines.values()].find(e=>e.has(id));if(!engine)throw new EngineError('NO_TAB','Unknown daily-browser tab');return engine;}
  page(id){return this.forTab(id).page(id);}
  async open(url){if(!this.selected()?.browser){const result=await this.attach({});if(result.needsChoice)throw new EngineError('BROWSER_CHOICE_REQUIRED','Choose an exact paired instance with y_browser_attach before opening a daily-browser tab');}return this.selected().open(url);}
  async list(){const engine=this.selected();return engine?engine.list():{attached:false,tabs:[],ownerTabsNotTouched:0};}
  async detach(){const owner=this.owner(),engine=this.selected();const result=engine?await engine.detach():{detached:true};this.selections.delete(owner);return result;}
  release(owner=this.owner()){let n=0;for(const e of this.engines.values())n+=e.release(owner);this.selections.delete(owner);return n;}
  owned(owner=this.owner()){return [...this.engines.values()].flatMap(e=>e.owned(owner));}
  async close(){await Promise.allSettled([...this.engines.values()].map(e=>e.close()));this.engines.clear();this.selections.clear();await this.relay.stop();}
}
for(const method of ['navigate','snapshot','act','wait','screenshot','download','closeTab'])YMultiExtensionBrowser.prototype[method]=function(id,...args){return this.forTab(id)[method](id,...args);};

export class YBrowserFacade {
  constructor(opts={}){
    this.isolated=new YBrowserEngine(opts);
    this.existing=new YMultiExtensionBrowser({stateDir:opts.stateDir,currentOwner:opts.currentOwner,port:opts.extension?.port??19341,groupName:opts.extension?.groupName??'YGPT',validateUrl:u=>this.isolated.validateUrl(u)});
    this.stateDir=opts.stateDir;
  }
  validateUrl(u){return this.isolated.validateUrl(u);}
  page(id){if(this.existing.has(id))return this.existing.page(id);return this.isolated.page(id);}
  engineFor(id){return this.existing.has(id)?this.existing:this.isolated;}
  async open(url,{target,keepAlive=false}={}){if(target==='existing')return this.existing.open(url);const owner=this.isolated.owner();try{const result=await this.isolated.open(url);return {...result,ephemeral:!keepAlive,...(!keepAlive?{closedAfterCall:true}:{leaseExpiresAfterIdleMs:this.isolated.idleMs})};}finally{if(!keepAlive)await this.isolated.closeContext(owner);}}
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
  async closeContext(owner){const released=this.existing.release(owner);return {...await this.isolated.closeContext(owner),...(released?{dailyBrowserTabsReleased:released}:{})};}
  owned(owner){return [...this.isolated.owned(owner),...this.existing.owned(owner)];}
  async close(){await Promise.allSettled([this.isolated.close(),this.existing.close()]);}
}
