import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {YTerminalEngine} from '../engine/src/terminal-engine.mjs';
import {DurableJobs} from '../engine/src/durable-jobs.mjs';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-process-review-')),owners=new AsyncLocalStorage();
  const terminal=new YTerminalEngine({root,allowedExecutables:[process.execPath],currentOwner:()=>owners.getStore()??'owner'});
  t.after(async()=>{await terminal.close();await fs.rm(root,{recursive:true,force:true});});
  return {terminal,root,owners};
}
const long={executable:process.execPath,args:['-e','setTimeout(()=>{},60000)'],timeoutMs:60000};

test('Parallel process starts reserve per-chat and global capacity before awaiting',async t=>{
  const {terminal,owners}=await fixture(t);
  const first=await Promise.allSettled(Array.from({length:7},()=>owners.run('a',()=>terminal.start(long))));
  assert.equal(first.filter(r=>r.status==='fulfilled').length,4);
  for(const r of first.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'CONCURRENCY_LIMIT');
  const rest=await Promise.allSettled(Array.from({length:8},(_,i)=>owners.run(i%2?'b':'c',()=>terminal.start(long))));
  assert.equal(rest.filter(r=>r.status==='fulfilled').length,4);
  for(const r of rest.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'CONCURRENCY_LIMIT');
  assert.equal(terminal.sessions.size,8);
});

test('Closing while a start is validating prevents a later child launch',async t=>{
  const {terminal}=await fixture(t),validate=terminal.validate.bind(terminal);
  let release;const barrier=new Promise(resolve=>{release=resolve;});
  terminal.validate=async input=>{await barrier;return validate(input);};
  const pending=terminal.start(long);const rejected=assert.rejects(pending,e=>e.code==='ENGINE_CLOSED');
  await terminal.close();release();await rejected;
  assert.equal(terminal.sessions.size,0);assert.equal(terminal.starting.size,0);
});

test('Polling small pages returns every buffered stdout/stderr character',async t=>{
  const {terminal}=await fixture(t);
  const result=await terminal.run({executable:process.execPath,args:['-e','process.stdout.write("abcdefghij");process.stderr.write("1234567")']});
  let offset=0,out='',err='';
  for(let i=0;i<10;i++){
    const page=terminal.poll(result.sessionId,{offset,limit:3});out+=page.stdout;err+=page.stderr;
    if(page.nextOffset===offset)break;
    assert.ok(page.nextOffset<=offset+3);offset=page.nextOffset;
  }
  assert.equal(out,'abcdefghij');assert.equal(err,'1234567');
});

test('Non-interactive run closes stdin while an interactive session accepts later input',async t=>{
 const {terminal}=await fixture(t),args=['-e',"let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>console.log('EOF:'+s));"];
 const completed=await terminal.run({executable:process.execPath,args,timeoutMs:5000});
 assert.equal(completed.state,'succeeded');assert.equal(completed.stdout.trim(),'EOF:');
 const session=await terminal.start({executable:process.execPath,args,timeoutMs:5000});assert.equal(session.state,'running');
 await terminal.input(session.sessionId,'fixture input',{end:true});await terminal.get(session.sessionId).done;
 assert.equal(terminal.poll(session.sessionId).stdout.trim(),'EOF:fixture input');
});

test('Durable worker receives the exact validated cwd outside the engine root',async t=>{
  const {terminal,root}=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-job-outside-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  const script='let input="";process.stdin.on("data",b=>input+=b);process.stdin.on("end",()=>{const r=JSON.parse(input);console.log(JSON.stringify({cwd:r.cwd,roots:JSON.parse(process.env.YGPT_PROJECT_ROOTS)}));});';
  const jobs=new DurableJobs({terminal,stateDir:path.join(root,'state'),python:process.execPath,pythonArgs:['-e',script]});
  const result=await jobs.submit({id:'00000000-0000-4000-8000-000000000000',executable:process.execPath,cwd:outside});
  assert.equal(result.cwd,await fs.realpath(outside));assert.deepEqual(result.roots,[result.cwd]);
});
