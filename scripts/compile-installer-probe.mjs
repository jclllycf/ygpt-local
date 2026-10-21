import path from 'node:path';
import {execFileSync} from 'node:child_process';
const framework=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319');
execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/target:exe','/out:'+path.resolve('build/InstallerProbe.exe'),...['System.Web.Extensions.dll','System.Security.dll',...['UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll'].map(n=>path.join(framework,'WPF',n))].map(n=>'/reference:'+n),path.resolve('tests/InstallerProbe.cs')],{stdio:'inherit',windowsHide:true});
