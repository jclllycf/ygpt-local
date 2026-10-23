using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

// Backends deliberately have no process, registry, credential or network effects.
// Only UpdateWindow.cs is production code in this isolated WPF regression.
public static class HostCore {
 public const string Version="1.0.0-rc.15";
 public static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 public static readonly ManualResetEvent AllowPause=new ManualResetEvent(true),PauseEntered=new ManualResetEvent(false);
 public static readonly ConcurrentQueue<string> Calls=new ConcurrentQueue<string>();
 public static string Full(string p){return Path.GetFullPath(p);}
 public static string DefaultInstallDir(){throw new Exception("Real discovery is forbidden in the fixture");}
 public static string DefaultDataDir(){throw new Exception("Real discovery is forbidden in the fixture");}
 public static string OwnerId(string data){return Path.GetFileName(data);}
 public static string S(Dictionary<string,object> d,string key,string fallback=""){return d.ContainsKey(key)?Convert.ToString(d[key]):fallback;}
 public static bool B(Dictionary<string,object> d,string key){return d.ContainsKey(key)&&d[key] is bool&&(bool)d[key];}
 public static Dictionary<string,object> Read(string p){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(p));}
 public static void Save(string p,object value){File.WriteAllText(p,Json.Serialize(value));}
 public static void PrepareOwnedRepair(string install,string data){Calls.Enqueue("pause:"+install);PauseEntered.Set();if(!AllowPause.WaitOne(5000))throw new Exception("Fixture pause timed out");File.WriteAllText(Path.Combine(data,"paused"),"fixture");}
 public static void Start(string install,string data){Calls.Enqueue("start:"+install);File.Delete(Path.Combine(data,"paused"));Save(Path.Combine(data,"watchdog-health.json"),new{ownerId=OwnerId(data),version=Version,stopped=false,at=DateTime.UtcNow.ToString("o")});}
}
public static class YGPTApp {
 public static bool FailPayload;
 public static Dictionary<string,object> Read(string p){return HostCore.Read(p);}
 public static void ValidateInstallTarget(string target){if(!File.Exists(Path.Combine(target,".ygpt-install.json")))throw new Exception("Fixture install missing");}
 public static void InstallPayload(string install){HostCore.Calls.Enqueue("payload:"+install);if(FailPayload)throw new IOException("Fixture payload failure");}
 public static void RefreshIconCache(){}
}
public static class UpdateWindowRegression {
 const BindingFlags Private=BindingFlags.Instance|BindingFlags.NonPublic;
 static T Field<T>(object o,string name){return (T)o.GetType().GetField(name,Private).GetValue(o);}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void Select(UpdateWindow w,int index){w.GetType().GetMethod("SelectInstall",Private).Invoke(w,new object[]{index});}
 static Task Run(UpdateWindow w){return (Task)w.GetType().GetMethod("RunUpdate",Private).Invoke(w,null);}
 static void PumpUntil(Func<bool> done){var end=DateTime.UtcNow.AddSeconds(8);while(!done()){if(DateTime.UtcNow>end)throw new Exception("Fixture dispatcher timed out");var frame=new DispatcherFrame();var tick=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(10)};tick.Tick+=(s,e)=>{tick.Stop();frame.Continue=false;};tick.Start();Dispatcher.PushFrame(frame);}}
 static string[] Install(string root,string name,object config){string install=Path.Combine(root,name),data=Path.Combine(root,name+"-data");Directory.CreateDirectory(install);Directory.CreateDirectory(data);File.WriteAllText(Path.Combine(install,".ygpt-install.json"),"{}");File.WriteAllText(Path.Combine(install,"YGPTWatchdog.exe"),"fixture only");HostCore.Save(Path.Combine(data,"ygpt.config.json"),config);return new[]{install,data,"old"};}
 [STAThread] public static int Main(string[] args){
  SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
  var first=Install(args[0],"first",new{brandIcon="ygpt-local-sky-y-256.png",approvalStyle="legacy"});
  var second=Install(args[0],"second",new Dictionary<string,object>());
  var w=new UpdateWindow(new List<string[]>{first,second});w.Show();
  var body=Field<StackPanel>(w,"body");int count=body.Children.Count;
  for(int i=0;i<4;i++){Select(w,1);Check(Field<string>(w,"brandIcon")=="plugin-icon-256.png","Brand must reset for an install with no saved choice");Select(w,0);}
  Check(body.Children.Count==count&&body.Children.Contains(Field<Button>(w,"updateButton")),"Selection must preserve exactly one summary, picker and update button");
  // Reading a preview must release the image file before application replacement.
  string brand=Path.Combine(first[0],"assets","brand");Directory.CreateDirectory(brand);
  string icon=Path.Combine(brand,"plugin-icon-256.png");
  File.Copy(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"fixture-icon.png"),icon);
  Select(w,0);using(var exclusive=new FileStream(icon,FileMode.Open,FileAccess.ReadWrite,FileShare.None)){}
  HostCore.PauseEntered.Reset();HostCore.AllowPause.Reset();var task=Run(w);PumpUntil(()=>HostCore.PauseEntered.WaitOne(0));
  Check(!Field<ComboBox>(w,"installChoice").IsEnabled&&!Field<StackPanel>(w,"pickerHost").IsEnabled,"Selection must be disabled during an update");
  Select(w,1);Check(Field<string>(w,"install")==first[0],"Busy window must reject target changes");w.Close();Check(w.IsVisible,"Closing must wait for a running update");
  // Even a later field change cannot redirect the captured asynchronous target.
  w.GetType().GetField("install",Private).SetValue(w,second[0]);w.GetType().GetField("data",Private).SetValue(w,second[1]);
  HostCore.AllowPause.Set();PumpUntil(()=>task.IsCompleted);task.GetAwaiter().GetResult();
  Check(HostCore.Calls.ToArray().SequenceEqual(new[]{"pause:"+first[0],"payload:"+first[0],"start:"+first[0]}),"All update operations must retain the original target");
  Check(!HostCore.Read(Path.Combine(second[1],"ygpt.config.json")).ContainsKey("brandIcon"),"Another installation must retain its config");w.Close();
  // A failed payload swap resumes the retained application only when this run paused it.
  YGPTApp.FailPayload=true;string discarded;while(HostCore.Calls.TryDequeue(out discarded)){}
  w=new UpdateWindow(new List<string[]>{first});task=Run(w);PumpUntil(()=>task.IsCompleted);task.GetAwaiter().GetResult();
  Check(HostCore.Calls.ToArray().Last()=="start:"+first[0]&&!File.Exists(Path.Combine(first[1],"paused")),"Failed update must resume retained application");w.Close();
  while(HostCore.Calls.TryDequeue(out discarded)){}File.WriteAllText(Path.Combine(first[1],"paused"),"owner pause");
  w=new UpdateWindow(new List<string[]>{first});task=Run(w);PumpUntil(()=>task.IsCompleted);task.GetAwaiter().GetResult();
  Check(!HostCore.Calls.ToArray().Any(s=>s.StartsWith("start:"))&&File.Exists(Path.Combine(first[1],"paused")),"Failed update must preserve the owner's prior pause");w.Close();
  Console.WriteLine("UPDATE_WINDOW_PASS");return 0;
 }
}
