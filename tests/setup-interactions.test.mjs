import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function run(mode){
  fs.mkdirSync('build/.ygpt-local-tests',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('build/.ygpt-local-tests/setup-flow-'));
  try{
    fs.copyFileSync('build/YGPTLocal.exe',path.join(root,'YGPTLocal.exe'));
    const framework=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319'),exe=path.join(root,'Fixture.exe');
    const refs=['System.Xaml.dll','System.Web.Extensions.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(n=>path.join(framework,'WPF',n))];
    execFileSync(path.join(framework,'csc.exe'),['/nologo','/codepage:65001','/target:exe','/out:'+exe,'/reference:'+path.join(root,'YGPTLocal.exe'),...refs.map(n=>'/reference:'+n),path.resolve('tests/SetupInteractionsRegression.cs')],{windowsHide:true,stdio:'pipe'});
    return execFileSync(exe,[root,mode],{windowsHide:true,encoding:'utf8',timeout:70000});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('Clipboard contention, unsent draft, no-repeat installation and optional browser wizard',{skip:process.platform!=='win32'},()=>{assert.match(run('wizard'),/SETUP_INTERACTIONS_PASS wizard/);});
test('After-exit cleanup waits for the setup process, removes exact owned files and preserves private data',{skip:process.platform!=='win32'},()=>{assert.match(run('cleanup'),/SETUP_INTERACTIONS_PASS cleanup/);});

test('All five plugin-upload PNGs are 256 square, under 10 KB, separate from HD artwork',()=>{
  const rows=JSON.parse(fs.readFileSync('assets/plugin-icons/icons.json'));
  assert.equal(rows.length,5);
  for(const row of rows){const b=fs.readFileSync('assets/plugin-icons/'+row.file);assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),256);assert.equal(b.readUInt32BE(20),256);assert.ok(b.length<10000);assert.equal(b.length,row.bytes);}
  assert.deepEqual(fs.readFileSync('plugin/assets/logo.png'),fs.readFileSync('assets/plugin-icons/'+rows[0].file));
  const hd=fs.readFileSync('assets/brand/ygpt-local-512.png');assert.equal(hd.readUInt32BE(16),512);assert.ok(hd.length>10000);
});

test('Setup, health/protocol versions and the shortcut icon match the product release',()=>{
  const {version}=JSON.parse(fs.readFileSync('package.json'));
  for(const p of ['setup/HostCore.cs','runtime/config.mjs','runtime/startup-diagnostics.mjs','service/http-server.mjs','service/rpc.mjs','service/supervisor.mjs']){
    const text=fs.readFileSync(p,'utf8'),versions=[...text.matchAll(/\b(?:Version|version)\s*[:=]\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
    assert.ok(versions.length>0,p);assert.ok(versions.every(v=>v===version),p+' disagrees with package version');
  }
  assert.deepEqual(fs.readFileSync('assets/ygpt-'+version+'.ico'),fs.readFileSync('assets/brand/ygpt-local.ico'));
});
