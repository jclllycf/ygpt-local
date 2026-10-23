// YGPT extension relay: the bridge between the YGPT service and the YGPT
// browser extension installed in the owner's daily Chrome/Edge.
//
// The extension connects OUT to this relay over a token-authenticated
// WebSocket and exposes the browser it lives in: real tab groups, the real
// profile (accounts included), and per-tab Chrome DevTools Protocol through
// the chrome.debugger API. The relay re-exposes that as a CDP endpoint
// (http://127.0.0.1:<port>) so the existing Playwright-driven engine can
// consume the owner's daily browser exactly like any other CDP browser —
// except only the YGPT tab group's tabs are ever listed as targets. The
// owner's own tabs are counted, never exposed.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {WebSocketServer, WebSocket} from 'ws';

const silent=()=>{};
export class ExtensionRelay {
  constructor({stateDir,port=19341,groupName='YGPT',log=silent}={}){
    this.stateDir=stateDir;this.port=port;this.groupName=groupName;this.log=log;
    this.token=null;this.server=null;this.wssExt=null;this.wssCdp=null;
    this.instances=new Map(); // id -> {id,browser,version,profileEmail,profileId,ws,pending:Map,totalTabs,connectedAt}
    this.frameIds=new Map();   // tabId -> CDP targetId. In Chrome a page target's
                               // targetId IS its main frame's id, and Playwright
                               // looks sessions up by frame id — so tab ids must
                               // never be exposed as targetIds.
    this.boundId=null;         // instance chosen by the engine (one at a time)
    this.cdpClients=new Set(); // {ws,sessions:Map,sessionsByTab:Map,autoAttach}
    this.tabOrder=new Map();   // tabId -> tail of the in-order dispatch chain
    // CDP endpoint credential for this process only (never written to disk).
    // The Origin check keeps web pages out; this keeps other local programs
    // (including project scripts YGPT runs) from driving the owner's
    // logged-in group tabs. Playwright sends it on /json/version and the upgrade.
    this.cdpSecret=crypto.randomBytes(24).toString('base64url');
    this.reqSeq=0;
  }
  async pairing(){
    if(this.token)return {token:this.token,port:this.port};
    const file=path.join(this.stateDir,'extension-pairing.json');
    try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved?.token)this.token=saved.token;}catch{}
    if(!this.token){this.token=crypto.randomBytes(18).toString('base64url');try{await fs.mkdir(this.stateDir,{recursive:true});await fs.writeFile(file,JSON.stringify({token:this.token,port:this.port},null,2),{mode:0o600});}catch{}}
    return {token:this.token,port:this.port};
  }
  async start(){
    if(this.starting)return this.starting;
    if(this.server?.listening)return;
    this.starting=this.startServer().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async startServer(){
    await this.pairing();
    this.server=http.createServer((req,res)=>{void this.http(req,res);});
    this.wssExt=new WebSocketServer({noServer:true});
    this.wssCdp=new WebSocketServer({noServer:true});
    this.server.on('upgrade',(req,socket,head)=>{
      if(!this.localRequest(req)){socket.destroy();return;}
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/ext'){if(url.searchParams.get('token')!==this.token||req.headers.origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)){socket.destroy();return;}this.wssExt.handleUpgrade(req,socket,head,ws=>this.onExtension(ws));}
      else if(url.pathname==='/devtools/browser/ygpt'&&!req.headers.origin&&this.cdpAuthorized(req)){this.wssCdp.handleUpgrade(req,socket,head,ws=>this.onCdpClient(ws));}
      else socket.destroy();
    });
    try{await new Promise((resolve,reject)=>{const fail=e=>reject(e);this.server.once('error',fail);this.server.listen(this.port,'127.0.0.1',()=>{this.server.off('error',fail);resolve();});});}
    catch(e){this.server=null;this.wssExt.close();this.wssCdp.close();throw e;}
    this.port=this.server.address().port;this.startedAt=Date.now();
    this.log('extension relay listening on 127.0.0.1:'+this.port);
  }
  async stop(){
    await this.starting?.catch(()=>{});
    this.unbind();
    for(const inst of this.instances.values()){for(const p of inst.pending.values())p.reject(new Error('relay stopped'));inst.pending.clear();inst.ws.terminate();}
    for(const ws of this.wssExt?.clients??[])ws.terminate();
    for(const ws of this.wssCdp?.clients??[])ws.terminate();
    this.instances.clear();this.cdpClients.clear();
    await new Promise(r=>{if(this.server)this.server.close(()=>r());else r();});
    this.wssExt?.close();this.wssCdp?.close();
    this.server=null;
  }
  endpoint(){return 'http://127.0.0.1:'+this.port;}
  localRequest(req){return ['127.0.0.1:'+this.port,'localhost:'+this.port].includes(req.headers.host);}
  cdpAuthorized(req){const got=Buffer.from(String(req.headers['x-ygpt-relay']??'')),want=Buffer.from(this.cdpSecret);return got.length===want.length&&crypto.timingSafeEqual(got,want);}
  cdpHeaders(){return {'x-ygpt-relay':this.cdpSecret};}
  async http(req,res){
    if(!this.localRequest(req)||req.headers.origin&&req.headers.origin!==this.endpoint()&&req.headers.origin!=='http://localhost:'+this.port){res.writeHead(403);res.end();return;}
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    const url=new URL(req.url,'http://127.0.0.1');
    let pathname=url.pathname;if(pathname.length>1&&pathname.endsWith('/'))pathname=pathname.slice(0,-1); // Playwright asks for /json/version/ with a trailing slash
    if(pathname.startsWith('/json')&&!this.cdpAuthorized(req)){res.writeHead(401);res.end();return;}
    if(pathname==='/json/version'){return json(res,{Browser:'YGPT Extension Relay',ProtocolVersion:'1.3','Protocol-Version':'1.3',webSocketDebuggerUrl:'ws://127.0.0.1:'+this.port+'/devtools/browser/ygpt',UserAgent:'YGPT-Relay'});}
    if(pathname==='/json/list'||pathname==='/json'){const tabs=await this.boundGroupTabs().catch(()=>[]);return json(res,tabs.map(t=>({id:String(t.tabId),type:'page',title:t.title??'',url:t.url??'',webSocketDebuggerUrl:'ws://127.0.0.1:'+this.port+'/devtools/page/'+t.tabId})));}
    if(pathname==='/instances')return json(res,this.instancesList());
    if(pathname==='/pairing.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(PAIRING_SCRIPT);return;}
    if(pathname==='/'){return html(res,pairingPage({token:this.token,port:this.port,instances:this.instancesList()}));}
    res.writeHead(404);res.end();
  }
  // ---------- extension side ----------
  onExtension(ws){
    let inst=null;
    ws.on('message',async raw=>{
      let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
      if(msg.type==='hello'){
        if(inst)return;
        inst={id:String(msg.id||crypto.randomUUID()),browser:msg.browser??'Chromium',version:msg.version??'',profileEmail:profileEmail(msg.profile),profileId:msg.profile?.id??null,ws,pending:new Map(),totalTabs:msg.totalTabs??0,connectedAt:Date.now()};
        const previous=this.instances.get(inst.id);
        if(previous){if(this.boundId===inst.id)this.unbind();for(const p of previous.pending.values())p.reject(new Error('extension reconnected'));previous.pending.clear();previous.ws.terminate();}
        inst.profileLabel=instanceLabel(inst);
        this.instances.set(inst.id,inst);
        ws.send(JSON.stringify({type:'registered',id:inst.id,profileLabel:inst.profileLabel}));
        this.log('extension instance connected: '+inst.id+' '+(inst.profileEmail??''));
        return;
      }
      if(!inst||this.instances.get(inst.id)!==inst)return;
      if(msg.type==='profile'){inst.profileEmail=profileEmail(msg.profile);inst.profileId=msg.profile?.id??null;inst.profileLabel=instanceLabel(inst);}
      else if(msg.type==='res'){const p=inst.pending.get(msg.reqId);if(p){inst.pending.delete(msg.reqId);msg.ok?p.resolve(msg.result):p.reject(new Error(msg.error??'extension error'));}}
      else if(msg.type==='event'&&msg.kind==='cdp'){this.forwardCdpEvent(inst,msg.tabId,msg.method,msg.params);}
      else if(msg.type==='event'&&msg.kind==='tabsChanged'){if(typeof msg.totalTabs==='number')inst.totalTabs=msg.totalTabs;this.emitTargetChanges();}
      else if(msg.type==='event'&&msg.kind==='tabRemoved'){this.onTabRemoved(inst,msg.tabId);}
      else if(msg.type==='event'&&msg.kind==='detached'){this.onDebuggerDetached(inst,msg.tabId,msg.reason);}
    });
    const cleanup=()=>{if(inst){if(this.instances.get(inst.id)===inst){this.instances.delete(inst.id);if(this.boundId===inst.id)this.unbind();}for(const p of inst.pending.values())p.reject(new Error('extension disconnected'));inst.pending.clear();}};
    ws.on('close',cleanup);ws.on('error',cleanup);
  }
  callExtension(inst,method,params={},timeoutMs=20000){
    return new Promise((resolve,reject)=>{
      if(inst.ws.readyState!==WebSocket.OPEN)return reject(new Error('extension not connected'));
      const reqId=++this.reqSeq,timer=setTimeout(()=>{inst.pending.delete(reqId);reject(new Error('extension timed out on '+method));},timeoutMs);
      inst.pending.set(reqId,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
      try{inst.ws.send(JSON.stringify({type:'req',reqId,method,params}),e=>{if(e){const p=inst.pending.get(reqId);inst.pending.delete(reqId);p?.reject(e);}});}catch(e){inst.pending.delete(reqId);clearTimeout(timer);reject(e);}
    });
  }
  instancesList(){return [...this.instances.values()].map(i=>({id:i.id,browser:i.browser,version:i.version,profileEmail:i.profileEmail,profileLabel:i.profileLabel,totalTabs:i.totalTabs,connectedAt:i.connectedAt}));}
  bind(id){const inst=this.instances.get(id);if(!inst)throw new Error('extension instance is not connected');if(this.boundId!==id)this.unbind();this.boundId=id;return inst;}
  bound(){return this.boundId?this.instances.get(this.boundId)??null:null;}
  unbind(){this.boundId=null;this.frameIds.clear();for(const c of this.cdpClients)c.ws.terminate();}
  async boundGroupTabs(){const inst=this.bound();if(!inst)return [];const {tabs,totalTabs}=await this.callExtension(inst,'tabs.list',{groupName:this.groupName});if(this.bound()!==inst)throw new Error('extension instance changed');if(typeof totalTabs==='number')inst.totalTabs=totalTabs;return tabs.filter(t=>t.inGroup);}
  async requireGroupTab(inst,tabId){const tabs=await this.boundGroupTabs();if(this.bound()!==inst||!tabs.some(t=>t.tabId===tabId))throw new Error('Tab is no longer in the YGPT group');}
  async boundTotalTabs(){const inst=this.bound();if(!inst)return 0;const {tabs,totalTabs}=await this.callExtension(inst,'tabs.list',{groupName:this.groupName});if(typeof totalTabs==='number')inst.totalTabs=totalTabs;return inst.totalTabs;}
  // openerId lets Playwright link a popup to the group tab that opened it (so
  // it stays with that chat); only a resolved group tab can be an opener.
  targetInfo(tab){const openerId=tab.openerTabId!=null?this.frameIds.get(tab.openerTabId):undefined;return {targetId:this.frameIds.get(tab.tabId)??String(tab.tabId),type:'page',title:tab.title??'',url:tab.url??'',attached:false,browserContextId:'ygpt',canAccessOpener:false,...(openerId?{openerId}:{})};}
  async frameIdFor(inst,tabId){
    const cached=this.frameIds.get(tabId);if(cached)return cached;
    const tree=await this.callExtension(inst,'debugger.send',{tabId,method:'Page.getFrameTree',params:{}});
    const fid=tree?.frameTree?.frame?.id;
    if(!fid)throw new Error('could not read the tab frame tree');
    this.frameIds.set(tabId,String(fid));
    return String(fid);
  }
  async resolveFrameIds(inst,tabs){for(const t of tabs){if(!this.frameIds.has(t.tabId)){await this.callExtension(inst,'debugger.attach',{tabId:t.tabId}).catch(()=>{});await this.frameIdFor(inst,t.tabId).catch(()=>{});}}}
  tabIdForTarget(targetId){const id=String(targetId);for(const [tabId,fid] of this.frameIds)if(fid===id)return tabId;const n=Number(id);return Number.isInteger(n)&&String(n)===id?n:null;}
  // ---------- CDP client side (Playwright) ----------
  onCdpClient(ws){
    const client={ws,sessions:new Map(),byTab:new Map(),attaching:new Map(),autoAttach:false,instance:this.bound(),closed:false};
    this.cdpClients.add(client);
    ws.on('message',async raw=>{let msg;try{msg=JSON.parse(raw.toString());}catch{return;}await this.onCdpMessage(client,msg);});
    const cleanup=()=>{if(client.closed)return;client.closed=true;this.cdpClients.delete(client);const inst=client.instance;for(const [,s] of client.sessions){if(s.tabId!=null&&inst&&![...this.cdpClients].some(c=>c.instance===inst&&c.byTab.has(s.tabId)))void this.callExtension(inst,'debugger.detach',{tabId:s.tabId}).catch(()=>{});}client.sessions.clear();client.byTab.clear();};
    ws.on('close',cleanup);ws.on('error',cleanup);
  }
  send(client,obj){try{client.ws.send(JSON.stringify(obj));}catch{}}
  reply(client,msg,result){this.send(client,{id:msg.id,...(msg.sessionId?{sessionId:msg.sessionId}:{}),result:result??{}});}
  replyError(client,msg,message,code=-32000){this.send(client,{id:msg.id,...(msg.sessionId?{sessionId:msg.sessionId}:{}),error:{code,message:String(message??'error')}});}
  // The group check before each tab command is a round trip to the extension.
  // Run check + dispatch in arrival order per tab, so two commands (mouse
  // pressed/released, key down/up) can never overtake each other; responses
  // still complete in parallel.
  inTabOrder(tabId,step){
    const run=(this.tabOrder.get(tabId)??Promise.resolve()).then(step);
    const settled=run.then(()=>{},()=>{});this.tabOrder.set(tabId,settled);
    void settled.then(()=>{if(this.tabOrder.get(tabId)===settled)this.tabOrder.delete(tabId);});
    return run;
  }
  emit(client,method,params,sessionId){this.send(client,{method,params,...(sessionId?{sessionId}:{})});}
  async groupTargets(client){
    const tabs=await this.boundGroupTabs().catch(()=>[]);
    const inst=this.bound();if(inst&&tabs.length)await this.resolveFrameIds(inst,tabs);
    return tabs.map(t=>this.targetInfo(t));
  }
  async onCdpMessage(client,msg){
    const {method,params={}}=msg,sessionId=msg.sessionId;
    try{
      if(client.closed||client.instance!==this.bound())throw new Error('extension instance disconnected');
      // Browser-level and browser-control-session commands.
      if(!sessionId||client.sessions.get(sessionId)?.browserControl){
        if(method==='Browser.getVersion')return this.reply(client,msg,{protocolVersion:'1.3',product:'Chrome/YGPT-Extension',revision:'ygpt',userAgent:'YGPT Relay',jsVersion:'0'});
        if(method==='Target.setDiscoverTargets'){if(params.discover!==false){for(const t of await this.groupTargets(client))this.emit(client,'Target.targetCreated',{targetInfo:t});}return this.reply(client,msg,{});}
        if(method==='Target.setAutoAttach'){client.autoAttach=!!params.autoAttach;if(client.autoAttach)await this.autoAttachAll(client,params);return this.reply(client,msg,{});}
        if(method==='Target.getTargets')return this.reply(client,msg,{targetInfos:await this.groupTargets(client)});
        if(method==='Target.attachToBrowserTarget'){const sid='ygpt-browser-'+(++this.reqSeq);client.sessions.set(sid,{browserControl:true,tabId:null});return this.reply(client,msg,{sessionId:sid});}
        if(method==='Target.attachToTarget'){
          let tabId=this.tabIdForTarget(params.targetId);
          if(tabId==null){const inst=this.bound();if(inst){const tabs=await this.boundGroupTabs().catch(()=>[]);await this.resolveFrameIds(inst,tabs);tabId=this.tabIdForTarget(params.targetId);}}
          if(tabId==null)throw new Error('unknown target '+params.targetId);
          return this.reply(client,msg,{sessionId:await this.attachSession(client,tabId)});
        }
        if(method==='Target.createTarget')return this.reply(client,msg,{targetId:await this.createTarget(client,params)});
        if(method==='Target.closeTarget'){const tabId=this.tabIdForTarget(params.targetId);return this.reply(client,msg,{success:tabId==null?false:await this.closeTarget(client,tabId)});}
        if(method==='Target.activateTarget')return this.reply(client,msg,{}); // never steal focus, by design
        if(method==='Target.createBrowserContext')return this.reply(client,msg,{browserContextId:'ygpt'});
        if(method==='Target.disposeBrowserContext')return this.reply(client,msg,{});
        if(method==='Target.getTargetInfo'){
          // Playwright asks this on the root connection (no session, no
          // targetId) for the browser's own target info — and waits for it
          // before it will run anything in a page. Answer in kind; a real
          // targetId for one of the group tabs gets that tab's info.
          if(params.targetId){const tabs=await this.boundGroupTabs().catch(()=>[]);const tab=tabs.find(t=>t.tabId===this.tabIdForTarget(params.targetId));if(tab)return this.reply(client,msg,{targetInfo:this.targetInfo(tab)});}
          return this.reply(client,msg,{targetInfo:{targetId:'ygpt-browser',type:'browser',title:'',url:'',attached:true,canAccessOpener:false}});
        }
        if(!sessionId)return this.reply(client,msg,{});
      }
      const session=sessionId?client.sessions.get(sessionId):null;
      // Like Chrome: a command for a detached/unknown session is an error, not
      // an empty result Playwright would misread as a successful reply.
      if(sessionId&&!session&&method!=='Target.detachFromTarget')return this.replyError(client,msg,'Session with given id not found.',-32001);
      if(!session||session.tabId==null){
        if(method==='Target.detachFromTarget'){if(sessionId){client.sessions.delete(sessionId);}return this.reply(client,msg,{});}
        return this.reply(client,msg,{});
      }
      if(method==='Target.getTargetInfo'){const tabs=await this.boundGroupTabs().catch(()=>[]);const tab=tabs.find(t=>t.tabId===session.tabId);return this.reply(client,msg,{targetInfo:tab?this.targetInfo(tab):{targetId:this.frameIds.get(session.tabId)??String(session.tabId),type:'page',title:'',url:'',attached:true,browserContextId:'ygpt'}});}
      if(method==='Target.detachFromTarget'){await this.detachSession(client,sessionId);return this.reply(client,msg,{});}
      if(method==='Target.setAutoAttach'||method==='Target.setDiscoverTargets')return this.reply(client,msg,{});
      if(method==='Page.close'){await this.closeTarget(client,session.tabId);return this.reply(client,msg,{});}
      // Everything else is a real CDP command for the tab's debugger.
      const inst=this.bound();if(!inst)throw new Error('extension instance disconnected');
      const {sent}=await this.inTabOrder(session.tabId,async()=>{
        await this.requireGroupTab(inst,session.tabId);
        if(/^(?:Target|Browser)\./.test(method))throw new Error('Unsupported browser-wide command');
        const sent=this.callExtension(inst,'debugger.send',{tabId:session.tabId,method,params});sent.catch(()=>{});
        return {sent};
      });
      return this.reply(client,msg,(await sent)??{});
    }catch(e){return this.replyError(client,msg,e.message);}
  }
  async autoAttachAll(client,params={}){
    const tabs=await this.boundGroupTabs().catch(()=>[]);
    const inst=this.bound();if(inst&&tabs.length)await this.resolveFrameIds(inst,tabs);
    for(const tab of tabs){
      if(client.byTab.has(tab.tabId))continue;
      try{const sid=await this.attachSession(client,tab.tabId);this.emit(client,'Target.attachedToTarget',{sessionId:sid,targetInfo:{...this.targetInfo(tab),attached:true},waitingForDebugger:false});}catch{}
    }
  }
  async attachSession(client,tabId){
    const existing=client.byTab.get(tabId);if(existing)return existing;
    if(client.attaching.has(tabId))return client.attaching.get(tabId);
    const pending=this.attachTabSession(client,tabId).finally(()=>client.attaching.delete(tabId));
    client.attaching.set(tabId,pending);return pending;
  }
  async attachTabSession(client,tabId){
    const inst=this.bound();if(!inst)throw new Error('no extension instance is bound');
    await this.requireGroupTab(inst,tabId);
    await this.callExtension(inst,'debugger.attach',{tabId});
    await this.frameIdFor(inst,tabId).catch(()=>{});
    if(client.closed||client.instance!==this.bound())throw new Error('extension instance disconnected');
    const sid='ygpt-session-'+(++this.reqSeq);
    client.sessions.set(sid,{tabId});client.byTab.set(tabId,sid);
    return sid;
  }
  async detachSession(client,sessionId){
    const s=client.sessions.get(sessionId);if(!s)return;
    client.sessions.delete(sessionId);if(s.tabId!=null)client.byTab.delete(s.tabId);
    const inst=this.bound();if(inst&&s.tabId!=null)await this.callExtension(inst,'debugger.detach',{tabId:s.tabId}).catch(()=>{});
  }
  async createTarget(client,params={}){
    const inst=this.bound();if(!inst)throw new Error('no extension instance is bound');
    const created=await this.callExtension(inst,'tabs.create',{url:params.url||'about:blank',groupName:this.groupName});
    await this.callExtension(inst,'debugger.attach',{tabId:created.tabId}).catch(()=>{});
    await this.frameIdFor(inst,created.tabId).catch(()=>{});
    const info=this.targetInfo(created);
    for(const c of this.cdpClients){this.emit(c,'Target.targetCreated',{targetInfo:info});if(c.autoAttach){try{const sid=await this.attachSession(c,created.tabId);this.emit(c,'Target.attachedToTarget',{sessionId:sid,targetInfo:{...info,attached:true},waitingForDebugger:false});}catch{}}}
    return info.targetId;
  }
  async closeTarget(client,tabId){
    const inst=this.bound();if(!inst)return false;
    await this.requireGroupTab(inst,tabId);
    await this.callExtension(inst,'tabs.close',{tabId});
    this.onTabRemoved(inst,tabId);
    return true;
  }
  onTabRemoved(inst,tabId){
    if(this.boundId!==inst.id)return;
    const targetId=this.frameIds.get(tabId)??String(tabId);
    this.frameIds.delete(tabId);
    for(const c of this.cdpClients){
      const sid=c.byTab.get(tabId);
      if(sid){this.emit(c,'Target.detachedFromTarget',{sessionId:sid,targetId});c.sessions.delete(sid);c.byTab.delete(tabId);}
      this.emit(c,'Target.targetDestroyed',{targetId});
    }
  }
  // Chrome ended the tab's debugger session itself, taking every enabled CDP
  // domain with it: end the sessions (Playwright drops the page) so a later
  // attach starts clean. Cancel on Chrome's "started debugging" bar is the
  // owner stopping the take-over: drop the binding; tabs and group stay.
  onDebuggerDetached(inst,tabId,reason){
    if(this.boundId!==inst.id)return;
    if(reason==='canceled_by_user'){this.log('owner canceled debugging in '+inst.browser+'; take-over disconnected');this.unbind();return;}
    const targetId=this.frameIds.get(tabId)??String(tabId);
    for(const c of this.cdpClients){const sid=c.byTab.get(tabId);if(sid){this.emit(c,'Target.detachedFromTarget',{sessionId:sid,targetId});c.sessions.delete(sid);c.byTab.delete(tabId);}}
  }
  emitTargetChanges(){void (async()=>{const inst=this.bound();if(!inst)return;const tabs=await this.boundGroupTabs();for(const c of this.cdpClients){for(const tabId of c.byTab.keys())if(!tabs.some(t=>t.tabId===tabId))this.onTabRemoved(inst,tabId);for(const t of tabs)this.emit(c,'Target.targetInfoChanged',{targetInfo:this.targetInfo(t)});if(c.autoAttach)await this.autoAttachAll(c);}})().catch(()=>{});}
  forwardCdpEvent(inst,tabId,method,params){
    if(this.boundId!==inst.id)return;
    for(const c of this.cdpClients){const sid=c.byTab.get(tabId);if(sid)this.emit(c,method,params,sid);}
  }
}
function json(res,obj){const body=JSON.stringify(obj);res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(body)});res.end(body);}
function html(res,body){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(body);}
function pairingPage({token,port,instances}){
  const list=instances.length?instances.map(i=>'<li>'+escapeHtml(i.browser)+' — '+escapeHtml(i.profileLabel)+' <code>'+escapeHtml(i.id)+'</code>'+' ('+i.totalTabs+' tabs)</li>').join(''):'<li>No extension connected yet.</li>';
  return '<!doctype html><meta charset="utf-8"><title>YGPT browser pairing</title><style>body{font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#123}code{background:#eef4fb;padding:2px 6px;border-radius:6px}.tok{font-size:20px;letter-spacing:1px;background:#eaf5ff;border:1px solid #bcd9f7;border-radius:10px;padding:14px;word-break:break-all}</style><h1>Connect your daily browser to YGPT</h1><ol><li>In Chrome or Edge open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>), turn on <b>Developer mode</b>, choose <b>Load unpacked</b> and select the <code>extension</code> folder inside your YGPT Local installation folder.</li><li>Click the YGPT extension icon in the toolbar.</li><li>Paste this pairing token and keep port <code>'+port+'</code>:</li></ol><div class="tok">'+escapeHtml(token)+'</div><h2>Connected browsers</h2><ul id="instances">'+list+'</ul><script src="/pairing.js"></script><p>YGPT only ever works inside its own tab group in your browser. Your own tabs are never read or touched.</p>';
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

function profileEmail(profile){return typeof profile?.email==='string'&&profile.email.trim()?profile.email.trim():null;}
function instanceLabel(i){return i.profileEmail||i.browser+' profile '+i.id;}

const PAIRING_SCRIPT=`async function refresh(){
  try{
    const response=await fetch('/instances');if(!response.ok)return;
    const instances=await response.json();
    const rows=instances.map(i=>{const row=document.createElement('li');row.textContent=i.profileLabel+' ['+i.id+'] ('+i.totalTabs+' tabs)';return row;});
    if(!rows.length){const row=document.createElement('li');row.textContent='No extension connected yet.';rows.push(row);}
    document.getElementById('instances').replaceChildren(...rows);
  }catch{}
}
void refresh();setInterval(refresh,1000);`;
