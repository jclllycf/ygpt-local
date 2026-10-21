import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
