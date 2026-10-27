import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {until} from './helpers.mjs';

for(const action of ['disconnect','stop'])test('Tunnel process is reclaimed after owner '+action+' without touching engine jobs',async()=>{
 const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
 const worker=spawn(process.execPath,[path.resolve('service/tunnel-worker.mjs'),process.execPath,'-e',"console.log(process.pid);setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let pid;const alive=p=>{try{process.kill(p,0);return true;}catch{return false;}};
 try{
  worker.stdout.once('data',b=>pid=Number(String(b).trim()));await until(()=>pid,10000);assert.ok(alive(pid));
  const exited=once(worker,'exit');if(action==='disconnect')worker.disconnect();else worker.send({action:'stop'});
  await Promise.race([exited,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Transport worker did not close')),10000);timer.unref();})]);
  await until(()=>!alive(pid),10000);assert.ok(alive(sentinel.pid),'Independent durable engine work must survive transport cleanup');
 }finally{if(worker.connected)worker.disconnect();if(pid&&alive(pid))process.kill(pid);if(worker.exitCode===null)worker.kill();sentinel.kill();}
});
