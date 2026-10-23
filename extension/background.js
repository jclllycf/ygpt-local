// YGPT Local extension service worker.
//
// Connects this browser profile to the YGPT service running on this computer
// (token pairing, set from the popup) and exposes exactly what the service
// needs to work inside its own tab group:
//   - tab listing/creation/closing, with new tabs placed in the tab group
//     titled "YGPT" and created in the background (never activated);
//   - per-tab Chrome DevTools Protocol via chrome.debugger.
// The profile's signed-in account (chrome.identity) is reported at connect
// time so the service can tell several browsers/accounts apart and let the
// owner designate the right one.
const DEFAULTS={host:'127.0.0.1',port:19341,token:'',groupName:'YGPT'};
let settings={...DEFAULTS};
let ws=null,wsState='closed',backoff=2000,instanceId=null,attached=new Set();
const attaching=new Map(),commandOrder=new Map();
let connecting=null,reconnectTimer=null,keepaliveTimer=null,registrationTimer=null;
let cachedProfile={email:null,id:null};
// Chrome stops an idle MV3 service worker after about 30 s; WebSocket traffic
// resets that timer (Chrome 116+). Without it the socket closes between chat
// turns, the relay drops the binding and the chat loses its YGPT tabs.
const KEEPALIVE_MS=20000;

async function loadSettings(){
  const saved=await chrome.storage.local.get(['ygptSettings','ygptInstanceId']);
  if(saved.ygptSettings)settings={...DEFAULTS,...saved.ygptSettings};
  instanceId=saved.ygptInstanceId;
  if(!instanceId){instanceId=[...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,'0')).join('');await chrome.storage.local.set({ygptInstanceId:instanceId});}
}
async function profileInfo(){
  try{const info=await chrome.identity.getProfileUserInfo({accountStatus:'ANY'});return {email:info?.email||null,id:info?.id||null};}catch{return {email:null,id:null};}
}
async function totalTabs(){try{return (await chrome.tabs.query({})).length;}catch{return 0;}}
function browserKind(){const ua=navigator.userAgent;return ua.includes('Edg/')?'Edge':'Chrome';}

async function connect(){
  if(connecting)return connecting;
  connecting=connectOnce().finally(()=>{connecting=null;});
  return connecting;
}
async function connectOnce(){
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
  await loadSettings();
  if(!settings.token){wsState='needs-token';return;}
  const url='ws://'+settings.host+':'+settings.port+'/ext?token='+encodeURIComponent(settings.token);
  let socket;
  try{socket=new WebSocket(url);ws=socket;}catch{wsState='error';scheduleReconnect();return;}
  wsState='connecting';
  socket.onopen=()=>{
    if(ws!==socket)return;
    wsState='registering';backoff=2000;
    startKeepalive(socket);
    // Pairing identifies a profile, even without Chrome sign-in. Neither
    // optional browser API may hold up hello (or the popup's status reply).
    send({type:'hello',id:instanceId,browser:browserKind(),version:(navigator.userAgent.match(/(?:Chrome|Edg)\/([\d.]+)/)||[])[1]||'',profile:cachedProfile,totalTabs:0},socket);
    clearTimeout(registrationTimer);registrationTimer=setTimeout(()=>registrationExpired(socket),10000);
    void profileInfo().then(profile=>{if(ws!==socket)return;cachedProfile=profile;send({type:'profile',profile},socket);});
    void totalTabs().then(count=>send({type:'event',kind:'tabsChanged',totalTabs:count},socket));
  };
  socket.onmessage=ev=>{if(ws===socket)void onRequest(ev.data,socket);};
  socket.onclose=()=>{if(ws!==socket)return;stopKeepalive();clearTimeout(registrationTimer);if(wsState!=='registration-timeout')wsState='closed';ws=null;void detachAll().then(scheduleReconnect);};
  socket.onerror=()=>{try{socket.close();}catch{}};
}
function registrationExpired(socket){if(ws!==socket||wsState==='registered')return;wsState='registration-timeout';socket.close();}
function profileLabel(){return cachedProfile.email||browserKind()+' profile '+instanceId;}
function startKeepalive(socket){stopKeepalive();keepaliveTimer=setInterval(()=>{if(ws!==socket){stopKeepalive();return;}send({type:'ping'},socket);},KEEPALIVE_MS);}
function stopKeepalive(){clearInterval(keepaliveTimer);keepaliveTimer=null;}
// Commands for one tab reach chrome.debugger in the order the relay sent
// them, although the group check before each one is asynchronous. Only the
// check and the dispatch are ordered; responses still complete in parallel.
function inTabOrder(tabId,step){
  const run=(commandOrder.get(tabId)??Promise.resolve()).then(step);
  const settled=run.then(()=>{},()=>{});commandOrder.set(tabId,settled);
  void settled.then(()=>{if(commandOrder.get(tabId)===settled)commandOrder.delete(tabId);});
  return run;
}
function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{void connect();},backoff);backoff=Math.min(backoff*2,30000);}
function send(obj,socket=ws){if(socket&&socket===ws&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(obj));}
async function detachTab(tabId){
  await attaching.get(tabId)?.catch(()=>{});
  if(attached.delete(tabId))await chrome.debugger.detach({tabId}).catch(()=>{});
}
async function detachAll(){await Promise.all([...new Set([...attached,...attaching.keys()])].map(detachTab));}

