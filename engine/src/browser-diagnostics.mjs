import {EngineError} from './file-engine.mjs';
const limit=(v,n=20000)=>String(v??'').slice(0,n);
const scrub=v=>limit(v).replace(/((?:authorization|password|token|secret|api[_-]?key|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi,'$1[REDACTED]').replace(/Bearer\s+[\w./+\-=]+/gi,'Bearer [REDACTED]');
const url=value=>{try{const u=new URL(value);return limit(u.origin+u.pathname,1000);}catch{return limit(value,500);}};
const bounded=value=>{const json=JSON.stringify(value)??'null';return json.length<=64000?value:{truncated:true,totalCharacters:json.length,preview:json.slice(0,64000)};};
export async function waitForBrowser(browser,id,target,{text,state='visible',timeoutMs=10000}={}){
 let page;try{page=browser.page(id);}catch(e){if(['NO_TAB','BROWSER_CONTEXT_CLOSED'].includes(e.code))return {tabId:id,status:'target_lost',conditionSatisfied:false,retryable:false,effectStarted:false};throw e;}
 try{const loc=browser.locator(page,target);if(text!==undefined)await loc.filter({hasText:text}).waitFor({state:'visible',timeout:timeoutMs});else await loc.waitFor({state,timeout:timeoutMs});
  let observation;try{observation=await browser.snapshot(id);}catch(e){observation={observationUnavailable:true,observationError:e.code??e.name};}
  return {...observation,tabId:id,status:'satisfied',conditionSatisfied:true,retryable:false};
 }catch(e){if(page.isClosed())return {tabId:id,status:'target_lost',conditionSatisfied:false,retryable:false,effectStarted:false};
  if(e.name==='TimeoutError')return {tabId:id,status:'timeout',conditionSatisfied:false,retryable:true,timeoutMs,effectStarted:false,message:'The page condition was not met before the deadline. This read-only wait may be sampled again; no action was repeated.'};
  throw Object.assign(e,{outcomeUnknown:false,effectStarted:false});}
}
// In-memory, bounded observations attached only to pages already owned by this chat.
export class BrowserDiagnostics {
 constructor(){this.pages=new WeakMap();}
 track(page){let state=this.pages.get(page);if(state)return state;
  state={console:[],network:[],dropped:0,sessions:new Map()};this.pages.set(page,state);
  const push=(kind,item)=>{const list=state[kind];list.push({at:new Date().toISOString(),...item});if(list.length>200){list.shift();state.dropped++;}};
  page.on('console',m=>push('console',{type:m.type(),text:scrub(m.text())}));page.on('pageerror',e=>push('console',{type:'pageerror',text:scrub(e.message)}));
  page.on('requestfailed',r=>{if(!state.cdpReady)push('network',{method:r.method(),url:url(r.url()),failure:limit(r.failure()?.errorText,500)});});
  page.on('response',r=>{if(!state.cdpReady)push('network',{status:r.status(),method:r.request().method(),url:url(r.url())});});
  state.push=push;page.on('close',()=>{state.console.length=0;state.network.length=0;void state.session?.detach().catch(()=>{});});return state;
 }
 async session(page,state){if(!state.connecting)state.connecting=(async()=>{const session=await page.context().newCDPSession(page);state.session=session;
  session.on('Network.responseReceived',e=>state.push('network',{requestId:e.requestId,status:e.response.status,url:url(e.response.url),type:e.type}));
  session.on('Network.loadingFailed',e=>state.push('network',{requestId:e.requestId,failure:limit(e.errorText,500)}));await session.send('Network.enable',{maxTotalBufferSize:2*1024*1024,maxResourceBufferSize:512*1024});state.cdpReady=true;return session;
 })().catch(e=>{state.connecting=null;throw e;});return state.connecting;}
 async run(page,{action='status',expression,method,params={},limit:count=50}={}){const state=this.track(page);
  if(action==='status'){let cdpAvailable=true;try{await this.session(page,state);}catch{cdpAvailable=false;}return {url:url(page.url()),consoleEntries:state.console.length,networkEntries:state.network.length,dropped:state.dropped,cdpAvailable,persistentLogs:false,scope:'this chat-owned tab'};}
  if(action==='console'||action==='network')return {entries:state[action].slice(-count),dropped:state.dropped,queryStringsAndHeadersOmitted:true};
  if(action==='clear'){state.console.length=0;state.network.length=0;state.dropped=0;return {cleared:true};}
  if(action==='evaluate'){
   if(typeof expression!=='string'||!expression.length||expression.length>20000)throw new EngineError('DEBUG_EXPRESSION_INVALID','Provide a JavaScript expression of 1 to 20000 characters');
   let timer;try{return {value:bounded(await Promise.race([page.evaluate(expression),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new EngineError('DEBUG_EVALUATION_TIMEOUT','JavaScript may still be running. Inspect page state; do not replay the expression.'),{effectStarted:true,outcomeUnknown:true})),5000);})]))};}finally{clearTimeout(timer);}
  }
  // Browser-wide Target, Browser and extension lifecycle domains are deliberately
  // served by the separate, explicitly configured extension-development adapter.
  const reads=new Set(['DOM.getDocument','DOM.getOuterHTML','DOM.describeNode','Accessibility.getFullAXTree','Page.getFrameTree','Page.getLayoutMetrics','Performance.getMetrics','Runtime.getHeapUsage','Network.getResponseBody','Debugger.getScriptSource']);
  if(action!=='cdp'||!/^(DOM|DOMSnapshot|CSS|Accessibility|Page|Runtime|Network|Debugger|Performance|Input|Emulation|Overlay)\.[A-Za-z]+$/.test(method??''))throw new EngineError('DEBUG_METHOD_UNSUPPORTED','Choose a tab-scoped DOM, CSS, Accessibility, Page, Runtime, Network, Debugger, Performance, Input, Emulation or Overlay method. Browser, Target and extension lifecycle use the separate development adapter.');
  const session=await this.session(page,state);let timer;try{return {method,result:bounded(await Promise.race([session.send(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new EngineError('DEBUG_CDP_TIMEOUT','CDP did not return before the deadline; inspect the tab before repeating any mutation.'),{effectStarted:!reads.has(method),outcomeUnknown:!reads.has(method)})),5000);})]))};}finally{clearTimeout(timer);}
 }
}
