import {isolateVault} from './fixtures/vault-fs.mjs';
// Owner blacklist-model tests (portable): default allow, gates instead of
// refusals, snapshot-guaranteed deletes. Exercises the real file engine and
// the real access policy with a temp owner configuration. The policy speaks
// Windows paths on every platform, so its fixture uses Windows-style paths;
// the directory-delete tier additionally needs a real directory and is only
// exercised on Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YFileEngine} from '../engine/src/file-engine.mjs';

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-owner-model-'));
const fakeSnapshot=Object.assign(async()=>({id:'test-snapshot',durable:true}),{finish:()=>{}});

test('File engine: absolute paths work on any volume; relative paths stay inside the engine root',async()=>{
  const rootA=tmp(),rootB=tmp();
  const engine=await YFileEngine.create(rootA,{snapshot:fakeSnapshot});
  const outside=path.join(rootB,'AppData','Roaming','clash','config.yaml');
  fs.mkdirSync(path.dirname(outside),{recursive:true});
  const written=await engine.atomicWrite(outside,'port: 7890\n');
  // Windows runners may supply an 8.3 TEMP alias; the engine returns canonical paths.
  assert.equal(path.normalize(written.path).toLowerCase(),path.normalize(fs.realpathSync.native(outside)).toLowerCase());
  assert.equal((await engine.read(outside)).content,'port: 7890\n');
  // A relative path is confined to the engine root by definition.
  await assert.rejects(engine.atomicWrite('../escape.txt','x'),e=>e.code==='OUT_OF_SCOPE');
  const inside=await engine.atomicWrite('local.txt','ok');
  assert.equal(path.normalize(inside.path).toLowerCase(),path.normalize(fs.realpathSync.native(path.join(rootA,'local.txt'))).toLowerCase());
});

test('Access policy: trash tiers, downloads and document writes follow the owner model',async()=>{
  const {register}=await import('node:module');
  register('./fixtures/config-hook.mjs',import.meta.url);
  const {authorize,highRiskCommand}=await import('../runtime/access-policy.mjs');

  const loose='C:\\Users\\Example\\Desktop\\loose.txt';
  // Single ordinary file anywhere -> allowed by default (snapshot-guaranteed).
  assert.equal(authorize('y_file_trash',{paths:[loose]}).decision,'allow');
  // Batch delete -> human gate, never a refusal.
  assert.equal(authorize('y_file_trash',{paths:[loose,'C:\\Users\\Example\\Desktop\\second.txt']}).decision,'approve');
  // A system folder -> human gate (the owner asked for authorization, not refusal).
  assert.equal(authorize('y_file_trash',{paths:['C:\\Windows\\Temp\\old.log']}).decision,'approve');
  // YGPT's own state -> the one refused set.
  // rc.13: even YGPT's own state is never hard-refused — a human gate decides.
  assert.equal(authorize('y_file_trash',{paths:['C:\\YGPT\\data\\state\\ops.sqlite3']}).decision,'approve');
  // Document files are ordinary work now: writing one in a project is allowed.
  assert.equal(authorize('write_file',{path:'D:\\AI\\Projects\\report.docx',content:'x'}).decision,'allow');
  // A clean write outside every enrolled root (an app config on C:) is allowed
  // under the blacklist — the Clash Verge case.
  assert.equal(authorize('write_file',{path:'C:\\Users\\Example\\AppData\\Roaming\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\node.yaml',content:'y'}).decision,'allow');
  // A credential-adjacent write still gates.
  assert.equal(authorize('write_file',{path:'C:\\Users\\Example\\.ssh\\config',content:'y'}).decision,'approve');
  // Ordinary downloads outside project folders need no enrollment.
  assert.equal(authorize('y_download_file',{url:'https://example.com/f.zip',destination:loose}).decision,'allow');
  assert.equal(authorize('y_download_file',{url:'https://example.com/f.zip',destination:'D:\\AI\\Projects\\f.zip'}).decision,'allow');
  // Bulk-delete command shapes are high risk (human-gated upstream).
  assert.equal(highRiskCommand('Get-ChildItem -Recurse | Remove-Item'),true);
  assert.equal(highRiskCommand('Remove-Item .\\*.tmp'),true);
  assert.equal(highRiskCommand('Remove-Item .\\one.txt'),false);
});

