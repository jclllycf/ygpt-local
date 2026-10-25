import {spawn} from 'node:child_process';
import readline from 'node:readline';
export class BrokerClient{
 constructor({node=process.execPath,entry,config,cwd,trustGatewayMeta=false}){Object.assign(this,{node,entry,config,cwd,trustGatewayMeta});this.seq=0;this.pending=new Map();}
 // A bridge started from a process that YGPT itself launched would otherwise
 // inherit that bridge's state pointer; the explicit config decides instead.
 async start(){const inherited=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toUpperCase()!=='YGPT_STATE_DIR'));this.child=spawn(this.node,[this.entry],{cwd:this.cwd,env:{...inherited,YGPT_CONFIG:this.config,PYTHONDONTWRITEBYTECODE:'1',YGPT_TRUST_GATEWAY_META:this.trustGatewayMeta?'1':'0'},windowsHide:true,stdio:['pipe','pipe','pipe']});this.diagnostic='';this.child.stderr.on('data',()=>{this.diagnostic='Broker reported an error; inspect sanitized health.';});
 readline.createInterface({input:this.child.stdout}).on('line',s=>{let m;try{m=JSON.parse(s);}catch{return;}const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(Error(m.error.message),{code:m.error.code})):p.resolve(m.result);});
 this.child.once('exit',()=>{this.exited=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Broker disconnected. Query existing operation before retrying any write.'));}this.pending.clear();});
 try{this.info=await this.rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'YGPT Local supervisor',version:'1.0.13'}});this.notify('notifications/initialized');return this;}catch(e){await this.close();throw e;}}
 notify(method,params={}){this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');}
 rpc(method,params={},timeoutMs=60000){if(this.exited)return Promise.reject(Error('Broker is offline; no operation was replayed'));const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Request timed out. Check its status before retrying.'));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 call(name,args={}){return this.rpc('tools/call',{name,arguments:args});}
 async close(){if(!this.child||this.exited)return;this.child.stdin.end();await new Promise(resolve=>{this.child.once('exit',resolve);const t=setTimeout(()=>{if(!this.exited)this.child.kill();resolve();},5000);t.unref();});}
}
