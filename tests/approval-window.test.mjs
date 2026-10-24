import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Manual Windows approval center shows exact actions, preserves selection and confirms decisions',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-approval-window-'));
 try{
  const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319');
  const refs=['System.Xaml.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(n=>path.join(framework,'WPF',n))],exe=path.join(root,'ApprovalWindowRegression.exe');
  execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/codepage:65001','/target:exe','/main:ApprovalWindowRegression','/out:'+exe,...refs.map(n=>'/reference:'+n),path.resolve('setup/ApprovalWindow.cs'),path.resolve('tests/ApprovalWindowRegression.cs')],{windowsHide:true,stdio:'pipe'});
  assert.match(execFileSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:30000}),/APPROVAL_WINDOW_PASS/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
