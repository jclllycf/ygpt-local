import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Setup manages additional accounts without copying the app or exposing saved credentials',{skip:process.platform!=='win32'},()=>{
 const base=path.resolve('build/.ygpt-local-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'accounts-'));
 fs.copyFileSync('build/YGPTLocal.exe',path.join(root,'YGPTLocal.exe'));
 const framework=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319');
 const refs=['System.Xaml.dll','System.Web.Extensions.dll',...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(n=>path.join(framework,'WPF',n))];
 const exe=path.join(root,'AccountFixture.exe');execFileSync(path.join(framework,'csc.exe'),['/nologo','/codepage:65001','/target:exe','/out:'+exe,'/reference:'+path.join(root,'YGPTLocal.exe'),...refs.map(n=>'/reference:'+n),path.resolve('tests/AccountConnectionsRegression.cs')],{windowsHide:true,stdio:'pipe'});
 const image=path.resolve('build/account-connections-setup.png');const output=execFileSync(exe,[root,image],{windowsHide:true,encoding:'utf8',timeout:30000});
 assert.match(output,/ACCOUNT_CONNECTIONS_PASS/);
 assert.ok(fs.existsSync(image));
});