// ---------- tab group helpers ----------
async function ygGroupIds(windowId){
  const groups=await chrome.tabGroups.query(windowId!=null?{windowId}:{});
  return groups.filter(g=>g.title===settings.groupName).map(g=>g.id);
}
async function listTabs(){
  const tabs=await chrome.tabs.query({});
  const groupIdSet=new Set(await ygGroupIds());
  const group=tabs.filter(t=>groupIdSet.has(t.groupId)),groupIds=new Set(group.map(t=>t.id));
  // An opener is reported only when it is itself a group tab.
  return {totalTabs:tabs.length,tabs:group.map(t=>({tabId:t.id,url:t.url||'',title:t.title||'',windowId:t.windowId,groupId:t.groupId,active:!!t.active,inGroup:true,openerTabId:groupIds.has(t.openerTabId)?t.openerTabId:null}))};
}
async function requireGroupTab(tabId){
  const tab=await chrome.tabs.get(tabId);
  if(!(await ygGroupIds(tab.windowId)).includes(tab.groupId)){
    await detachTab(tabId);
    throw new Error('Tab is no longer in the YGPT group');
  }
  return tab;
}
async function attachTab(tabId){
  await requireGroupTab(tabId);
  if(attached.has(tabId))return;
  if(!attaching.has(tabId))attaching.set(tabId,chrome.debugger.attach({tabId},'1.3').then(()=>{attached.add(tabId);}).finally(()=>{attaching.delete(tabId);}));
  await attaching.get(tabId);
}
async function createGroupTab(url){
  // Only normal windows hold tab groups. A focused popup would otherwise get
  // the request, Chrome would open the tab in another window and grouping
  // into the popup would fail; group in the window the tab really landed in.
  const win=await chrome.windows.getLastFocused({windowTypes:['normal']}).catch(()=>null);
  const tab=await chrome.tabs.create({...(win?.id!=null?{windowId:win.id}:{}),url,active:false});
  const windowId=tab.windowId;
  try{
  const existing=await ygGroupIds(windowId);
  let groupId;
  if(existing.length){groupId=await chrome.tabs.group({groupId:existing[0],tabIds:[tab.id]});}
  else{
    groupId=await chrome.tabs.group({createProperties:{windowId},tabIds:[tab.id]});
    await chrome.tabGroups.update(groupId,{title:settings.groupName,color:'blue',collapsed:false});
  }
  return {tabId:tab.id,url:tab.url||url,title:tab.title||'',windowId:tab.windowId,groupId};
  }catch(e){await chrome.tabs.remove(tab.id).catch(()=>{});throw e;}
}

