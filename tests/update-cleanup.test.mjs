import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
function run(mode){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-housekeeping-'));try{fs.copyFileSync('build/YGPTLocal.exe',path.join(root,'YGPTLocal.exe'));const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319'),exe=path.join(root,'Fixture.exe');execFileSync(path.join(framework,'csc.exe'),['/nologo','/target:exe','/out:'+exe,'/reference:'+path.join(root,'YGPTLocal.exe'),path.resolve('tests/HousekeepingRegression.cs')],{windowsHide:true,stdio:'pipe'});return execFileSync(exe,[root,mode],{windowsHide:true,encoding:'utf8',timeout:60000});}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('Verified housekeeping retains one rollback, deletes surplus copies and preserves modified/private data',{skip:process.platform!=='win32'},()=>{assert.match(run('cache'),/HOUSEKEEPING_PASS/);});
test('Registration identity guards protect current/foreign installs; a new updater invalidates an old Complete receipt',{skip:process.platform!=='win32'},()=>{assert.match(run('registration'),/REGISTRATION_AND_DOWNLOAD_PASS/);});

test('Legacy download consent is kept for review and a new updater resumes cleanup',{skip:process.platform!=='win32'},()=>{assert.match(run('legacy-download'),/LEGACY_DOWNLOAD_SCOPE_PASS/);});
