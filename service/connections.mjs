import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const PRIMARY_CONNECTION='primary';
export const MAX_CONNECTIONS=8;
export const connectionId=id=>id==='primary'||/^[a-f0-9]{32}$/.test(id);
export function plainConnectionPath(file){
 for(let p=path.resolve(file);;p=path.dirname(p)){
  if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Linked connection state refused');
  if(p===path.dirname(p))break;
 }
 return file;
}
export function connectionRoot(data,id){
 if(!connectionId(id))throw Error('Invalid connection identity');
 return plainConnectionPath(id==='primary'?data:path.join(data,'connections',id));
}
export function readConnectionProfiles(data){
 const read=file=>JSON.parse(fs.readFileSync(plainConnectionPath(file),'utf8').replace(/^\uFEFF/,''));
 const primary=read(path.join(data,'connection.json'));
 const file=path.join(data,'connections.json');
 const saved=fs.existsSync(file)?read(file):{product:'YGPT Local',connections:[]};
 if(saved.product!=='YGPT Local'||!Array.isArray(saved.connections)||saved.connections.length>=MAX_CONNECTIONS)throw Error('Invalid account connections');
 const profiles=[{...primary,id:'primary',label:'Default account',enabled:true},...saved.connections];
 const ids=new Set(),tunnels=new Set();
 for(const p of profiles){
  if(!connectionId(p.id)||ids.has(p.id)||typeof p.label!=='string'||!p.label.trim()||p.label.length>60||/[\x00-\x1f]/.test(p.label)||typeof p.enabled!=='boolean')throw Error('Invalid connection configuration');
  if(p.mode!=='secure-tunnel'&&p.id!=='primary')throw Error('Additional accounts require Secure MCP Tunnel');
  if(p.mode==='secure-tunnel'){
   if(!/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(p.tunnelId??'')||tunnels.has(p.tunnelId))throw Error('Each account needs a distinct complete Tunnel ID');
   tunnels.add(p.tunnelId);
  }
  if(p.proxyUrl){const u=new URL(p.proxyUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)throw Error('Invalid connection proxy');}
  ids.add(p.id);connectionRoot(data,p.id);
 }
 return profiles;
}
export function connectionRevision(profile,secretsFile){
 const hash=createHash('sha256').update(JSON.stringify(profile));
 hash.update(fs.readFileSync(plainConnectionPath(secretsFile)));return hash.digest('hex');
}
export function saveConnectionHealth(file,value){
 plainConnectionPath(file);const temp=file+'.new';plainConnectionPath(temp);
 fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);
}
