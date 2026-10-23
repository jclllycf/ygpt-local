using System;
using System.IO;
using System.Reflection;
using System.Collections.Generic;
public static class WatchdogStartupRegression {
 const BindingFlags Private=BindingFlags.Static|BindingFlags.NonPublic;
 static void Set(string field,object value){typeof(YGPTWatchdog).GetField(field,Private).SetValue(null,value);}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static Dictionary<string,object> Health(string root,bool local){typeof(YGPTWatchdog).GetMethod("Health",Private).Invoke(null,new object[]{local,false});return HostCore.Read(Path.Combine(root,"watchdog-health.json"));}
 static void Failure(string root,DateTime at){HostCore.Save(Path.Combine(root,"service-health.json"),new{product="YGPT Local",startupFailure=new{version=HostCore.Version,at=at.ToString("o"),code="STATE_LINK_REFUSED",path=@"D:\YGPT state\link",target=@"\??\D:\wrong"}});}
 public static int Main(string[] args){
  string root=args[0];DateTime launch=DateTime.UtcNow;Set("data",root);Set("install",root);Set("started",launch);Set("phase","starting");
  Failure(root,launch.AddMilliseconds(1));var h=Health(root,false);
  Check(HostCore.S(h,"lastError")=="STATE_LINK_REFUSED"&&HostCore.S(h,"phase")=="engine-startup-failed","Watchdog hid the startup refusal");
  var failure=h["startupFailure"] as Dictionary<string,object>;Check(failure!=null&&HostCore.S(failure,"path")==@"D:\YGPT state\link"&&HostCore.S(failure,"target")==@"\??\D:\wrong","Watchdog lost refusal paths");
  Set("lastError","");h=Health(root,true);Check(h["startupFailure"]==null,"Healthy engine retained a startup failure");
  Failure(root,launch.AddMinutes(-1));h=Health(root,false);Check(h["startupFailure"]==null,"Prior transport failure masqueraded as this launch");
  Console.WriteLine("WATCHDOG_STARTUP_PASS");return 0;
 }
}
