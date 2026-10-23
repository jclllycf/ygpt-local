import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeWindows} from '../runtime/windows-native.mjs';
import {root} from './helpers.mjs';
test('Native Windows checks preserve read-only AST boundaries without executing submitted text',()=>{
 const yes=['Get-Content "D:\\Example\\read.txt" | Select-Object -First 2','Get-CimInstance Win32_Service | Where-Object {$_.State -eq "Running"} | ConvertTo-Json','Write-Output "Clear-Disk is text"','Get-Process | ForEach-Object { $_.Id }'];
 const no=['Remove-Item D:\\Example -Recurse','Get-Item D:\\Example > D:\\out.txt','$x=1; Get-Process','[IO.File]::WriteAllText("x","y")','Get-Process -OutVariable state','Get-Process | ForEach-Object Kill','& "Get-Process"','Get-Process; Start-Process powershell'];
 for(const command of yes)assert.equal(nativeWindows('command-readonly',{command}),true,command);
 for(const command of no)assert.equal(nativeWindows('command-readonly',{command}),false,command);
 assert.throws(()=>nativeWindows('arbitrary-command',{command:'echo untrusted'}),/UNSUPPORTED_ACTION/);
});
test('Native state ACL audit rejects a linked descendant and a drive root; never weakens private state',()=>{
 const dir=fs.mkdtempSync(path.join(path.dirname(root),'.ygpt-local-tests','native-')),state=path.join(dir,'state');
 assert.equal(nativeWindows('state-prepare',{root:state}).protected,true);fs.writeFileSync(path.join(state,'ordinary.txt'),'KEEP');assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 assert.throws(()=>nativeWindows('state-prepare',{root:path.parse(state).root}),/DRIVE_ROOT_REFUSED/);
 const target=path.join(dir,'outside');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'untouched.txt'),'UNTOUCHED');fs.symlinkSync(target,path.join(state,'link'),'junction');
 assert.throws(()=>nativeWindows('state-verify',{root:state}),/STATE_LINK_REFUSED/);assert.equal(fs.readFileSync(path.join(target,'untouched.txt'),'utf8'),'UNTOUCHED');
});
test('Native state audit permits only Bun package-cache junctions with their exact in-root target',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(path.dirname(root),'.ygpt-local-tests','bun-cache-')),state=path.join(dir,'state'),cache=path.join(state,'home','.bun','install','cache');
 const link=path.join(cache,'@scope','pkg','1.2.3@@@1'),target=path.join(cache,'@scope','pkg@1.2.3@@@1'),decoy=path.join(cache,'@scope','pkg@1.2.4@@@1');
 fs.mkdirSync(path.dirname(link),{recursive:true});fs.mkdirSync(target,{recursive:true});fs.mkdirSync(decoy,{recursive:true});fs.writeFileSync(path.join(target,'index.js'),'cache target');
 const plainLink=path.join(cache,'plain','2.0.0-beta+1@@@1'),plainTarget=path.join(cache,'plain@2.0.0-beta+1@@@1');
 fs.mkdirSync(path.dirname(plainLink),{recursive:true});fs.mkdirSync(plainTarget);
 nativeWindows('state-prepare',{root:state});fs.symlinkSync(target,link,'junction');fs.symlinkSync(plainTarget,plainLink,'junction');
 assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 fs.unlinkSync(link);fs.symlinkSync(decoy,link,'junction');
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>{assert.equal(e.code,'STATE_LINK_REFUSED');assert.equal(e.path,link);assert.equal(e.target,'\\??\\'+decoy);assert.ok(e.message.includes(link));return true;});
 fs.unlinkSync(link);fs.symlinkSync(target,link,'junction');
 execFileSync('icacls.exe',[target,'/grant','*S-1-1-0:(OI)(CI)R'],{windowsHide:true,stdio:'pipe'});
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>{assert.equal(e.code,'STATE_DESCENDANT_ACL_UNSAFE');assert.equal(e.path,target);return true;});
});
test('Native state audit diagnoses a linked state root before preparing any ACLs',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(path.dirname(root),'.ygpt-local-tests','linked-root-')),target=path.join(dir,'outside'),link=path.join(dir,'state');
 fs.mkdirSync(target);fs.writeFileSync(path.join(target,'sentinel.txt'),'KEEP');fs.symlinkSync(target,link,'junction');
 for(const action of ['state-prepare','state-verify'])assert.throws(()=>nativeWindows(action,{root:link}),e=>{
  assert.equal(e.code,'STATE_LINK_REFUSED');assert.equal(e.path,link);assert.equal(e.target,'\\??\\'+target);return true;
 });
 assert.equal(fs.readFileSync(path.join(target,'sentinel.txt'),'utf8'),'KEEP');
});
