import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {YFileEngine,sha256} from '../engine/src/file-engine.mjs';
import {createEngine} from '../engine/src/engine.mjs';
const snapshot=Object.assign(async()=>({id:'fixture',durable:true}),{finish:()=>{}});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ygpt-integrity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('Exact edits preserve literal replacement metacharacters and UTF-8 BOM bytes',async t=>{
  const root=await fixture(t),file=await YFileEngine.create(root,{snapshot});
  const original='\uFEFFbefore TARGET after\r\n',replacement="$& $$ $` $'";
  await fs.writeFile(path.join(root,'edit.txt'),original);
  const result=await file.replaceExact('edit.txt','TARGET',replacement,{expectedSha256:sha256(original)});
  const expected='\uFEFFbefore '+replacement+' after\r\n';
  assert.equal(await fs.readFile(path.join(root,'edit.txt'),'utf8'),expected);
  assert.equal(result.sha256,sha256(expected));
});

test('Patch dry run and commit preserve BOM and report hashes of exact bytes',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'.ygpt-engine-fixture'),'YGPT disposable fixture\n');
  const engine=await createEngine({mode:'fixture',root,stateDir:path.join(root,'state')},{protectState:async()=>{}});
  t.after(()=>engine.close());
  const original='\uFEFFhello\r\n',expected='\uFEFF$&\r\n';
  await fs.writeFile(path.join(root,'patch.txt'),original);
  const request={path:'patch.txt',expectedSha256:sha256(original),hunks:[{oldText:'hello',newText:'$&'}]};
  const dry=await engine.invoke('y_file_patch',{...request,dryRun:true});
  assert.equal(dry.ok,true);assert.equal(dry.result.afterSha256,sha256(expected));
  assert.equal(await fs.readFile(path.join(root,'patch.txt'),'utf8'),original);
  const applied=await engine.invoke('y_file_patch',request);
  assert.equal(applied.ok,true);assert.equal(applied.result.afterSha256,sha256(expected));
  assert.equal(await fs.readFile(path.join(root,'patch.txt'),'utf8'),expected);
});

test('Atomic writes preserve an existing predictable temporary sibling',async t=>{
  const root=await fixture(t),file=await YFileEngine.create(root,{snapshot});
  const target=path.join(root,'write.txt'),sibling=target+'.'+process.pid+'.tmp';
  await fs.writeFile(target,'before');await fs.writeFile(sibling,'unrelated work');
  await file.atomicWrite(target,'after');
  assert.equal(await fs.readFile(target,'utf8'),'after');
  assert.equal(await fs.readFile(sibling,'utf8'),'unrelated work');
  assert.deepEqual((await fs.readdir(root)).sort(),[path.basename(target),path.basename(sibling)].sort());
});
