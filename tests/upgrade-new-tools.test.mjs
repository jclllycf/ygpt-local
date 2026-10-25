// Portable tests for the P1-C tools (y_file_read_many, y_file_patch,
// y_project_inspect), the retired-name map and the usage/ownership data
// layer. Real modules, temporary directories, Linux and Windows.
// NOT a ChatGPT host test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createEngine} from '../engine/src/engine.mjs';
import {DurableLedger} from '../runtime/durable.mjs';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-newtools-'));
const fakeVault={seal:v=>'test:'+Buffer.from(String(v)).toString('base64'),open:v=>Buffer.from(v.slice(5),'base64').toString('utf8')};
const sha=s=>createHash('sha256').update(s).digest('hex');
async function fixtureEngine(extra={}) {
  const dir=tmp(),root=path.join(dir,'root');fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,'.ygpt-engine-fixture'),'YGPT disposable fixture\n');
  const engine=await createEngine({mode:'fixture',root,stateDir:path.join(dir,'state'),...extra},{protectState:async()=>{}});
  return {dir,root,engine};
}

test('y_file_read_many: typed batch read with per-file SHA and partial failure',async()=>{
  const {engine}=await fixtureEngine();
  try{
    await engine.invoke('y_file_write',{path:'a.txt',content:'alpha\nbeta\n'});
    await engine.invoke('y_file_write',{path:'b.txt',content:'gamma\n'});
    const r=await engine.invoke('y_file_read_many',{paths:['a.txt','missing.txt','b.txt']});
    assert.equal(r.ok,true);
    assert.equal(r.result.succeeded,2);assert.equal(r.result.failed,1);
    const [a,missing,b]=r.result.files;
    assert.equal(a.ok,true);assert.equal(a.sha256,sha('alpha\nbeta\n'));assert.match(a.content,/alpha/);
    assert.equal(missing.ok,false);assert.ok(missing.error.code);
    assert.equal(b.ok,true);assert.equal(b.sha256,sha('gamma\n'));
    const names=engine.tools().map(t=>t.name);
    for(const n of ['y_file_read_many','y_file_patch','y_project_inspect'])assert.ok(names.includes(n),n);
  }finally{await engine.close();}
});

test('y_file_patch: dry-run previews, apply is guarded by expectedSha256 and snapshot-backed',async()=>{
  const {engine,root}=await fixtureEngine();
  try{
    await engine.invoke('y_file_write',{path:'doc.txt',content:'hello world\nhello moon\n'});
    const before=sha('hello world\nhello moon\n');
    const dry=await engine.invoke('y_file_patch',{path:'doc.txt',expectedSha256:before,hunks:[{oldText:'hello',newText:'goodbye',count:2}],dryRun:true});
    assert.equal(dry.ok,true);assert.equal(dry.result.dryRun,true);
    assert.equal(dry.result.afterSha256,sha('goodbye world\ngoodbye moon\n'));
    assert.equal(fs.readFileSync(path.join(root,'doc.txt'),'utf8'),'hello world\nhello moon\n','dry run must not write');
    const applied=await engine.invoke('y_file_patch',{path:'doc.txt',expectedSha256:before,hunks:[{oldText:'hello',newText:'goodbye',count:2}]});
    assert.equal(applied.ok,true);assert.equal(applied.result.afterSha256,sha('goodbye world\ngoodbye moon\n'));
    assert.ok(applied.result.snapshotId,'a pre-write snapshot id is returned');
    assert.equal(fs.readFileSync(path.join(root,'doc.txt'),'utf8'),'goodbye world\ngoodbye moon\n');
    const stale=await engine.invoke('y_file_patch',{path:'doc.txt',expectedSha256:before,hunks:[{oldText:'moon',newText:'sun'}]});
    assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_PREIMAGE');
    const missing=await engine.invoke('y_file_patch',{path:'doc.txt',expectedSha256:sha('goodbye world\ngoodbye moon\n'),hunks:[{oldText:'not present',newText:'x'}]});
    assert.equal(missing.ok,false);assert.equal(missing.error.code,'PATCH_NOT_FOUND');
  }finally{await engine.close();}
});

test('y_project_inspect: bounded structure, manifests and read-only Git state',async()=>{
  const git='/usr/bin/git';
  const {engine,root}=await fixtureEngine({allowedExecutables:[git]});
  try{
    fs.mkdirSync(path.join(root,'src'));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'demo',scripts:{build:'x',test:'y'}}));
    fs.writeFileSync(path.join(root,'src','index.mjs'),'export {};\n');
    if(spawnSync(git,['--version']).status===0){
      spawnSync(git,['-C',root,'init','-q']);
      spawnSync(git,['-C',root,'-c','user.email=t@t','-c','user.name=t','add','.']);
      spawnSync(git,['-C',root,'-c','user.email=t@t','-c','user.name=t','commit','-qm','one']);
    }
    const r=await engine.invoke('y_project_inspect',{path:'.'});
    assert.equal(r.ok,true);
    assert.ok(r.result.entries.some(e=>e.path==='src'&&e.type==='directory'));
    assert.ok(r.result.entries.some(e=>e.path==='src/index.mjs'));
    assert.deepEqual(r.result.manifests['package.json'].scripts,['build','test']);
    if(r.result.git){assert.equal(r.result.git.dirtyLines,0);assert.equal(r.result.git.recentCommits.length,1);}
  }finally{await engine.close();}
});

test('usage rows and ownership views back y_usage_report / y_resource_owner',()=>{
  const dir=tmp(),ledger=new DurableLedger(path.join(dir,'ops.sqlite3'),{owner:'test-owner',vault:fakeVault});
  try{
    const ctxA=ledger.context(),ctxB=ledger.context();
    const id=ledger.callStart('y_file_read',null,{context:ctxA.hash,transport:'official-secure-tunnel'});
    ledger.callFinish(id,'succeeded',{ok:true});
    const id2=ledger.callStart('y_file_patch',null,{context:ctxB.hash,transport:'authenticated-oauth'});
    ledger.callFinish(id2,'failed',{structuredContent:{code:'STALE_PREIMAGE'}});
    const rows=ledger.usageRows(Date.now()-60000);
    assert.equal(rows.length,2);
    assert.equal(rows.find(r=>r.name==='y_file_patch').error_code,'STALE_PREIMAGE');
    assert.ok(rows.every(r=>r.context_label&&r.transport));
    ledger.own('job','job-1',ctxA.hash,'demo');
    assert.equal(ledger.resourcesOf(ctxA.hash).length,1);
    assert.equal(ledger.resourcesOf(ctxB.hash).length,0);
    assert.deepEqual(ledger.foreignCounts(ctxB.hash),{job:1});
  }finally{ledger.close();}
});
