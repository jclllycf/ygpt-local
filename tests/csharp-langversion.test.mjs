import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// The Windows build compiles with the .NET Framework csc.exe (v4.0.30319),
// which only understands C# 5: no await in catch/finally, no string
// interpolation, no ?. operator. Roslyn accepts all of those by default, so a
// change can look fine on a newer compiler and still break `npm run package`.
// When the repo-local Roslyn SDK and net48 reference assemblies exist (see
// .local/tools/csc5.sh), compile every shipped C# target at -langversion:5.
// Output goes to a temporary directory; no installer or runtime is built.
const local=path.resolve('.local'),refs=path.join(local,'refs/net48/build/.NETFramework/v4.8');
const sdk=fs.existsSync(path.join(local,'dotnet/sdk'))?fs.readdirSync(path.join(local,'dotnet/sdk')).map(v=>path.join(local,'dotnet/sdk',v,'Roslyn/bincore/csc.dll')).find(f=>fs.existsSync(f)):null;
const automation=path.join(local,'downloads/ps51/lib/net461/System.Management.Automation.dll');
const available=!!sdk&&fs.existsSync(refs)&&fs.existsSync(path.join(local,'dotnet/dotnet'));
const names=['mscorlib','System','System.Core','System.Xml','System.Xaml','System.Drawing','System.Windows.Forms','System.Web.Extensions','System.Security','System.Management','System.IO.Compression','System.IO.Compression.FileSystem','Microsoft.CSharp','WindowsBase','PresentationCore','PresentationFramework','UIAutomationTypes','UIAutomationClient','UIAutomationProvider'];
const targets=[
  ['setup','winexe',null,['setup/HostCore.cs','setup/YGPTLocal.cs','setup/SetupWindow.cs','setup/UpdateWindow.cs']],
  ['watchdog','winexe','YGPTWatchdog',['setup/HostCore.cs','setup/Watchdog.cs']],
  ['watchdog-startup-regression','exe','WatchdogStartupRegression',['setup/HostCore.cs','setup/Watchdog.cs','tests/WatchdogStartupRegression.cs']],
  ['ydesktop','exe',null,['engine/windows/YDesktop.cs']],
  ['native-windows','exe','NativeWindows',['setup/HostCore.cs','setup/NativeWindows.cs'],[automation]],
  ['update-window-regression','exe','UpdateWindowRegression',['setup/UpdateWindow.cs','tests/UpdateWindowRegression.cs']],
  ['install-payload-regression','exe','InstallPayloadRegression',['setup/HostCore.cs','setup/YGPTLocal.cs','tests/InstallPayloadRegression.cs']],
];
test('Shipped C# compiles as C# 5, like the .NET Framework csc used by the Windows build',{skip:available?false:'repo-local Roslyn SDK / net48 reference assemblies not present'},t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-csc5-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  for(const [name,kind,main,sources,extra=[]] of targets){
    if(extra.some(f=>!fs.existsSync(f))){t.diagnostic(name+': skipped, reference assembly missing');continue;}
    const args=[sdk,'-nologo','-noconfig','-nostdlib','-langversion:5','-platform:x64','-target:'+kind,...(main?['-main:'+main]:[]),'-out:'+path.join(out,name+'.exe'),...names.map(n=>'-r:'+path.join(refs,n+'.dll')),...extra.map(f=>'-r:'+f),...sources.map(f=>path.resolve(f))];
    let output='';
    try{output=execFileSync(path.join(local,'dotnet/dotnet'),args,{encoding:'utf8',stdio:'pipe',timeout:240000});}
    catch(e){assert.fail(name+' does not compile as C# 5:\n'+String(e.stdout??'')+String(e.stderr??''));}
    assert.doesNotMatch(output,/error CS/,name);
  }
});
