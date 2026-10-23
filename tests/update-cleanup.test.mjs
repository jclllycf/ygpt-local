import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source pins for the owner's post-update housekeeping (2026-10-23): retained
// program copies live INSIDE the application folder, and a health-verified
// update removes retained copies from both the in-folder location and the
// legacy sibling locations. The WPF behaviour itself is exercised by the
// Windows-only updater fixture; these pins keep the safety shape — identity
// gate before any delete, verified-live precondition — from regressing.
const updater = fs.readFileSync('setup/UpdateWindow.cs', 'utf8');
const app = fs.readFileSync('setup/YGPTLocal.cs', 'utf8');
const flat = s => s.replace(/\s+/g, ' ');

test('Updater sweeps retained backups only after a verified update, identity-gated', () => {
  const u = flat(updater);
  assert.ok(u.includes('List<string> CleanupUpdateBackups(string target)'), 'cleanup method exists');
  assert.ok(u.includes('Directory.GetDirectories(full,".previous-*")'), 'sweeps in-folder retained copies');
  assert.ok(u.includes('Directory.GetDirectories(parent,name+".previous-*")'), 'sweeps legacy sibling copies');
  assert.ok(u.includes('Directory.GetDirectories(parent,name+".staging-*")'), 'sweeps stale staging siblings');
  assert.ok(u.includes('FileAttributes.ReparsePoint'), 'never deletes through a reparse point');
  assert.ok(u.includes('bool IsYGPTProgramCopy(string dir)'), 'identity gate exists');
  assert.ok(u.includes('HostCore.S(YGPTApp.Read(manifest),"product")=="YGPT Local"'), 'manifest product gate');
  assert.ok(u.includes('HostCore.S(YGPTApp.Read(marker),"product")=="YGPT Local"'), 'install marker product gate');
  const gateAt = u.indexOf('if(!IsYGPTProgramCopy(candidate))continue;');
  const deleteAt = u.indexOf('Directory.Delete(candidate,true)');
  assert.ok(gateAt >= 0 && deleteAt > gateAt, 'identity gate runs before any delete');
  const liveAt = u.indexOf('if(live){');
  const callAt = u.indexOf('CleanupUpdateBackups(targetInstall)');
  assert.ok(liveAt >= 0 && callAt > liveAt, 'cleanup runs only once the update is verified live');
});

test('Install payload moves the retained copy inside the application folder', () => {
  const a = flat(app);
  assert.ok(a.includes('MoveDirectoryWithRetry(previous,Path.Combine(install,".previous-"+previousTicks))'),
    'retained copy is renamed into <install>/.previous-<ticks>, not left beside the install');
});
