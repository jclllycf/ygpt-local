import fs from 'node:fs';
import path from 'node:path';
const generated=/^(?:desktop|browser|browser-existing)-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.png$/i;
function directory(stateDir){const dir=path.resolve(stateDir,'artifacts');if(!fs.existsSync(dir))return dir;if(fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync.native(dir).toLowerCase()!==dir.toLowerCase())throw Error('SCREENSHOT_DIRECTORY_LINKED');return dir;}
function ownedFile(filename,dir){const full=path.resolve(filename);if(path.dirname(full).toLowerCase()!==dir.toLowerCase()||!generated.test(path.basename(full)))throw Error('SCREENSHOT_PATH_NOT_OWNED');const stat=fs.lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink())throw Error('SCREENSHOT_FILE_LINKED');return {full,stat};}
export function consumeScreenshot(artifact,stateDir){
 const dir=directory(stateDir),{full,stat}=ownedFile(artifact.path,dir);
 try{if(stat.size>4*1024*1024)throw Error('SCREENSHOT_TOO_LARGE: capture exceeded the 4 MiB inline limit');return {type:'image',mimeType:'image/png',data:fs.readFileSync(full).toString('base64')};}
 finally{fs.unlinkSync(full);delete artifact.path;artifact.temporary=true;artifact.localFileRemoved=true;artifact.storage='inline response only; image bytes are excluded from the local ledger';}
}
export function cleanupOldScreenshots(stateDir,{now=Date.now(),minAgeMs=3600000}={}){
 const result={removed:0,bytes:0,skipped:0};let dir;try{dir=directory(stateDir);}catch{return {...result,refused:true};}if(!fs.existsSync(dir))return result;
 for(const name of fs.readdirSync(dir)){if(!generated.test(name))continue;try{const {full,stat}=ownedFile(path.join(dir,name),dir);if(now-stat.mtimeMs<minAgeMs){result.skipped++;continue;}fs.unlinkSync(full);result.removed++;result.bytes+=stat.size;}catch{result.skipped++;}}
 return result;
}
export function withoutImageBytes(response){
 if(!response||typeof response!=='object')return response;
 const copy={...response};if(Array.isArray(copy.content))copy.content=copy.content.map(block=>block.type==='image'?{type:'text',text:'Temporary screenshot delivered inline. Image bytes are not retained in the local ledger.'}:block);return copy;
}
