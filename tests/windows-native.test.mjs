import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeWindows} from '../runtime/windows-native.mjs';
import {root} from './helpers.mjs';
// These tests may run alone, before the shared test fixture has created its directory.
const nativeTestRoot=path.join(path.dirname(root),'.ygpt-local-tests');
fs.mkdirSync(nativeTestRoot,{recursive:true});
test('Native Windows checks preserve read-only AST boundaries without executing submitted text',()=>{
 const yes=['Get-Content "D:\\Example\\read.txt" | Select-Object -First 2','Get-CimInstance Win32_Service | Where-Object {$_.State -eq "Running"} | ConvertTo-Json','Write-Output "Clear-Disk is text"','Get-Process | ForEach-Object { $_.Id }'];
 const no=['Remove-Item D:\\Example -Recurse','Get-Item D:\\Example > D:\\out.txt','$x=1; Get-Process','[IO.File]::WriteAllText("x","y")','Get-Process -OutVariable state','Get-Process | ForEach-Object Kill','& "Get-Process"','Get-Process; Start-Process powershell'];
 for(const command of yes)assert.equal(nativeWindows('command-readonly',{command}),true,command);
 for(const command of no)assert.equal(nativeWindows('command-readonly',{command}),false,command);
 assert.throws(()=>nativeWindows('arbitrary-command',{command:'echo untrusted'}),/UNSUPPORTED_ACTION/);
});
test('Native state ACL audit rejects a linked descendant and a drive root; never weakens private state',()=>{
 const dir=fs.mkdtempSync(path.join(nativeTestRoot,'native-')),state=path.join(dir,'state');
 assert.equal(nativeWindows('state-prepare',{root:state}).protected,true);fs.writeFileSync(path.join(state,'ordinary.txt'),'KEEP');assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 assert.throws(()=>nativeWindows('state-prepare',{root:path.parse(state).root}),/DRIVE_ROOT_REFUSED/);
 const target=path.join(dir,'outside');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'untouched.txt'),'UNTOUCHED');fs.symlinkSync(target,path.join(state,'link'),'junction');
 assert.throws(()=>nativeWindows('state-verify',{root:state}),/STATE_LINK_REFUSED/);assert.equal(fs.readFileSync(path.join(target,'untouched.txt'),'utf8'),'UNTOUCHED');
});
test('Native state audit permits only Bun package-cache junctions with their exact in-root target',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(nativeTestRoot,'bun-cache-')),state=path.join(dir,'state'),cache=path.join(state,'home','.bun','install','cache');
 const link=path.join(cache,'@scope','pkg','1.2.3@@@1'),target=path.join(cache,'@scope','pkg@1.2.3@@@1'),decoy=path.join(cache,'@scope','pkg@1.2.4@@@1');
 // Secure the state root BEFORE creating descendants so they inherit its private ACL.
 nativeWindows('state-prepare',{root:state});
 fs.mkdirSync(path.dirname(link),{recursive:true});fs.mkdirSync(target,{recursive:true});fs.mkdirSync(decoy,{recursive:true});fs.writeFileSync(path.join(target,'index.js'),'cache target');
 const plainLink=path.join(cache,'plain','2.0.0-beta+1@@@1'),plainTarget=path.join(cache,'plain@2.0.0-beta+1@@@1');
 fs.mkdirSync(path.dirname(plainLink),{recursive:true});fs.mkdirSync(plainTarget);
 fs.symlinkSync(target,link,'junction');fs.symlinkSync(plainTarget,plainLink,'junction');
 assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 fs.unlinkSync(link);fs.symlinkSync(decoy,link,'junction');
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>{assert.equal(e.code,'STATE_LINK_REFUSED');assert.equal(e.path,link);assert.equal(e.target,'\\??\\'+decoy);assert.ok(e.message.includes(link));return true;});
 fs.unlinkSync(link);fs.symlinkSync(target,link,'junction');
 execFileSync('icacls.exe',[target,'/grant','*S-1-1-0:(OI)(CI)R'],{windowsHide:true,stdio:'pipe'});
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>{assert.equal(e.code,'STATE_DESCENDANT_ACL_UNSAFE');assert.equal(e.path,target);return true;});
});
test('Native state audit diagnoses a linked state root before preparing any ACLs',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(nativeTestRoot,'linked-root-')),target=path.join(dir,'outside'),link=path.join(dir,'state');
 fs.mkdirSync(target);fs.writeFileSync(path.join(target,'sentinel.txt'),'KEEP');fs.symlinkSync(target,link,'junction');
 for(const action of ['state-prepare','state-verify'])assert.throws(()=>nativeWindows(action,{root:link}),e=>{
  assert.equal(e.code,'STATE_LINK_REFUSED');assert.equal(e.path,link);assert.equal(e.target,'\\??\\'+target);return true;
 });
 assert.equal(fs.readFileSync(path.join(target,'sentinel.txt'),'utf8'),'KEEP');
});

test('Numbered Chrome profiles permit only the owned network-service capability on isolated caches',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(nativeTestRoot,'chrome-profiles-')),state=path.join(dir,'state');
 const prepared=nativeWindows('state-prepare',{root:state});
 const chromeSid='S-1-15-3-1024-1653277547-598600573-1504598449-2187120098-1115546814-1860042162-2924348907-3700367812';
 const grant=(p,sid)=>execFileSync('icacls.exe',[p,'/grant','*'+sid+':(OI)(CI)M'],{windowsHide:true,stdio:'pipe'});
 for(const home of ['home','engine-home'])for(const profile of ['Default','Profile 1','Profile 12']){
  const cache=path.join(state,home,'AppData','Local','Google','Chrome','User Data',profile,'Cache');
  fs.mkdirSync(cache,{recursive:true});grant(cache,chromeSid);fs.mkdirSync(path.join(cache,'Cache_Data'));
 }
 // Elevated Windows CI can default newly created directories to the
 // Administrators owner. Model the actual owner-created Chrome caches;
 // do not weaken the product's owner check to accommodate the fixture.
 execFileSync('icacls.exe',[state,'/setowner','*'+prepared.ownerSid,'/T','/Q'],{windowsHide:true,stdio:'pipe'});
 assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 const forbidden=path.join(state,'home','AppData','Local','Google','Chrome','User Data','Profile 1','Credentials');
 fs.mkdirSync(forbidden);grant(forbidden,chromeSid);
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_DESCENDANT_ACL_UNSAFE'&&e.path===forbidden);
 fs.rmSync(forbidden,{recursive:true});
 const fake=path.join(state,'home','AppData','Local','Google','Chrome','User Data','Profile 1 extra','Cache');
 fs.mkdirSync(fake,{recursive:true});grant(fake,chromeSid);
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_DESCENDANT_ACL_UNSAFE'&&e.path===fake);
 fs.rmSync(path.dirname(fake),{recursive:true});
 const cache=path.join(state,'home','AppData','Local','Google','Chrome','User Data','Profile 1','Cache');grant(cache,'S-1-1-0');
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_DESCENDANT_ACL_UNSAFE'&&e.path===cache);
});
