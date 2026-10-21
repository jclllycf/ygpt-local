import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const framework=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319'),csc=path.join(framework,'csc.exe');fs.mkdirSync('engine/build',{recursive:true});fs.mkdirSync('build',{recursive:true});
const base=['/nologo','/platform:x64'],common=['System.Xaml.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.Security.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll'],wpf=['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(n=>path.join(framework,'WPF',n));
execFileSync(csc,[...base,'/target:exe','/out:'+path.resolve('engine/build/YDesktop.exe'),...['System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll',...['UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll'].map(n=>path.join(framework,'WPF',n))].map(n=>'/reference:'+n),path.resolve('engine/windows/YDesktop.cs')],{stdio:'inherit',windowsHide:true});
execFileSync(csc,[...base,'/target:winexe','/out:'+path.resolve('build/YGPTLocal.exe'),...common.concat(wpf).map(n=>'/reference:'+n),path.resolve('setup/YGPTLocal.cs')],{stdio:'inherit',windowsHide:true});
for(const dir of ['runtime','service'])for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.mjs')))execFileSync(process.execPath,['--check',dir+'/'+name],{stdio:'inherit',windowsHide:true});
console.log('Native setup and desktop adapter compiled; JavaScript syntax checked.');
