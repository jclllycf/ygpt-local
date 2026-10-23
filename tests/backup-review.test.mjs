import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';
register('./fixtures/config-hook.mjs',import.meta.url);
const {BackupManager,snapshotTargetAllowed}=await import('../runtime/backup-manager.mjs');
const fakeSealer={seal:s=>s,open:s=>s};

test('Protected snapshots honor exact review without widening concurrent operations',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-reviewed-backup-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const manager=new BackupManager({stateDir:dir,sealer:fakeSealer,git:null});
  // Nonexistent Windows-shaped targets exercise authorization on every host;
  // only snapshot manifests under this disposable state directory are written.
  const targets=['C:\\YGPT\\data\\state\\review-missing.txt','G:\\review-missing.txt','C:\\Users\\Example\\.ssh\\review-missing.txt'];
  for(const target of targets){
    assert.equal(snapshotTargetAllowed(target),false);
    assert.throws(()=>manager.create('review-fixture',[target]),/verified owner/);
  }
  let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const reviewed=manager.withReviewed(async()=>{
    await barrier;
    return targets.map(target=>manager.create('review-fixture',[target]));
  });
  assert.throws(()=>manager.create('unreviewed',[targets[0]]),/verified owner/);
  release();
  const receipts=await reviewed;
  assert.equal(receipts.length,3);
  for(const r of receipts)assert.equal(manager.verify(r.id),true);
  assert.throws(()=>manager.create('unreviewed',[targets[0]]),/verified owner/);
  const receipt=receipts[0];manager.finish(receipt.id,true);
  assert.throws(()=>manager.restore(receipt.id),/verified owner/);
  const restored=manager.restore(receipt.id,{reviewed:true});
  assert.equal(restored.restored,receipt.id);
  assert.equal(manager.manifest(restored.undoBackupId).status,'completed');
  assert.throws(()=>manager.create('unreviewed',[targets[0]]),/verified owner/);
});

test('Snapshots record the real letter case; canonical stays the comparison key',async t=>{
  const {canonical,resolvedPath}=await import('../runtime/access-policy.mjs');
  assert.equal(resolvedPath('C:\\Users\\Example\\Docs\\MyFile.md'),'C:\\Users\\Example\\Docs\\MyFile.md');
  assert.equal(canonical('C:\\Users\\Example\\Docs\\MyFile.md'),'c:\\users\\example\\docs\\myfile.md');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-case-backup-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const manager=new BackupManager({stateDir:dir,sealer:fakeSealer,git:null});
  // Restore and the Git checkpoint write these paths back; a lowercased path
  // would rename MyFile.md to myfile.md on NTFS. Duplicates still collapse.
  const receipt=manager.create('write_file',['C:\\Users\\Example\\Docs\\MyFile.md','c:\\users\\example\\docs\\myfile.md']);
  assert.deepEqual(manager.manifest(receipt.id).files.map(f=>f.path),['C:\\Users\\Example\\Docs\\MyFile.md']);
});

test('Trash plan: folder trees are snapshotted file by file; what the snapshot cannot hold is reported',async t=>{
  const {snapshotTree,trashPlan}=await import('../runtime/backup-manager.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-trash-plan-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const notes=path.join(root,'Notes');fs.mkdirSync(path.join(notes,'Sub','Empty'),{recursive:true});
  fs.writeFileSync(path.join(notes,'A.md'),'a');fs.writeFileSync(path.join(notes,'Sub','B.md'),'bb');
  const tree=snapshotTree(notes);
  assert.equal(tree.complete,true);assert.equal(tree.files,2);assert.equal(tree.bytes,3);
  assert.deepEqual(tree.paths.map(p=>path.relative(root,p)).sort(),['Notes','Notes/A.md','Notes/Sub','Notes/Sub/B.md','Notes/Sub/Empty'].map(p=>p.split('/').join(path.sep)).sort());
  assert.equal(snapshotTree(notes,{maxEntries:3}).complete,false);
  assert.match(snapshotTree(notes,{maxBytes:2}).reason,/larger than/);
  const linked=path.join(root,'Linked');fs.mkdirSync(linked);fs.symlinkSync(notes,path.join(linked,'to-notes'));
  assert.match(snapshotTree(linked).reason,/link/);
  const big=path.join(root,'Big.bin');fs.writeFileSync(big,'');fs.truncateSync(big,33*1024*1024); // sparse
  const small=path.join(root,'Small.txt');fs.writeFileSync(small,'x');
  const plan=trashPlan([notes,linked,big,small,path.join(root,'Missing.txt')],{resolve:p=>p});
  assert.deepEqual(plan.map(p=>[path.basename(p.path),p.kind,p.covered]),[['Notes','directory',true],['Linked','directory',false],['Big.bin','file',false],['Small.txt','file',true],['Missing.txt','absent',true]]);
  assert.equal(plan[0].snapshotPaths.length,5);assert.deepEqual(plan[1].snapshotPaths,[],'an uncovered folder adds no empty stand-in');
  assert.deepEqual(plan[3].snapshotPaths,[small]);
});

test('A single file too large for a snapshot asks a human instead of failing the delete',async t=>{
  const {authorize}=await import('../runtime/access-policy.mjs');
  const target='C:\\Users\\Example\\Videos\\Holiday.mp4',original=fs.lstatSync;
  t.mock.method(fs,'lstatSync',(p,...rest)=>String(p).toLowerCase()===target.toLowerCase()?{isSymbolicLink:()=>false,isFile:()=>true,isDirectory:()=>false,size:33*1024*1024,nlink:1}:original(p,...rest));
  const decision=authorize('y_file_trash',{paths:[target]});
  assert.equal(decision.decision,'approve');assert.match(decision.reason,/Recycle Bin/);
  assert.equal(authorize('y_file_trash',{paths:['C:\\Users\\Example\\Videos\\small-missing.txt']}).decision,'allow');
});

test('Windows: restoring a snapshot keeps the file name case',{skip:process.platform!=='win32'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-case-restore-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const manager=new BackupManager({stateDir:path.join(dir,'state'),sealer:fakeSealer,git:null});
  const file=path.join(dir,'Work','MyFile.md');fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,'before');
  const receipt=manager.create('y_file_trash',[path.dirname(file),file]);manager.verify(receipt.id);
  fs.rmSync(path.dirname(file),{recursive:true});manager.finish(receipt.id,true);
  manager.restore(receipt.id,{reviewed:true});
  assert.deepEqual(fs.readdirSync(dir).filter(n=>n!=='state'),['Work']);assert.deepEqual(fs.readdirSync(path.join(dir,'Work')),['MyFile.md']);
  assert.equal(fs.readFileSync(file,'utf8'),'before');
});
