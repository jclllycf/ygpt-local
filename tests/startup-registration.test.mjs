import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fixture} from './helpers.mjs';

test('Actual Windows startup repairs a missing owned task, recovers periodically and refuses missing binaries or foreign tasks',{skip:process.platform!=='win32'},()=>{
 const f=fixture(),framework=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319'),exe=path.join(f.dir,'StartupRegistrationFixture.exe');
 const refs=['System.Web.Extensions.dll','System.Security.dll','System.Management.dll','Microsoft.CSharp.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll'];
 execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/target:exe','/out:'+exe,...refs.map(n=>'/reference:'+n),path.resolve('setup/HostCore.cs'),path.resolve('tests/StartupRegistrationRegression.cs')],{windowsHide:true,stdio:'pipe'});
 const output=execFileSync(exe,[f.dir],{windowsHide:true,encoding:'utf8',timeout:45000});assert.match(output,/STARTUP_REGISTRATION_PASS/);
 if(process.env.YGPT_TEST_SCHEDULER_RUN==='1')assert.match(output,/STARTUP_SCHEDULER_RUN_PASS/);
 assert.equal(fs.existsSync(path.join(f.dir,'data','connection.json')),true);
});
