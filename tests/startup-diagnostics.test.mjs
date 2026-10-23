import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {nativeWindows} from '../runtime/windows-native.mjs';

test('Native state refusal preserves the error code, offending path and reparse target',t=>{
  const refused={ok:false,code:'STATE_LINK_REFUSED',path:'D:\\YGPT state\\home\\.bun\\install\\cache\\pkg\\1.2.3@@@1',target:'\\??\\D:\\outside'};
  t.mock.method(childProcess,'spawnSync',()=>({status:1,stdout:JSON.stringify(refused)}));syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  assert.throws(()=>nativeWindows('state-verify',{root:'D:\\YGPT state'}),e=>{
    assert.equal(e.code,refused.code);assert.equal(e.path,refused.path);assert.equal(e.target,refused.target);
    assert.ok(e.message.includes(refused.path));assert.ok(e.message.includes(refused.target));return true;
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('A real bootstrap audit failure reaches service health before any MCP port or response exists',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-startup-health-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const config=path.join(dir,'ygpt.config.json'),diagnostic=path.join(dir,'startup.json');fs.writeFileSync(config,JSON.stringify({startupDiagnostics:diagnostic}));
  const result=spawnSync(process.execPath,['--import',path.resolve('tests/fixtures/startup-failure-hook.mjs'),'runtime/bootstrap.mjs'],{env:{...process.env,YGPT_CONFIG:config,YGPT_SETUP_DATA_DIR:dir},encoding:'utf8',timeout:15000});
  assert.equal(result.status,1,result.stderr);assert.equal(result.stdout,'','failure must not be MCP stdout');
  const report=JSON.parse(fs.readFileSync(diagnostic,'utf8'));
  assert.equal(report.code,'STATE_LINK_REFUSED');assert.equal(report.path,'D:\\YGPT state\\link');assert.equal(report.target,'\\??\\D:\\wrong');
  assert.ok(!JSON.stringify(report).includes('private-fixture-secret'));
  const health=JSON.parse(fs.readFileSync(path.join(dir,'service-health.json'),'utf8'));
  assert.equal(health.localReady,false);assert.equal(health.lastError,report.code);assert.deepEqual(health.startupFailure,report);
});

test('A successful retry clears startup failure health and diagnostics stay bounded and scrubbed',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-startup-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const script=`import {recordStartupFailure,clearStartupFailure} from './runtime/startup-diagnostics.mjs';
    recordStartupFailure(Object.assign(Error('Bearer private-fixture-secret '+ 'x'.repeat(10000)),{code:'bad-code-with-secret',path:'D:\\\\state\\\\bad'}));
    clearStartupFailure();`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,YGPT_SETUP_DATA_DIR:dir},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stderr);
  assert.equal(report.code,'STARTUP_FAILED');assert.ok(report.message.length<=2000);assert.ok(!report.message.includes('private-fixture-secret'));
  const health=JSON.parse(fs.readFileSync(path.join(dir,'service-health.json'),'utf8'));
  assert.equal(health.localReady,true);assert.equal(health.startupFailure,null);assert.equal(health.lastError,'');
});

test('Watchdog projects current startup refusal details and ignores old failures after recovery',{skip:process.platform!=='win32'},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-watchdog-startup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319');
  const refs=['System.Web.Extensions.dll','System.Security.dll','System.Management.dll','Microsoft.CSharp.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll'];
  const exe=path.join(dir,'WatchdogStartupRegression.exe');
  childProcess.execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/target:exe','/main:WatchdogStartupRegression','/out:'+exe,...refs.map(n=>'/reference:'+n),path.resolve('setup/HostCore.cs'),path.resolve('setup/Watchdog.cs'),path.resolve('tests/WatchdogStartupRegression.cs')],{windowsHide:true,stdio:'pipe'});
  assert.match(childProcess.execFileSync(exe,[dir],{windowsHide:true,encoding:'utf8',timeout:15000}),/WATCHDOG_STARTUP_PASS/);
});
