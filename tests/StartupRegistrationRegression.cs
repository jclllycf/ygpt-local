using System;using System.IO;using System.Reflection;using System.Threading;using System.Security.Principal;
public static class StartupRegistrationRegression {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static dynamic Task(dynamic root,string name){try{return root.GetTask(name);}catch(Exception e){if(e.HResult==unchecked((int)0x80070002))return null;throw;}}
 static void Manifest(string install,string exe){HostCore.Save(Path.Combine(install,"manifest.json"),new{product="YGPT Local",files=new[]{new{path="YGPTWatchdog.exe",sha256=HostCore.Hash(exe)}}});}
 public static int Main(string[] args){
  if(args[0]=="--data-dir"){File.WriteAllText(Path.Combine(args[1],"startup-fixture-marker.txt"),"fixture-only");return 0;}
  string install=Path.Combine(args[0],"install"),data=Path.Combine(args[0],"data");Directory.CreateDirectory(install);Directory.CreateDirectory(data);HostCore.Save(Path.Combine(data,"connection.json"),new{autoStart=true});
  dynamic scheduler=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));scheduler.Connect();dynamic root=scheduler.GetFolder("\\");string name=HostCore.TaskName(data),exe=Path.Combine(install,"YGPTWatchdog.exe"),self=Assembly.GetExecutingAssembly().Location;
  Check(Task(root,name)==null,"Fixture startup task unexpectedly exists");
  try{
   Check(HostCore.BackgroundBinaryIssue(install)=="BACKGROUND_BINARY_MISSING","Missing daemon was not diagnosed");
   File.Copy(self,exe);Manifest(install,exe);Check(HostCore.BackgroundBinaryIssue(install)=="","Verified fixture was rejected");
   var inspected=HostCore.CheckStartupRegistration(install,data,false);Check(HostCore.S(inspected,"state")=="missing"&&Task(root,name)==null,"Read-only inspection created persistence");
   var repaired=HostCore.CheckStartupRegistration(install,data);Check(HostCore.B(repaired,"changed")&&HostCore.S(repaired,"state")=="registered","Missing enabled startup was not repaired");
   dynamic task=Task(root,name);Check(HostCore.OwnedStartupTask(task,install,data)&&HostCore.StartupRecoveryTrigger(task),"Startup identity or recovery trigger lost");
   Check((int)task.Definition.Principal.RunLevel==0&&(int)task.Definition.Settings.MultipleInstances==2&&Convert.ToString(task.Definition.Settings.ExecutionTimeLimit)=="PT0S","Startup changed privilege or duplicate-process policy");
   Check(!HostCore.B(HostCore.CheckStartupRegistration(install,data),"changed"),"Healthy startup was rewritten on every check");
   if(Environment.GetEnvironmentVariable("YGPT_TEST_SCHEDULER_RUN")=="1"){
    task.Run(null);DateTime deadline=DateTime.UtcNow.AddSeconds(15);while(!File.Exists(Path.Combine(data,"startup-fixture-marker.txt"))&&DateTime.UtcNow<deadline)Thread.Sleep(100);
    Check(File.Exists(Path.Combine(data,"startup-fixture-marker.txt")),"Scheduler did not run the harmless fixture");Console.WriteLine("STARTUP_SCHEDULER_RUN_PASS");
   }
   root.DeleteTask(name,0);Check(HostCore.B(HostCore.CheckStartupRegistration(install,data),"changed"),"Deleted owned registration was not repaired");
   root.DeleteTask(name,0);File.Delete(exe);var missing=HostCore.CheckStartupRegistration(install,data);Check(HostCore.S(missing,"error")=="BACKGROUND_BINARY_MISSING"&&Task(root,name)==null,"Missing/quarantined daemon was silently recreated or registered");
   bool refused=false;try{HostCore.Start(install,data);}catch(InvalidOperationException e){refused=e.Message.Contains("BACKGROUND_BINARY_MISSING");}Check(refused,"Missing daemon was launched or reported as ready");
   File.WriteAllText(exe,"changed fixture");Check(HostCore.BackgroundBinaryIssue(install)=="BACKGROUND_BINARY_CHANGED","Changed daemon bypassed integrity check");File.Delete(exe);File.Copy(self,exe);
   HostCore.RegisterTask(install,data,true);task=Task(root,name);task.Enabled=false;Check(HostCore.S(HostCore.CheckStartupRegistration(install,data),"state")=="disabled-in-windows"&&!(bool)Task(root,name).Enabled,"Explicit Windows disable was overridden");
   task.Enabled=true;dynamic definition=task.Definition;definition.Actions.Item(1).Path=Path.Combine(install,"different-owner-fixture.exe");root.RegisterTaskDefinition(name,definition,6,WindowsIdentity.GetCurrent().User.Value,null,3,null);
   Check(HostCore.S(HostCore.CheckStartupRegistration(install,data),"state")=="foreign-task-preserved","Foreign task was overwritten");
   refused=false;try{HostCore.RegisterTask(install,data,false);}catch(InvalidOperationException){refused=true;}Check(refused&&Task(root,name)!=null,"Foreign task was deleted");
   root.DeleteTask(name,0);HostCore.Save(Path.Combine(data,"connection.json"),new{autoStart=false});Check(HostCore.S(HostCore.CheckStartupRegistration(install,data),"state")=="off"&&Task(root,name)==null,"Opt-out created a task");
   Console.WriteLine("STARTUP_REGISTRATION_PASS");return 0;
  }finally{if(Task(root,name)!=null)root.DeleteTask(name,0);}
 }
}
