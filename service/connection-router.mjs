import net from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import readline from 'node:readline';

const METHODS=new Set(['initialize','ping','tools/list','tools/call','resources/list','resources/templates/list','resources/read']);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>=32&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
// The transport supplies this identity. Caller metadata is overwritten, never
// interpreted as an account identity. One broker also means one desktop queue
// and one browser relay, while capabilities remain bound to their connection.
export class ConnectionRouter {
 constructor({pipe,broker,profile}){Object.assign(this,{pipe,broker,profile});this.active=new Map();this.sockets=new Set();}
 async start(){
  this.server=net.createServer(socket=>{
   this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));socket.on('error',()=>{});
   let buffered='';
   socket.on('data',chunk=>{
    buffered+=chunk;if(Buffer.byteLength(buffered)>262144){socket.destroy();return;}
    let index;while((index=buffered.indexOf('\n'))!==-1){const line=buffered.slice(0,index);buffered=buffered.slice(index+1);void this.receive(socket,line);}
   });
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen({path:this.pipe,readableAll:false,writableAll:false},resolve);});return this;
 }
 async receive(socket,line){
  let q;try{q=JSON.parse(line);}catch{socket.destroy();return;}
  const p=this.profile(q.connectionId),m=q.request;
  const reply=value=>{if(!socket.destroyed)socket.write(JSON.stringify({jsonrpc:'2.0',id:m?.id??null,...value})+'\n');};
  if(!p?.enabled||p.stopping||!equal(q.key,p.bridgeKey)){reply({error:{code:-32001,message:'Connection unavailable or unauthorized; no operation was replayed'}});return;}
  if(!m||m.jsonrpc!=='2.0'||!METHODS.has(m.method)&&!['notifications/initialized','notifications/cancelled','notifications/progress'].includes(m.method)){reply({error:{code:-32601,message:'Unsupported MCP method'}});return;}
  // Per-transport notifications never initialize or close another account.
  if(m.id===undefined)return;
  this.active.set(p.id,(this.active.get(p.id)??0)+1);
  try{
   const params={...m.params,_meta:{...m.params?._meta,'ygpt/connection-id':p.id}};
   const result=await this.broker.rpc(m.method,params,7*60*1000);reply({result});
  }catch{reply({error:{code:-32001,message:'Local service interrupted. Inspect the existing operation before retrying; no command was replayed.'}});}
  finally{this.active.set(p.id,this.active.get(p.id)-1);}
 }
 async close(){for(const s of this.sockets)s.destroy();await new Promise(r=>this.server.close(r));}
}

// Each tunnel's stdio adapter uses a single authenticated private pipe. A pipe
// disconnect exits the adapter; it must never reconnect and replay a mutation.
export async function proxyConnection({pipe,key,connectionId,input=process.stdin,output=process.stdout}){
 const socket=net.connect(pipe);await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',j);});
 const pending=new Set();let buffered='';
 const reader=readline.createInterface({input});
 const closed=new Promise(resolve=>socket.once('close',resolve));
 socket.on('error',()=>{});
 reader.on('line',line=>{
  let request;try{if(Buffer.byteLength(line)>131072)throw Error();request=JSON.parse(line);}catch{output.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Malformed MCP request'}})+'\n');return;}
  if(request.id!==undefined)pending.add(request.id);
  socket.write(JSON.stringify({key,connectionId,request})+'\n');
 });
 socket.on('data',chunk=>{
  buffered+=chunk;if(Buffer.byteLength(buffered)>32*1024*1024){socket.destroy();return;}
  let index;while((index=buffered.indexOf('\n'))!==-1){const line=buffered.slice(0,index);buffered=buffered.slice(index+1);try{const r=JSON.parse(line);pending.delete(r.id);output.write(line+'\n');}catch{socket.destroy();return;}}
 });
 reader.once('close',()=>socket.end());await closed;reader.close();
 for(const id of pending)output.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32001,message:'Connection closed; execution may be in progress. Recover existing status; do not replay.'}})+'\n');
}
