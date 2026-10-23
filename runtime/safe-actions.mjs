import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {config} from './config.mjs';
import {canonical,route,within,authorize} from './access-policy.mjs';
import {nativeWindows} from './windows-native.mjs';
export function validateSource(input){
  const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw Error('Only HTTPS downloads without embedded credentials are supported');
  const pathname=decodeURIComponent(u.pathname);if(pathname.includes('..')||pathname.includes('\\')||/%2f/i.test(u.pathname))throw Error('Ambiguous source path');
  return u;
}
export function validateDestination(destination,{reviewed=false}={}){
  const p=route(destination),decision=authorize('write_file',{path:destination});
  if(decision.decision==='deny'||decision.decision!=='allow'&&!reviewed)throw Object.assign(Error('Download target requires verified human approval'),{code:'APPROVAL_REQUIRED',effectStarted:false});
  if(fs.existsSync(destination)){const stat=fs.lstatSync(destination);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Refusing non-regular, linked or shared target');}
  return p.target;
}
export async function checksum(filename,expected,{reviewed=false}={}){
  canonical(filename);
  const decision=authorize('read_file',{path:filename});if(decision.decision==='deny'||decision.decision!=='allow'&&!reviewed)throw Object.assign(Error('Checksum target requires verified human approval'),{code:'APPROVAL_REQUIRED',effectStarted:false});
  const hash=createHash('sha256');for await(const b of fs.createReadStream(filename))hash.update(b);
  const actual=hash.digest('hex');return {algorithm:'SHA-256',actual,match:expected?actual===expected.toLowerCase():null};
}
export function diskInspect(){
  return Promise.resolve().then(()=>nativeWindows('disk-inventory',{},15000));
}
export function deviceFingerprint(d){return createHash('sha256').update(JSON.stringify([d.number,d.serial,d.model,d.sizeBytes,d.partitions])).digest('hex');}
