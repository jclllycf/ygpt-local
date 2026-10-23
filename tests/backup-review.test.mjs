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
