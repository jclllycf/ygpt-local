import {BoundedDownloads} from './bounded-download.mjs';
import {chromium} from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {EngineError,sha256} from './file-engine.mjs';
export class YBrowserEngine {
  constructor({stateDir,allowedHosts=['127.0.0.1','localhost','[::1]'],headless=true}={}){this.stateDir=stateDir;this.allowedHosts=new Set(allowedHosts);this.headless=headless;this.tabs=new Map();this.downloads=new Map();}
  validateUrl(raw){const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!this.allowedHosts.has(u.hostname))throw new EngineError('URL_NOT_ENROLLED','Browser destination is not enrolled in owner configuration');return u.href;}
  async launch(){
    if(this.context)return {isolated:true,channel:'msedge',existing:true};
    this.browser=await chromium.launch({channel:'msedge',headless:this.headless});
    this.context=await this.browser.newContext({acceptDownloads:false,viewport:{width:1100,height:760},serviceWorkers:'block'});
    this.context.setDefaultTimeout(10000);
    await this.context.route('**/*',async route=>{try{this.validateUrl(route.request().url());await route.continue();}catch{await route.abort('blockedbyclient');}});
    this.context.on('page',p=>this.track(p));
    return {isolated:true,channel:'msedge',headless:this.headless,personalProfileUsed:false,externalDebugPort:false};
  }
  track(page){for(const [id,p] of this.tabs)if(p===page)return id;const id=crypto.randomUUID();this.tabs.set(id,page);page.on('close',()=>this.tabs.delete(id));return id;}
  page(id){const p=this.tabs.get(id);if(!p||p.isClosed())throw new EngineError('NO_TAB','Unknown tab owned by this YGPT browser');return p;}
  async open(url){this.validateUrl(url);await this.launch();const p=await this.context.newPage(),tabId=this.track(p);await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(tabId);}
  async navigate(id,url){const p=this.page(id);await p.goto(this.validateUrl(url),{waitUntil:'domcontentloaded',timeout:15000});return this.snapshot(id);}
  async list(){return Promise.all([...this.tabs].map(async([id,p])=>({tabId:id,url:p.url(),title:await p.title()})));}
  async snapshot(id){const p=this.page(id);return {tabId:id,url:p.url(),title:await p.title(),observation:'Untrusted page content',aria:(await p.locator('body').ariaSnapshot({timeout:10000})).slice(0,20000)};}
  locator(p,{role,name,testId,selector}={}){if(testId)return p.getByTestId(testId);if(role)return p.getByRole(role,{name,exact:true});if(typeof selector!=='string'||selector.length>500)throw new EngineError('BAD_LOCATOR','Use role/name, testId, or a bounded CSS selector');return p.locator(selector);}
  async act(id,action,target={},value){const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Locator must match exactly one element');
    if(action==='click')await loc.click();else if(action==='fill')await loc.fill(String(value));else if(action==='press')await loc.press(String(value));else if(action==='select')await loc.selectOption(String(value));else if(action==='check')await loc.setChecked(value===true);else throw new EngineError('BAD_ACTION','Unsupported browser action');return this.snapshot(id);}
  async wait(id,target,{text,state='visible',timeoutMs=10000}={}){const loc=this.locator(this.page(id),target);if(text!==undefined)await loc.filter({hasText:text}).waitFor({state:'visible',timeout:timeoutMs});else await loc.waitFor({state,timeout:timeoutMs});return this.snapshot(id);}
  async screenshot(id){const p=this.page(id),dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`browser-${crypto.randomUUID()}.png`);const data=await p.screenshot({path:output,fullPage:false});return {path:output,mimeType:'image/png',sha256:sha256(data),bytes:data.length,scope:'YGPT-owned isolated tab'};}
  async download(id,target){
    const p=this.page(id),loc=this.locator(p,target);if(await loc.count()!==1)throw new EngineError('AMBIGUOUS_TARGET','Download locator must match once');
    const href=await loc.getAttribute('href');if(!href)throw new EngineError('DOWNLOAD_LINK_REQUIRED','Bounded downloads require a direct HTTP(S) link; JavaScript/blob downloads are disabled');
    this.bounded??=new BoundedDownloads({directory:path.join(this.stateDir,'downloads'),validateUrl:u=>this.validateUrl(u)});
    const result=await this.bounded.save(new URL(href,p.url()).href);this.downloads.set(result.downloadId,result);return result;
  }
  async closeTab(id){await this.page(id).close();return {closed:id};}
  async close(){await this.browser?.close();this.browser=null;this.context=null;this.tabs.clear();}
}
