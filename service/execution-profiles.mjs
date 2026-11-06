import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nativeWindows} from '../runtime/windows-native.mjs';

const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function plain(file){for(let p=path.resolve(file);;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('EXECUTION_PROFILE_LINK_REFUSED');if(p===path.dirname(p))break;}}
const alias=(source,target)=>fs.lstatSync(source).isSymbolicLink()&&same(fs.readlinkSync(source),target);

// Updater only: its existing owner/idle barrier must have stopped the engine.
// Same-volume renames preserve all bytes and existing application ACLs. Fixed
// junctions retain old absolute paths, including Bun and Windows cache links.
export function migrateExecutionProfiles(state){
 state=path.resolve(state);plain(state);
 const kinds=['home','engine-home'],plans=[];
 for(const kind of kinds){
  const source=path.join(state,kind);
  if(!fs.existsSync(source))continue;
  const target=nativeWindows('execution-home',{root:state,kind}).path;
  if(fs.lstatSync(source).isSymbolicLink()){
   if(!alias(source,target))throw Error('EXECUTION_PROFILE_LINK_REFUSED');
   continue;
  }
  const checkedSource=nativeWindows('execution-home-source',{root:state,kind}).path;
  if(!same(fs.realpathSync(checkedSource),fs.realpathSync(source)))throw Error('EXECUTION_PROFILE_SOURCE_CHANGED');
  if(fs.readdirSync(target).length)throw Error('EXECUTION_PROFILE_DESTINATION_NOT_EMPTY');
  plans.push({kind,source,target,moved:false,linked:false});
 }
 const receipt=path.join(state,'execution-profiles-migration.json');plain(receipt);
 try{
  for(const p of plans){
   plain(p.source);plain(p.target);
   if(fs.readdirSync(p.target).length)throw Error('EXECUTION_PROFILE_DESTINATION_CHANGED');
   fs.rmdirSync(p.target);fs.renameSync(p.source,p.target);p.moved=true;
   fs.symlinkSync(p.target,p.source,'junction');p.linked=true;
  }
  if(plans.length){const tmp=receipt+'.new-'+randomUUID();fs.writeFileSync(tmp,JSON.stringify({product:'YGPT Local',schema:1,migrated:plans.map(p=>p.kind),at:new Date().toISOString(),filesCopied:0,legacyPathsPreserved:true}),{flag:'wx',mode:0o600});fs.renameSync(tmp,receipt);}
  return {migrated:plans.map(p=>p.kind),legacyPathsPreserved:true};
 }catch(error){
  for(const p of [...plans].reverse())if(p.moved){
   if(p.linked){if(!alias(p.source,p.target))throw Error('EXECUTION_PROFILE_ROLLBACK_CONFLICT');fs.unlinkSync(p.source);}
   if(fs.existsSync(p.source))throw Error('EXECUTION_PROFILE_ROLLBACK_CONFLICT');
   fs.renameSync(p.target,p.source);
  }
  throw error;
 }
}
