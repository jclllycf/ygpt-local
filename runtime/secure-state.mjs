import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {config,RUNTIME,cleanEnv} from './config.mjs';
import {nativeWindows} from './windows-native.mjs';
export function prepareState(root=config.stateDir){
  const acl=nativeWindows('state-prepare',{root});
  for(const rel of ['tmp','jobs','engine-home','engine-home/AppData/Roaming','engine-home/AppData/Local'])fs.mkdirSync(path.join(root,rel),{recursive:true});
  return acl;
}
export function vault(root=config.stateDir){
  const key=Buffer.from(execFileSync(config.python,[...config.pythonArgs,path.join(RUNTIME,'secure_store.py')],{
    input:JSON.stringify({action:'key',root}),encoding:'utf8',windowsHide:true,timeout:30000
  }).trim(),'base64');
  if(key.length!==32)throw Error('Invalid protected data key');
  return {
    seal(value){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);return 'aesgcm:'+Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');},
    open(value){if(!value.startsWith('aesgcm:'))throw Error('Unencrypted legacy ledger rejected');const b=Buffer.from(value.slice(7),'base64');const cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}
  };
}
export function protectForWindows(value){
  return execFileSync(config.python,[...config.pythonArgs,path.join(RUNTIME,'secure_store.py')],{
    input:JSON.stringify({action:'protect',value}),encoding:'utf8',windowsHide:true,timeout:10000
  });
}
export function verifyState(root=config.stateDir){
  return nativeWindows('state-verify',{root},25000);
}
export function acquireLease(){
  const lock=path.join(config.stateDir,'bridge.lock');
  const identity=pid=>JSON.parse(execFileSync(config.python,[...config.pythonArgs,path.join(RUNTIME,'y_jobs.py')],{input:JSON.stringify({action:'identity',pid}),env:cleanEnv(),encoding:'utf8',windowsHide:true,timeout:15000})).identity;
  const mine={pid:process.pid,identity:identity(process.pid)};
  if(!mine.identity)throw Error('Cannot verify bridge process identity');
  if(fs.existsSync(lock)){
    const old=JSON.parse(fs.readFileSync(lock,'utf8'));
    if(identity(old.pid)===old.identity)throw Error('A bridge already owns this state; second instance refused');
    // Serialize stale-lease recovery. If a recovery itself crashes, require
    // human inspection instead of blindly stealing the directory.
    const recovery=path.join(config.stateDir,'lease-recovery.lock');const guard=fs.openSync(recovery,'wx');
    try{const actual=JSON.parse(fs.readFileSync(lock,'utf8'));if(identity(actual.pid)===actual.identity)throw Error('Live bridge lease changed');fs.unlinkSync(lock);}
    finally{fs.closeSync(guard);fs.unlinkSync(recovery);}
  }
  if(fs.existsSync(path.join(config.stateDir,'lease-recovery.lock')))throw Error('State lease recovery is in progress; retry after inspection');
  const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify(mine));
  return ()=>{fs.closeSync(fd);try{if(JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock);}catch{}};
}
