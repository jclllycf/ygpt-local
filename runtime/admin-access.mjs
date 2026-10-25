import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
const error=(code,message)=>Object.assign(Error(message??code),{code,effectStarted:false});
export function verifyAdminHelper(install){
 const root=path.resolve(install),exe=path.join(root,'runtime/YGPTAdmin.exe');
 for(let p=exe;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw error('ADMIN_HELPER_CHANGED');if(p===path.dirname(p))break;}
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),entry=manifest.files.find(f=>f.path==='runtime/YGPTAdmin.exe'),bytes=fs.readFileSync(exe);
 if(manifest.product!=='YGPT Local'||!entry||entry.bytes!==bytes.length||entry.sha256!==createHash('sha256').update(bytes).digest('hex'))throw error('ADMIN_HELPER_CHANGED','Repair the installation before requesting Administrator access.');return exe;
}
export function launchAdminHelper(exe,expiresAt){
 // Obtain the exact Node creation time through the fixed native probe, not a
 // model argument or a rounded wall-clock estimate.
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const probe=spawnSync(ps,['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+process.pid+').StartTime.ToUniversalTime().Ticks'],{encoding:'utf8',windowsHide:true,timeout:5000});const birth=probe.stdout?.trim();if(probe.status!==0||!/^\d{15,20}$/.test(birth))throw error('ADMIN_PARENT_IDENTITY_UNAVAILABLE');
 const child=spawn(exe,['--launch'],{windowsHide:true,stdio:['pipe','pipe','ignore']});return adminProcessChannel(child,{parentPid:process.pid,parentBirth:birth,expiresAt});
}
export function adminProcessChannel(child,initial){let sequence=0,ready=false,closed=false;const pending=new Map();
 const stop=()=>{if(closed)return;closed=true;child.stdin.end();child.kill();for(const [id,p] of pending){clearTimeout(p.timer);p.reject(id===0?error('ADMIN_CHANNEL_CLOSED'):Object.assign(error('ADMIN_CHANNEL_CLOSED','Administrator command connection closed without a definitive result; inspect effects before retrying.'),{effectStarted:true,outcomeUnknown:true}));}pending.clear();};
 const initialization=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(0);reject(error('ADMIN_UAC_TIMEOUT'));stop();},100000);pending.set(0,{resolve,reject,timer});});
 readline.createInterface({input:child.stdout}).on('line',line=>{if(Buffer.byteLength(line)>524288){stop();return;}let v;try{v=JSON.parse(line);}catch{stop();return;}const id=ready?v.id:0,p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);if(!ready){if(!v.ok||!v.elevated){stop();p.reject(error(v.code??'ADMIN_ELEVATION_NOT_CONFIRMED'));return;}ready=true;}p.resolve(v);});
 child.once('error',e=>{const p=pending.get(0);if(p){pending.delete(0);clearTimeout(p.timer);p.reject(error('ADMIN_HELPER_START_FAILED',e.message));}stop();});child.once('exit',()=>{stop();});
 child.stdin.on('error',()=>stop());
 child.stdin.write(JSON.stringify(initial)+'\n');
 return {initialization,stop,get closed(){return closed;},request:args=>new Promise((resolve,reject)=>{if(closed||!ready)return reject(error('ADMIN_NOT_ACTIVE'));const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(error('ADMIN_RESPONSE_UNCERTAIN'),{effectStarted:true,outcomeUnknown:true}));stop();},(args.timeoutMs??25000)+5000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,...args})+'\n');})};
}
export class AdministratorAccess {
 constructor({install,getGrant,launch=launchAdminHelper,verify=verifyAdminHelper}){Object.assign(this,{install,getGrant,launch,verify});this.sessions=new Map();this.last=new Map();}
 status(hash){const s=this.sessions.get(hash);if(s&&(!this.getGrant(hash)||Date.now()>=s.expires||s.worker.closed)){this.stop(hash);return {active:false,state:'expired-or-disconnected'};}return s?{active:s.ready,state:s.ready?'active':'waiting-for-windows-uac',expiresAt:new Date(s.expires).toISOString(),scope:'this-chat',tool:'y_admin_run'}:this.last.get(hash)??{active:false,state:'not-enabled'};}
 async start(hash){this.stop(hash);const grant=this.getGrant(hash);if(!grant)throw error('ADMIN_FULL_ACCESS_REQUIRED');if(this.sessions.size>=2)throw error('ADMIN_SESSION_LIMIT');const exe=this.verify(this.install),worker=this.launch(exe,new Date(grant.expires).toISOString()),s={worker,expires:grant.expires,ready:false,busy:false};this.sessions.set(hash,s);s.timer=setInterval(()=>this.status(hash),250);s.timer.unref();try{await worker.initialization;if(this.sessions.get(hash)!==s||!this.getGrant(hash))throw error('ADMIN_GRANT_REVOKED');s.ready=true;return this.status(hash);}catch(e){if(this.sessions.get(hash)!==s){clearInterval(s.timer);worker.stop();return {active:false,state:'superseded'};}this.stop(hash);const value={active:false,state:e.code==='UAC_CANCELLED'?'uac-cancelled':'unavailable',code:e.code??'ADMIN_UNAVAILABLE'};this.last.set(hash,value);return value;}}
 stop(hash){const s=this.sessions.get(hash);if(s){this.sessions.delete(hash);clearInterval(s.timer);s.worker.stop();}this.last.delete(hash);return !!s;}
 stopAll(){for(const hash of this.sessions.keys())this.stop(hash);}
 async run(hash,args){if(!this.getGrant(hash)||!this.status(hash).active)throw error('ADMIN_NOT_ACTIVE','Request Full Access with administrator=true, confirm the chat card and Windows UAC first.');const s=this.sessions.get(hash);if(s.busy)throw error('ADMIN_COMMAND_BUSY');s.busy=true;try{return await s.worker.request(args);}finally{s.busy=false;}}
}
