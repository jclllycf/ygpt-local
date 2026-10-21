import net from 'node:net';
import {timingSafeEqual} from 'node:crypto';
export function startOwnerControl({pipe,key,status,drain}){
 if(!pipe||typeof key!=='string'||key.length<32)return null;
 const equal=v=>typeof v==='string'&&Buffer.byteLength(v)===Buffer.byteLength(key)&&timingSafeEqual(Buffer.from(v),Buffer.from(key));
 const server=net.createServer(socket=>{
  let text='';socket.setTimeout(5000,()=>socket.destroy());
  socket.on('data',async data=>{text+=data;if(Buffer.byteLength(text)>8192){socket.destroy();return;}if(!text.includes('\n'))return;socket.removeAllListeners('data');
   try{const q=JSON.parse(text.trim());if(!equal(q.key)){socket.end(JSON.stringify({ok:false,code:'UNAUTHORIZED'})+'\n');return;}
    const r=q.action==='status'?await status():q.action==='drain'?await drain():{ok:false,code:'UNSUPPORTED'};socket.end(JSON.stringify(r)+'\n');
   }catch{socket.end(JSON.stringify({ok:false,code:'CONTROL_UNAVAILABLE'})+'\n');}
  });
 });
 server.on('error',()=>{});server.listen({path:pipe,readableAll:false,writableAll:false});return server;
}
