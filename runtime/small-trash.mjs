import fs from 'node:fs';
import path from 'node:path';
// Ordinary, recoverable cleanup only. Stop inspecting as soon as any bound
// or protected descendant is encountered; never follow a link.
export function smallTrash(paths,{route,projectRoots=[],maxEntries=64,maxBytes=16*1024*1024}={}){
 let entries=0,bytes=0;
 try{
  const visit=file=>{
   if(++entries>maxEntries)return false;
   const stat=fs.lstatSync(file),target=route(file);
   if(stat.isSymbolicLink()||target.system||target.sensitive||target.secretAdjacent||['private','vault'].includes(target.permission)||projectRoots.includes(target.target))return false;
   if(stat.isDirectory())return fs.readdirSync(file).every(name=>visit(path.join(file,name)));
   if(!stat.isFile()||stat.nlink!==1)return false;
   bytes+=stat.size;return bytes<=maxBytes;
  };
  return Array.isArray(paths)&&paths.length>0&&paths.length<=20&&paths.every(visit);
 }catch{return false;}
}
