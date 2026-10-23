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
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
  if(!settings.token){wsState='needs-token';return;}
  await loadSettings();
  const url='ws://'+settings.host+':'+settings.port+'/ext?token='+encodeURIComponent(settings.token);
  try{ws=new WebSocket(url);}catch{wsState='error';scheduleReconnect();return;}
  wsState='connecting';
  ws.onopen=async()=>{
    wsState='open';backoff=2000;
    const profile=await profileInfo();
    send({type:'hello',id:instanceId,browser:browserKind(),version:(navigator.userAgent.match(/(?:Chrome|Edg)\/([\d.]+)/)||[])[1]||'',profile,totalTabs:await totalTabs()});
  };
  ws.onmessage=ev=>{void onRequest(ev.data);};
  ws.onclose=()=>{wsState='closed';ws=null;attached.clear();scheduleReconnect();};
  ws.onerror=()=>{try{ws.close();}catch{}};
}
function scheduleReconnect(){setTimeout(()=>{void connect();},backoff);backoff=Math.min(backoff*2,30000);}
function send(obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}

// ---------- tab group helpers ----------
async function ygGroupIds(windowId){
  const groups=await chrome.tabGroups.query(windowId!=null?{windowId}:{});
  return groups.filter(g=>g.title===settings.groupName).map(g=>g.id);
}
async function listTabs(){
  const tabs=await chrome.tabs.query({});
  const groupIdSet=new Set(await ygGroupIds());
  return {totalTabs:tabs.length,tabs:tabs.map(t=>({tabId:t.id,url:t.url||'',title:t.title||'',windowId:t.windowId,groupId:t.groupId,active:!!t.active,inGroup:groupIdSet.has(t.groupId)}))};
}
async function createGroupTab(url){
  const win=await chrome.windows.getLastFocused().catch(()=>null);
  const windowId=win?.id;
  const tab=await chrome.tabs.create({windowId,url,active:false});
  const existing=await ygGroupIds(windowId);
  let groupId;
  if(existing.length){groupId=await chrome.tabs.group({groupId:existing[0],tabIds:[tab.id]});}
  else{
    groupId=await chrome.tabs.group({createProperties:{windowId},tabIds:[tab.id]});
    await chrome.tabGroups.update(groupId,{title:settings.groupName,color:'blue',collapsed:false});
  }
  return {tabId:tab.id,url:tab.url||url,title:tab.title||'',windowId:tab.windowId,groupId};
}

// ---------- service requests ----------
async function onRequest(raw){
  let msg;try{msg=JSON.parse(raw);}catch{return;}
  if(msg.type!=='req')return;
  const reply=(ok,payload)=>send({type:'res',reqId:msg.reqId,ok,...(ok?{result:payload}:{error:String(payload?.message??payload)})});
  try{
    const p=msg.params||{};
    if(p.groupName)settings.groupName=p.groupName;
    switch(msg.method){
      case 'ping':return reply(true,{});
      case 'tabs.list':return reply(true,await listTabs());
      case 'tabs.create':return reply(true,await createGroupTab(p.url||'about:blank'));
      case 'tabs.close':await chrome.tabs.remove(p.tabId);return reply(true,{});
      case 'debugger.attach':{
        if(!attached.has(p.tabId)){await chrome.debugger.attach({tabId:p.tabId},'1.3');attached.add(p.tabId);}
        return reply(true,{});
      }
      case 'debugger.detach':{
        if(attached.has(p.tabId)){await chrome.debugger.detach({tabId:p.tabId}).catch(()=>{});attached.delete(p.tabId);}
        return reply(true,{});
      }
      case 'debugger.send':{
        if(!attached.has(p.tabId)){await chrome.debugger.attach({tabId:p.tabId},'1.3');attached.add(p.tabId);}
        const result=await chrome.debugger.sendCommand({tabId:p.tabId},p.method,p.params||{});
        return reply(true,result??{});
      }
      default:return reply(false,new Error('unknown method '+msg.method));
    }
  }catch(e){reply(false,e);}
}

// ---------- events towards the service ----------
let tabsChangedTimer=null;
function notifyTabsChanged(){
  clearTimeout(tabsChangedTimer);
  tabsChangedTimer=setTimeout(async()=>{send({type:'event',kind:'tabsChanged',totalTabs:await totalTabs()});},150);
}
chrome.tabs.onCreated.addListener(notifyTabsChanged);
chrome.tabs.onUpdated.addListener(notifyTabsChanged);
chrome.tabs.onRemoved.addListener(tabId=>{send({type:'event',kind:'tabRemoved',tabId});notifyTabsChanged();});
chrome.tabGroups.onCreated.addListener(notifyTabsChanged);
chrome.tabGroups.onRemoved.addListener(notifyTabsChanged);
chrome.debugger.onEvent.addListener((source,method,params)=>{send({type:'event',kind:'cdp',tabId:source.tabId,method,params});});
chrome.debugger.onDetach.addListener(source=>{if(source.tabId!=null)attached.delete(source.tabId);});
chrome.alarms.create('ygpt-keepalive',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>{if(!ws)void connect();});
chrome.runtime.onInstalled.addListener(()=>{void loadSettings().then(connect);});
chrome.runtime.onStartup.addListener(()=>{void loadSettings().then(connect);});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(msg?.kind==='save-settings'){
    settings={...DEFAULTS,...msg.settings};
    void chrome.storage.local.set({ygptSettings:settings}).then(()=>{try{ws?.close();}catch{}ws=null;void connect();respond({ok:true});});
    return true;
  }
  if(msg?.kind==='status'){
    void (async()=>{const profile=await profileInfo();respond({state:wsState,profile,settings:{host:settings.host,port:settings.port,hasToken:!!settings.token,groupName:settings.groupName}});})();
    return true;
  }
  return false;
});
void loadSettings().then(connect);
