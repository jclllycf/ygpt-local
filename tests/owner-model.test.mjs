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
  assert.equal(written.path,outside);
  assert.equal((await engine.read(outside)).content,'port: 7890\n');
  // A relative path is confined to the engine root by definition.
  await assert.rejects(engine.atomicWrite('../escape.txt','x'),e=>e.code==='OUT_OF_SCOPE');
  const inside=await engine.atomicWrite('local.txt','ok');
  assert.equal(inside.path,path.join(rootA,'local.txt'));
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
  assert.equal(authorize('y_file_trash',{paths:['C:\\YGPT\\data\\state\\ops.sqlite3']}).decision,'deny');
  // Document files are ordinary work now: writing one in a project is allowed.
  assert.equal(authorize('write_file',{path:'D:\\AI\\Projects\\report.docx',content:'x'}).decision,'allow');
  // A clean write outside every enrolled root (an app config on C:) is allowed
  // under the blacklist — the Clash Verge case.
  assert.equal(authorize('write_file',{path:'C:\\Users\\Example\\AppData\\Roaming\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\node.yaml',content:'y'}).decision,'allow');
  // A credential-adjacent write still gates.
  assert.equal(authorize('write_file',{path:'C:\\Users\\Example\\.ssh\\config',content:'y'}).decision,'approve');
  // Downloads outside project folders gate instead of refusing.
  assert.equal(authorize('y_download_file',{url:'https://example.com/f.zip',destination:loose}).decision,'approve');
  assert.equal(authorize('y_download_file',{url:'https://example.com/f.zip',destination:'D:\\AI\\Projects\\f.zip'}).decision,'allow');
  // Bulk-delete command shapes are high risk (human-gated upstream).
  assert.equal(highRiskCommand('Get-ChildItem -Recurse | Remove-Item'),true);
  assert.equal(highRiskCommand('Remove-Item .\\*.tmp'),true);
  assert.equal(highRiskCommand('Remove-Item .\\one.txt'),false);
});
