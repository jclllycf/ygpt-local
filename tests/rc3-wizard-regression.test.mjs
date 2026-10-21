import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Exercises compiled Windows Setup logic in a disposable TEMP directory.
// No Tunnel, local production data, or ChatGPT account is accessed.
test('Wizard rejects nonempty directories and safely handles missing watchdog health', {skip:process.platform!=='win32'}, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-wizard-'));
  try {
    const build=path.resolve('build','YGPTLocal.exe');
    assert.ok(fs.existsSync(build),'Compile the installer before running this test');
    fs.copyFileSync(build,path.join(root,'YGPTLocal.exe'));
    const cs=String.raw`
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Reflection;
public static class TestWizard {
 public static int Main(string[] args) {
  if(args.Length>0 && args[0]=="--sleep"){Thread.Sleep(12000);return 0;}
  string root=args[0],fresh=Path.Combine(root,"fresh"),occupied=Path.Combine(root,"occupied");
  YGPTApp.ValidateInstallTarget(fresh);
  Directory.CreateDirectory(occupied);
  File.WriteAllText(Path.Combine(occupied,"another-application.txt"),"do not overwrite");
  bool rejected=false;
  try{YGPTApp.ValidateInstallTarget(occupied);}catch(InvalidOperationException e){
   rejected=e.Message.Contains("EMPTY")&&e.Message.Contains("portable ZIP");
  }
  if(!rejected||File.ReadAllText(Path.Combine(occupied,"another-application.txt"))!="do not overwrite")return 11;
  string install=Path.Combine(root,"previous-install"),data=Path.Combine(root,"data");
  Directory.CreateDirectory(install);Directory.CreateDirectory(data);
  HostCore.Save(Path.Combine(install,".ygpt-install.json"),new {product="YGPT Local",installRoot=Path.GetFullPath(install)});
  YGPTApp.ValidateInstallTarget(install);
  HostCore.PrepareOwnedRepair(install,data); // Partially installed, no worker or health.
  if(File.Exists(Path.Combine(data,"watchdog-health.json")))return 12;
  File.Copy(Assembly.GetExecutingAssembly().Location,Path.Combine(install,"owned-worker.exe"));
  File.Copy(Path.Combine(root,"YGPTLocal.exe"),Path.Combine(install,"YGPTLocal.exe"));
  Process child=null;
  try {
   child=Process.Start(new ProcessStartInfo(Path.Combine(install,"owned-worker.exe"),"--sleep"){UseShellExecute=false,CreateNoWindow=true});
   Thread.Sleep(700);
   bool blocked=false;
   try{HostCore.PrepareOwnedRepair(install,data);}catch(InvalidOperationException e){
    blocked=e.Message.Contains("may still be active");
   }
   if(!blocked)return 13;
  }finally{if(child!=null){if(!child.HasExited)child.Kill();child.WaitForExit(3000);child.Dispose();}}
  // Test true first-install Task Scheduler registration with a UNIQUE disposable task.
  // Does not start it, never touches any existing YGPT production task.
  try{
    HostCore.RegisterTask(install,data,true);
    dynamic svc=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));
    svc.Connect();
    dynamic folder=svc.GetFolder("\\");
    dynamic task=folder.GetTask(HostCore.TaskName(data));
    if(task==null)return 14;
    // Windows normalizes a SID principal to a short user name in the stored task.
    // Confirm ownership is verified without overwriting an unrelated task.
    if(!HostCore.SameUserPrincipal(Convert.ToString(task.Definition.Principal.UserId),System.Security.Principal.WindowsIdentity.GetCurrent().User))return 15;
    HostCore.RegisterTask(install,data,true); // Repeat install is idempotent.
    HostCore.RegisterTask(install,data,false); // Safe same-owner removal.
    try{folder.GetTask(HostCore.TaskName(data));return 16;}catch(Exception e){if(e.HResult!=unchecked((int)0x80070002))throw;}
  }finally{
    // Remove only the disposable task whose action points into this test folder.
    dynamic svc2=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));svc2.Connect();dynamic folder2=svc2.GetFolder("\\");dynamic owned=null;
    try{owned=folder2.GetTask(HostCore.TaskName(data));}catch(Exception e){if(e.HResult!=unchecked((int)0x80070002))throw;}
    if(owned!=null&&String.Equals(Convert.ToString(owned.Definition.Actions.Item(1).Path),Path.Combine(install,"YGPTWatchdog.exe"),StringComparison.OrdinalIgnoreCase))
      folder2.DeleteTask(HostCore.TaskName(data),0);
  }
  return 0;
 }
}
`.replaceAll('\\`','`');
    const src=path.join(root,'TestWizard.cs');
    fs.writeFileSync(src,cs);
    const csc=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
    execFileSync(csc,['/nologo','/platform:x64','/out:'+path.join(root,'TestWizard.exe'),'/reference:'+path.join(root,'YGPTLocal.exe'),src],{windowsHide:true,stdio:'pipe'});
    const report=execFileSync(path.join(root,'TestWizard.exe'),[root],{windowsHide:true,timeout:25000,encoding:'utf8'});
    assert.equal(report,'');
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