// ---------- service requests ----------
async function onRequest(raw,socket=ws){
  let msg;try{msg=JSON.parse(raw);}catch{return;}
  if(msg.type==='registered'&&msg.id===instanceId){clearTimeout(registrationTimer);wsState='registered';return;}
  if(msg.type!=='req')return;
  const reply=(ok,payload)=>send({type:'res',reqId:msg.reqId,ok,...(ok?{result:payload}:{error:String(payload?.message??payload)})},socket);
  try{
    const p=msg.params||{};
    if(p.groupName)settings.groupName=p.groupName;
    switch(msg.method){
      case 'ping':return reply(true,{});
      case 'tabs.list':return reply(true,await listTabs());
      case 'tabs.create':return reply(true,await createGroupTab(p.url||'about:blank'));
      case 'tabs.close':await requireGroupTab(p.tabId);await chrome.tabs.remove(p.tabId);return reply(true,{});
      case 'debugger.attach':{
        await attachTab(p.tabId);
        return reply(true,{});
      }
      case 'debugger.detach':{
        await detachTab(p.tabId);
        return reply(true,{});
      }
      case 'debugger.send':{
        const {sent}=await inTabOrder(p.tabId,async()=>{
          await attachTab(p.tabId);
          if(/^(?:Target|Browser)\./.test(p.method))throw new Error('Browser-wide commands must use the group relay');
          const sent=chrome.debugger.sendCommand({tabId:p.tabId},p.method,p.params||{});sent.catch(()=>{});
          return {sent};
        });
        return reply(true,(await sent)??{});
      }
      default:return reply(false,new Error('unknown method '+msg.method));
    }
  }catch(e){reply(false,e);}
}

// ---------- events towards the service ----------
let tabsChangedTimer=null;
function notifyTabsChanged(){
  clearTimeout(tabsChangedTimer);
  tabsChangedTimer=setTimeout(async()=>{
    for(const tabId of attached)await requireGroupTab(tabId).catch(()=>detachTab(tabId));
    send({type:'event',kind:'tabsChanged',totalTabs:await totalTabs()});
  },150);
}
chrome.tabs.onCreated.addListener(notifyTabsChanged);
chrome.tabs.onUpdated.addListener(notifyTabsChanged);
chrome.tabs.onRemoved.addListener(tabId=>{send({type:'event',kind:'tabRemoved',tabId});notifyTabsChanged();});
chrome.tabGroups.onCreated.addListener(notifyTabsChanged);
chrome.tabGroups.onRemoved.addListener(notifyTabsChanged);
chrome.tabGroups.onUpdated.addListener(notifyTabsChanged);
// Forward synchronously, in Chrome's order: an asynchronous check here would
// let a command's response overtake the events that preceded it. Only tabs
// attached through attachTab (group members when attached) produce events,
// and notifyTabsChanged detaches tabs that leave the group.
chrome.debugger.onEvent.addListener((source,method,params)=>{if(attached.has(source.tabId))send({type:'event',kind:'cdp',tabId:source.tabId,method,params});});
// Chrome ended a session itself (the owner pressed Cancel on the "started
// debugging this browser" bar, or the tab became undebuggable). The tab's
// CDP domains are gone with it, so the relay must end its sessions too
// instead of letting the next command silently attach a blank one.
chrome.debugger.onDetach.addListener((source,reason)=>{if(source.tabId!=null&&attached.delete(source.tabId))send({type:'event',kind:'detached',tabId:source.tabId,reason:String(reason??'')});});
chrome.alarms.create('ygpt-keepalive',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>{if(!ws)void connect();});
chrome.runtime.onInstalled.addListener(()=>{void loadSettings().then(connect);});
chrome.runtime.onStartup.addListener(()=>{void loadSettings().then(connect);});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(msg?.kind==='save-settings'){
    void (async()=>{
      // The popup never shows the saved token, so an empty field means "keep
      // the pairing" (e.g. only the port changed). Load first: a worker woken
      // by this message has not read storage yet.
      await loadSettings();
      const next={...DEFAULTS,...msg.settings};if(!next.token)next.token=settings.token;
      settings=next;await chrome.storage.local.set({ygptSettings:settings});
      clearTimeout(reconnectTimer);clearTimeout(registrationTimer);stopKeepalive();const old=ws;ws=null;try{old?.close();}catch{}await detachAll();await connect();respond({ok:true});
    })();
    return true;
  }
  if(msg?.kind==='status'){
    void (async()=>{await loadSettings();respond({state:wsState,profile:cachedProfile,profileLabel:profileLabel(),settings:{host:settings.host,port:settings.port,hasToken:!!settings.token,groupName:settings.groupName}});})();
    return true;
  }
  return false;
});
void loadSettings().then(connect);