test('Owner read policy: typed reads are automatic everywhere; writes and commands into state or the vault gate',async t=>{isolateVault(t);
  const {authorize}=await import('../runtime/access-policy.mjs');
  // Owner policy since the rc.2 baseline: no human decision for typed reads,
  // YGPT's own folders, credential-adjacent files and the vault included
  // (CHATGPT_PROBLEMS.md A.2 reports read approvals on the install folder as
  // a defect). A read-only fast path is never a write permission.
  const protectedPaths=['C:\\YGPT\\data\\state\\operations.sqlite3','C:\\YGPT\\data\\ygpt.config.json','C:\\YGPT\\install\\runtime\\config.mjs','G:\\vault\\notes.txt','C:\\Users\\Example\\.ssh\\id_ed25519','C:\\Users\\Example\\.env'];
  for(const target of protectedPaths){
    for(const tool of ['read_file','get_file_info','list_directory','start_search','y_verify_checksum','y_sqlite_read'])
      assert.equal(authorize(tool,{path:target,pattern:'hello',sql:'SELECT 1'}).decision,'allow',tool+' '+target);
    assert.equal(authorize('read_multiple_files',{paths:['D:\\work\\ordinary.txt',target]}).decision,'allow');
    assert.equal(authorize('write_file',{path:target,content:'x'}).decision,'approve','write '+target);
  }
  // A directory move must not conceal a protected descendant.
  assert.equal(authorize('move_file',{source:'C:\\YGPT',destination:'D:\\backup'}).decision,'approve');
  // Commands that are not parse-provably read-only and name state or the vault gate.
  const ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  for(const target of ['C:\\YGPT\\data\\state\\x.txt','G:\\vault\\x.txt'])
    assert.equal(authorize('job_submit',{cwd:'D:\\work',argv:[ps,'-NoProfile','-Command','Set-Content "'+target+'" y']}).decision,'approve',target);
});

test('Connector-state review is once-only; ordinary HTTPS downloads and reviewed destinations work',async t=>{isolateVault(t);
  const {reviewScope}=await import('../runtime/chat-review.mjs');
  const {validateSource,validateDestination,checksum}=await import('../runtime/safe-actions.mjs');
  // The live connector's own state never gets a conversation-wide grant.
  assert.equal(reviewScope('y_file_write',{path:'C:\\YGPT\\data\\state\\ops.sqlite3',content:'x'}).eligible,false);
  assert.equal(reviewScope('y_file_write',{path:'C:/YGPT/data/state/ops.sqlite3',content:'x'}).eligible,false,'forward slashes do not hide the state path');
  // An ordinary reviewed write may be granted for this exact action in this chat.
  assert.equal(reviewScope('y_file_write',{path:'C:\\Users\\Example\\.ssh\\config',content:'x'}).eligible,false,'credential names stay once-only');
  assert.equal(reviewScope('y_file_write',{path:'C:\\Windows\\Temp\\x.txt',content:'x'}).eligible,true);
  for(const target of ['G:\\vault\\notes.txt','C:\\YGPT\\data\\state\\ops.sqlite3']){
    assert.throws(()=>validateDestination(target),e=>e.code==='APPROVAL_REQUIRED');
    assert.equal(validateDestination(target,{reviewed:true}),target.toLowerCase());
  }
  assert.equal(validateSource('https://downloads.example.com/ordinary.zip').hostname,'downloads.example.com');
  assert.throws(()=>validateSource('https://user:secret@example.com/f'),/embedded credentials/);
  assert.equal(validateDestination('C:\\Users\\Example\\Downloads\\ordinary.zip'),'c:\\users\\example\\downloads\\ordinary.zip');
  // Checksums are reads: automatic, the vault included.
  const {Readable}=await import('node:stream');let reads=0;
  t.mock.method(fs,'createReadStream',()=>{reads++;return Readable.from([Buffer.from('approved')]);});
  assert.match((await checksum('G:\\vault\\notes.txt')).actual,/^[a-f0-9]{64}$/);
  assert.equal(reads,1);
});
