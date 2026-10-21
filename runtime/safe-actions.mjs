import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {config} from './config.mjs';
import {canonical,route,within,authorize} from './access-policy.mjs';
import {nativeWindows} from './windows-native.mjs';
export const downloadSources=[
  ['raw.githubusercontent.com','/pbatard/Fido/'],['github.com','/ventoy/Ventoy/releases/download/'],
  ['release-assets.githubusercontent.com','/'],['software.download.prss.microsoft.com','/'],['software-download.microsoft.com','/'],
];
export function validateSource(input){
  const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw Error('Only HTTPS downloads without embedded credentials are supported');
  const pathname=decodeURIComponent(u.pathname);if(pathname.includes('..')||pathname.includes('\\')||/%2f/i.test(u.pathname))throw Error('Ambiguous source path');
  if(!downloadSources.some(([host,prefix])=>u.hostname===host&&pathname.startsWith(prefix)))throw Error('Source is outside the fixed official download allowlist');
  return u;
}
export function validateDestination(destination){
  const p=route(destination);if(p.permission!=='project')throw Error('Download target must be an ordinary file in an owner-allowed project folder');
  if(fs.existsSync(destination)){const stat=fs.lstatSync(destination);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Refusing non-regular, linked or shared target');}
  return p.target;
}
export async function checksum(filename,expected){
  const decision=authorize('read_file',{path:filename});if(decision.decision!=='allow')throw Error('Checksum target is not an ordinary allowed project file');
  const hash=createHash('sha256');for await(const b of fs.createReadStream(filename))hash.update(b);
  const actual=hash.digest('hex');return {algorithm:'SHA-256',actual,match:expected?actual===expected.toLowerCase():null};
}
export function diskInspect(){
  return Promise.resolve().then(()=>nativeWindows('disk-inventory',{},15000));
}
export function deviceFingerprint(d){return createHash('sha256').update(JSON.stringify([d.number,d.serial,d.model,d.sizeBytes,d.partitions])).digest('hex');}
