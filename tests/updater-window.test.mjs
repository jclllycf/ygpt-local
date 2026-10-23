import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Compile only the production updater window and a disposable backend fixture.
// This does not build an installer, discover real installs, or start services.
test('Updater keeps one selected target, restores failed updates and survives multiple installs', {skip:process.platform!=='win32'}, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-update-window-'));
  try {
    fs.copyFileSync('assets/brand/plugin-icon-256.png',path.join(root,'fixture-icon.png'));
    const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319');
    const refs=['System.Xaml.dll','System.Web.Extensions.dll','Microsoft.CSharp.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(n=>path.join(framework,'WPF',n))];
    const exe=path.join(root,'UpdateWindowRegression.exe');
    execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/codepage:65001','/target:exe','/main:UpdateWindowRegression','/out:'+exe,...refs.map(n=>'/reference:'+n),path.resolve('setup/UpdateWindow.cs'),path.resolve('tests/UpdateWindowRegression.cs')],{windowsHide:true,stdio:'pipe'});
    const output=execFileSync(exe,[root],{windowsHide:true,timeout:30000,encoding:'utf8'});
    assert.match(output,/UPDATE_WINDOW_PASS/);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
