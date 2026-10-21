import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {fileURLToPath} from 'node:url';
import {config,RUNTIME} from './config.mjs';
import {validateSource,validateDestination} from './safe-actions.mjs';
export function publicAddress(ip){
  if(ip.includes(':'))return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip)&&!/^::ffff:/i.test(ip)&&!/^2001:(db8|2):/i.test(ip);
  const a=ip.split('.').map(Number);return a.length===4&&a.every(v=>Number.isInteger(v)&&v>=0&&v<=255)&&!(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&(a[1]===168||a[1]===0))||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===198&&(a[1]===18||a[1]===19)));
}
export async function requestOfficial(url){
  const u=validateSource(url);let options;
  if(config.downloadProxy){
    const proxy=new URL(config.downloadProxy);if(proxy.protocol!=='http:'||proxy.hostname!=='127.0.0.1'||!proxy.port||proxy.username||proxy.password)throw Error('Only an owner-configured loopback HTTP CONNECT proxy is allowed');
    // Trusted existing proxy resolves the fixed allowlisted external hostname.
    // Origin TLS remains verified. No system/client proxy settings are changed.
    options={agent:new HttpsProxyAgent(proxy,{timeout:30000}),rejectUnauthorized:true};
  }else{
    const addresses=await dns.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('Download source resolved to a private/reserved address; configure the existing local proxy if your DNS uses fake-IP');
    options={lookup:(_host,opts,cb)=>opts.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family)};
  }
  return new Promise((resolve,reject)=>{const req=https.get(u,{...options,headers:{'User-Agent':'YGPT-Local-PC/2.1'}},resolve);req.setTimeout(30000,()=>req.destroy(Error('Download connection stalled')));req.on('error',reject);});
}
export async function downloadToFile(a,{request=requestOfficial,progress=()=>{}}={}){
  validateSource(a.url);validateDestination(a.destination);let url=a.url,res;
  for(let i=0;i<=5;i++){
    res=await request(url);if([301,302,303,307,308].includes(res.statusCode)){
      const next=new URL(res.headers.location,url);validateSource(next.href);res.resume();url=next.href;if(i===5)throw Error('Too many redirects');continue;
    }break;
  }
  if(res.statusCode!==200){res.resume();throw Error('Download HTTP status '+res.statusCode);}
  const maximum=a.maxBytes??10737418240;if(Number(res.headers['content-length']??0)>maximum){res.destroy();throw Error('Download exceeds size limit');}
  fs.mkdirSync(path.dirname(a.destination),{recursive:true});validateDestination(a.destination);
  const temp=path.join(path.dirname(a.destination),'.ygpt-download-'+randomUUID()+'.part');
  const file=await fs.promises.open(temp,'wx');const hash=createHash('sha256');let bytes=0;
  try{
    for await(const chunk of res){bytes+=chunk.length;if(bytes>maximum)throw Error('Download exceeds size limit');hash.update(chunk);await file.writeFile(chunk);progress({state:'downloading',bytes});}
    await file.sync();await file.close();const sha256=hash.digest('hex');
    if(a.sha256&&sha256!==a.sha256.toLowerCase())throw Error('SHA-256 mismatch; original file preserved');
    validateDestination(a.destination);fs.renameSync(temp,a.destination);progress({state:'succeeded',bytes,sha256});return {bytes,sha256,executed:false};
  }catch(e){await file.close().catch(()=>{});res.destroy();try{fs.unlinkSync(temp)}catch{};throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const descriptor=process.argv[2];if(!/^download-[\da-f-]+\.dpapi$/.test(path.basename(descriptor??''))||path.dirname(path.resolve(descriptor))!==path.join(config.stateDir,'jobs'))throw Error('Invalid protected download descriptor');
  const a=JSON.parse(execFileSync(config.python,[...config.pythonArgs,path.join(RUNTIME,'secure_store.py')],{input:JSON.stringify({action:'unprotect',value:fs.readFileSync(descriptor,'utf8')}),encoding:'utf8',windowsHide:true}));
  const status=descriptor+'.status.json';let last=0;
  const progress=s=>{if(s.state!=='downloading'||Date.now()-last>1000){last=Date.now();const temp=status+'.tmp';fs.writeFileSync(temp,JSON.stringify(s));fs.renameSync(temp,status);}};
  try{console.log(JSON.stringify(await downloadToFile(a,{progress})));}catch(e){progress({state:'failed',error:e.message});console.error(e.message);process.exitCode=1;}
}
