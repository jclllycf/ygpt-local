import fs from 'node:fs';
import path from 'node:path';
export async function tunnelHealth(data,mode){
 if(mode==='local-only')return {mode,configured:false,connected:false,reason:'No remote connection selected'};
 if(mode!=='secure-tunnel')return {mode,configured:true,connected:null,reason:'Verify the public hostname and OAuth discovery from a remote client'};
 try{const file=path.join(data,'tunnel-health.url');if(fs.lstatSync(file).isSymbolicLink())throw Error();const url=new URL(fs.readFileSync(file,'utf8').trim());if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash)throw Error();url.pathname='/readyz';const r=await fetch(url,{signal:AbortSignal.timeout(1500),redirect:'error'});await r.body?.cancel();return {mode,configured:true,connected:r.status===200,readyzStatus:r.status,source:'official-tunnel-client-loopback-readyz',notProofOfChatGPTCall:true};}catch{return {mode,configured:true,connected:false,reason:'Official tunnel client readiness not available'};}
}
