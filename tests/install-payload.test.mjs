import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Compile a disposable console fixture against the production payload code.
// No installer is built, and no credentials, services or registration are used.
test('Payload validation cleans staging and writes ownership before replacing the installed directory', {skip:process.platform!=='win32'}, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-payload-'));
  try {
    const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319');
    const refs=['System.Xaml.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.Security.dll','System.Management.dll','Microsoft.CSharp.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(n=>path.join(framework,'WPF',n))];
    const exe=path.join(root,'InstallPayloadRegression.exe');
    execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/codepage:65001','/target:exe','/main:InstallPayloadRegression','/out:'+exe,...refs.map(n=>'/reference:'+n),path.resolve('setup/HostCore.cs'),path.resolve('setup/YGPTLocal.cs'),path.resolve('setup/SetupInteractions.cs'),path.resolve('tests/InstallPayloadRegression.cs')],{windowsHide:true,stdio:'pipe'});
    const output=execFileSync(exe,[root],{windowsHide:true,timeout:15000,encoding:'utf8'});
    assert.match(output,/INSTALL_PAYLOAD_PASS/);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
