import path from 'node:path';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const fw=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319');
const common=['System.Web.Extensions.dll','System.Security.dll','System.Management.dll','Microsoft.CSharp.dll'];
for(const [file,name,extra] of [['tests/cleanup-probe.cs','CleanupProbe',[]],['tests/Rc3InstallerProbe.cs','Rc3InstallerProbe',['System.Drawing.dll',...['UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll'].map(n=>path.join(fw,'WPF',n))]]])execFileSync(path.join(fw,'csc.exe'),['/nologo','/platform:x64','/target:exe','/out:'+path.resolve('build/'+name+'.exe'),...common.concat(extra).map(n=>'/reference:'+n),path.resolve('setup/HostCore.cs'),path.resolve(file)],{stdio:'inherit',windowsHide:true});
const root=path.resolve('..','.ygpt-local-tests','rc3-native-'+Date.now());
if(process.argv.includes('--cleanup'))execFileSync(path.resolve('build/CleanupProbe.exe'),[root],{stdio:'inherit',windowsHide:true});
else {const version=JSON.parse(fs.readFileSync('package.json')).version;execFileSync(path.resolve('build/Rc3InstallerProbe.exe'),[path.resolve('dist/YGPTLocal-Setup-'+version+'-win-x64.exe'),root],{stdio:'inherit',windowsHide:true});}
