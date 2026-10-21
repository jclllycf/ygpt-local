import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function firstUseRecorder({data,key,transport,clientName=()=>''}){
 if(!data||typeof key!=='string'||key.length<32)return ()=>{};
 return (name,args,result)=>{
  // Only the dedicated, authenticated transport calls this hook. Local health
  // probes, tool arguments and claimed client metadata cannot enable it.
  if(!['official-secure-tunnel','authenticated-oauth'].includes(transport)||!['y_file_read','y_local_read_file','yuki_file_read','yuki_local_read_file'].includes(name)||result?.isError)return;
  try{
   const unlinked=p=>{for(let a=path.resolve(p);;a=path.dirname(a)){if(fs.lstatSync(a).isSymbolicLink())return false;if(path.dirname(a)===a)return true;}};
   const p=path.join(data,'first-use-challenge.json');if(!unlinked(p))return;
   const c=JSON.parse(fs.readFileSync(p)),target=path.resolve(args.path??args.file_path??'');
   if(target.toLowerCase()!==path.resolve(c.path).toLowerCase()||!unlinked(target))return;
   const bytes=fs.readFileSync(target);if(sha(bytes)!==c.sha256||!JSON.stringify(result).includes(bytes.toString('utf8').trim()))return;
   const payload=JSON.stringify({version:1,generation:c.generation,challengeSha256:c.sha256,transport,clientName:String(clientName()).slice(0,64),tool:name,readSucceeded:true,at:new Date().toISOString(),identityAttestation:'authenticated transport; not physical-human identity'});
   const mac=createHmac('sha256',key).update(payload).digest('hex'),out=path.join(data,'first-use-proof.json');
   fs.writeFileSync(out+'.new',JSON.stringify({payload,mac}),{mode:0o600});fs.renameSync(out+'.new',out);
  }catch{/* Read completion must not fail because optional setup evidence failed. */}
 };
}
export function validateFirstUseProof(value,key,generation){
 try{if(typeof key!=='string'||key.length<32)return false;const wanted=createHmac('sha256',key).update(value.payload).digest('hex');if(typeof value.mac!=='string'||value.mac.length!==wanted.length||!timingSafeEqual(Buffer.from(value.mac),Buffer.from(wanted)))return false;const p=JSON.parse(value.payload);return p.generation===generation&&p.readSucceeded===true&&['official-secure-tunnel','authenticated-oauth'].includes(p.transport);}catch{return false;}
}
