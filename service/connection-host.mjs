import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {BrokerClient} from './rpc.mjs';
import {loadSecrets} from './secrets.mjs';
import {readConnectionProfiles,connectionRoot,connectionRevision,saveConnectionHealth} from './connections.mjs';
import {ConnectionRouter} from './connection-router.mjs';
import {nativeWindows} from '../runtime/windows-native.mjs';

export async function startConnectionHost({install,data,pipe,broker,readProfiles=readConnectionProfiles,readSecrets=loadSecrets,checkTunnel=id=>nativeWindows('tunnel-inventory',{id},15000),spawnTunnel=spawn,probeReady,intervalMs=3000}){
const entries=new Map();let closing=false,ticking=false;
const router=await new ConnectionRouter({pipe,broker,profile:id=>entries.get(id)}).start();
const quote=value=>'"'+value.replaceAll('\\','/').replaceAll('"','\\"')+'"';
const classify=text=>/invalid_api_key|key_expired|\b401\b|unauthorized/i.test(text)?'RUNTIME_KEY_INVALID_OR_EXPIRED':/\b403\b|forbidden|permission_denied/i.test(text)?'TUNNEL_PERMISSION_OR_WORKSPACE_DENIED':/\b429\b|rate.limit/i.test(text)?'OPENAI_TUNNEL_RATE_LIMITED':/certificate|x509/i.test(text)?'TUNNEL_TLS_OR_CERTIFICATE_ERROR':/timeout|unreachable|refused/i.test(text)?'TUNNEL_NETWORK_UNREACHABLE':null;
function health(e){
 let connected=false;try{const url=fs.readFileSync(path.join(e.root,'tunnel-health.url'),'utf8').trim(),u=new URL(url);if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.port)connected=url;}catch{}
 return connected;
}
async function ready(e){if(probeReady)return probeReady(e);const url=health(e);if(!url||!e.child||e.child.exitCode!==null)return false;try{const u=new URL(url);return (await fetch(u.origin+'/readyz',{signal:AbortSignal.timeout(1200)})).ok;}catch{return false;}}
async function canChange(){if([...router.active.values()].some(n=>n>0))return false;try{return (await broker.rpc('ygpt/idle',{},15000)).safeToStop===true;}catch{return false;}}
function launch(e){
 const inventory=checkTunnel(e.tunnelId);if(inventory.conflict||!inventory.processInventoryAvailable){e.error='TUNNEL_ALREADY_OWNED_OR_UNKNOWN';e.blocked=true;return;}
 const args=['run','--control-plane.tunnel-id',e.tunnelId,'--control-plane.api-key','env:YGPT_TUNNEL_RUNTIME_KEY','--mcp.command','command='+quote(process.execPath)+' '+quote(path.join(install,'service/tunnel-stdio.mjs')),'--mcp.stdio-send-initialized-notification','--health.listen-addr','127.0.0.1:0','--health.url-file',path.join(e.root,'tunnel-health.url')];
 const env={...process.env,YGPT_TUNNEL_RUNTIME_KEY:e.runtimeKey,YGPT_CONNECTION_PIPE:pipe,YGPT_CONNECTION_KEY:e.bridgeKey,YGPT_CONNECTION_ID:e.id};
 // No transport key or another account's runtime credential is inherited by
 // the shared engine or by delegated local processes.
 if(e.proxyUrl)env.HTTP_PROXY=env.HTTPS_PROXY=e.proxyUrl;
 e.error='';e.child=spawnTunnel(path.join(install,'runtimes/tunnel-client.exe'),args,{cwd:install,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const observe=chunk=>{const code=classify(String(chunk));if(code){e.error=code;if(['RUNTIME_KEY_INVALID_OR_EXPIRED','TUNNEL_PERMISSION_OR_WORKSPACE_DENIED'].includes(code))e.blocked=true;}};
 e.child.stdout.on('data',observe);e.child.stderr.on('data',observe);
 e.child.on('error',()=>{e.error='TUNNEL_START_FAILED';});
 e.child.once('exit',()=>{e.child=null;e.restarts++;e.retryAt=Date.now()+Math.min(120000,2000*2**Math.min(e.restarts,6));});
}
async function stop(e){e.stopping=true;if(e.child){const child=e.child;child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,3000).unref();});}e.stopping=false;}
async function tick(){
 if(ticking||closing)return;ticking=true;
 try{
  const profiles=readProfiles(data).filter(p=>p.mode==='secure-tunnel'),wanted=new Set(profiles.map(p=>p.id));
  for(const p of profiles){
   const root=connectionRoot(data,p.id),revision=connectionRevision(p,path.join(root,'credentials.dpapi'));let e=entries.get(p.id);
   if(e&&e.revision!==revision){
    if(!await canChange()){e.changePending=true;continue;}
    await stop(e);entries.delete(p.id);e=null;
   }
   if(!e){const secrets=readSecrets(root,install);if(typeof secrets.runtimeKey!=='string'||!secrets.runtimeKey||typeof (secrets.bridgeKey??secrets.localKey)!=='string')throw Error('Connection credential unavailable');
    e={...p,root,revision,runtimeKey:secrets.runtimeKey,bridgeKey:secrets.bridgeKey??secrets.localKey,restarts:0,retryAt:0,blocked:false};entries.set(p.id,e);
   }
   if(e.enabled&&!e.child&&!e.blocked&&Date.now()>=e.retryAt)launch(e);
  }
  for(const [id,e] of entries)if(!wanted.has(id)&&await canChange()){await stop(e);entries.delete(id);}
  const profilesHealth=await Promise.all([...entries.values()].map(async e=>({id:e.id,label:e.label,enabled:e.enabled,connected:await ready(e),phase:!e.enabled?'disabled':e.changePending?'waiting-for-idle':e.blocked?'needs-attention':e.child?'connecting':'reconnecting',restarts:e.restarts,lastError:e.error??'',changePending:e.changePending===true})));
  for(const h of profilesHealth)if(h.connected)h.phase='connected';
  saveConnectionHealth(path.join(data,'connections-health.json'),{product:'YGPT Local',profiles:profilesHealth,at:new Date().toISOString()});
 }catch{saveConnectionHealth(path.join(data,'connections-health.json'),{product:'YGPT Local',error:'CONNECTION_CONFIGURATION_NEEDS_REVIEW',at:new Date().toISOString()});}
 finally{ticking=false;}
}
async function shutdown(){if(closing)return;closing=true;clearInterval(timer);await Promise.allSettled([...entries.values()].map(stop));await router.close();await broker.close();}
const timer=setInterval(()=>void tick(),intervalMs);await tick();
broker.child.once('exit',()=>{void shutdown().finally(()=>{process.exitCode=1;});});
return {tick,close:shutdown,entries,router};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const install=fileURLToPath(new URL('..',import.meta.url)),data=path.resolve(process.argv[2]),pipe=process.env.YGPT_CONTROL_PIPE+'-connections';
 const broker=await new BrokerClient({entry:path.join(install,'runtime/bootstrap.mjs'),config:path.join(data,'ygpt.config.json'),cwd:install,trustConnectionMeta:true}).start({initialize:false});
 const host=await startConnectionHost({install,data,pipe,broker});
 process.once('SIGINT',()=>void host.close());process.once('SIGTERM',()=>void host.close());
}
