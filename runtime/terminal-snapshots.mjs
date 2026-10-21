import fs from 'node:fs';
import path from 'node:path';
import {snapshotTargetAllowed} from './backup-manager.mjs';
export function jobSnapshotTargets(cwd,extra=[]){
 const found=[],excluded={protected:0,linked:0,oversized:0,unreadable:0,limit:0};let bytes=0;
 const skip=/^(?:node_modules|\.git|\.venv|venv|dist|build|coverage|\.next|test-work)$/i;
 function eligible(p){try{return snapshotTargetAllowed(p);}catch{excluded.unreadable++;return false;}}
 function scan(dir,depth){
  if(!eligible(dir)){excluded.protected++;return;}
  const entries=fs.readdirSync(dir,{withFileTypes:true});
  for(const entry of entries){
   if(found.length>=80){excluded.limit++;break;}
   if(skip.test(entry.name))continue;
   if(entry.isSymbolicLink()){excluded.linked++;continue;}
   const p=path.join(dir,entry.name);
   if(!eligible(p)){excluded.protected++;continue;}
   if(entry.isDirectory()){if(depth<2)scan(p,depth+1);continue;}
   if(!entry.isFile()||entry.name.length>=160||! /\.(?:[cm]?js|tsx?|jsx|json|toml|ya?ml|py|ps1|cmd|bat|html|css|md|txt)$/i.test(entry.name))continue;
   const stat=fs.lstatSync(p);if(stat.nlink!==1){excluded.linked++;continue;}
   if(stat.size>8*1024*1024||bytes+stat.size>96*1024*1024){excluded.oversized++;continue;}
   bytes+=stat.size;found.push(p);
  }
 }
 scan(cwd,0);
 // Explicit mutation/download targets must still be validated by BackupManager;
 // never silently discard them to make a request appear protected.
 for(const target of extra)if(target&&!found.includes(target))found.unshift(target);
 const selected=found.slice(0,80);Object.defineProperty(selected,'excluded',{value:excluded});return selected;
}
