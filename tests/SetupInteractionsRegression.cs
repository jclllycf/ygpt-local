using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using System.Windows.Threading;

// Disposable WPF and signed cleanup fixtures. No real clipboard access,
// browser launch, installation, registry writes or production service calls.
public static class SetupInteractionsRegression {
 static readonly BindingFlags Flags=BindingFlags.Instance|BindingFlags.NonPublic;
 static void Check(bool ok,string name){if(!ok)throw new Exception(name);}
 static object Get(object obj,string name){return obj.GetType().GetField(name,Flags).GetValue(obj);}
 static void Set(object obj,string name,object value){obj.GetType().GetField(name,Flags).SetValue(obj,value);}
 static object Call(object obj,string name,params object[] args){return obj.GetType().GetMethods(Flags|BindingFlags.DeclaredOnly).Single(m=>m.Name==name&&m.GetParameters().Length==args.Length).Invoke(obj,args);}
 static IEnumerable<DependencyObject> Tree(DependencyObject obj){yield return obj;foreach(object child in LogicalTreeHelper.GetChildren(obj))if(child is DependencyObject)foreach(var nested in Tree((DependencyObject)child))yield return nested;}
 static T Find<T>(Window w,string id) where T:DependencyObject{return Tree(w).OfType<T>().Single(x=>AutomationProperties.GetAutomationId(x)==id);}
 static void Clipboard(){
  int calls=0;string text=SetupInteractions.RetryClipboard(()=>{if(++calls<4)throw new ExternalException("busy",unchecked((int)0x800401D0));return "value";}).GetAwaiter().GetResult();
  Check(calls==4&&text=="value","Clipboard retries transient contention");
  calls=0;bool busy=false;try{SetupInteractions.RetryClipboard<int>(()=>{calls++;throw new ExternalException("busy",unchecked((int)0x800401D0));}).GetAwaiter().GetResult();}catch(ClipboardBusyException){busy=true;}
  Check(busy&&calls==8,"Clipboard stops after bounded retry with recoverable feedback");
  calls=0;bool unrelated=false;try{SetupInteractions.RetryClipboard<int>(()=>{calls++;throw new InvalidOperationException("unrelated");}).GetAwaiter().GetResult();}catch(InvalidOperationException){unrelated=true;}
  Check(unrelated&&calls==1,"Unrelated clipboard error is not retried");
  string prompt="Line 1 & ? #\n路径 C:\\Example Folder\\marker.txt";var url=new Uri(SetupInteractions.ChatDraftUrl(prompt));
  Check(url.Scheme=="https"&&url.Host=="chatgpt.com"&&url.AbsolutePath=="/"&&url.Query.StartsWith("?prompt=")&&Uri.UnescapeDataString(url.Query.Substring(8))==prompt,"Official unsent draft URL preserves all text");
  string check=SetupInteractions.FirstPrompt(@"D:\YGPTExample",@"D:\Projects\YGPT-Verification-00000000\marker.txt");
  Check(check.Contains("Finish setup")&&check.Contains("signed cleanup plan")&&check.Contains("private data")&&check.Contains("YGPTLocal.exe")&&check.Contains("manifest.json"),"English prompt checks installation and bounded cleanup");
 }
 static void Wizard(string root){
  string install=Path.Combine(root,"application"),data=Path.Combine(install,"data");Directory.CreateDirectory(data);
  var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};var w=new SetupWindow(data,install);
  Set(w,"checking",true);((DispatcherTimer)Get(w,"timer")).Stop();
  Check(((CheckBox)Get(w,"sourceCleanup")).IsChecked==true,"Exact source cleanup defaults on");
  Check(Find<Expander>(w,"appearance-options").IsExpanded,"Appearance preview defaults open");
  var version=Find<StackPanel>(w,"sidebar-version");Check(version.Parent is DockPanel&&DockPanel.GetDock(version)==Dock.Bottom,"Version stays in lower-left dock");
  Set(w,"step",2);Call(w,"Render");Check(Find<Expander>(w,"guide-tunnel").IsExpanded,"Tunnel guide defaults open");
  var copy=Find<Button>(w,"copy-tunnel-name");Check(copy.Parent is Grid&&Grid.GetColumn(copy)==2,"Copy sits next to matching field");
  Set(w,"step",3);Call(w,"Render");Check(Find<Expander>(w,"guide-api-key").IsExpanded,"Key guide defaults open");
  Set(w,"sessionInstalled",true);Set(w,"installedFingerprint",Call(w,"InstallationFingerprint"));Set(w,"step",4);Call(w,"Render");
  Check(((Button)Get(w,"next")).Content.ToString()=="Continue to connection check","Revisited install has continue action");
  Call(w,"Next",null,new RoutedEventArgs());Check((int)Get(w,"step")==5,"Back then Next does not execute InstallPayload again");
  var fields=(Dictionary<string,TextBox>)Get(w,"fields");fields["folder"].Text=root;Set(w,"step",4);Call(w,"Render");
  Check(!(bool)Call(w,"CanContinueInstallation")&&((Button)Get(w,"next")).Content.ToString()=="Apply changed settings","Changed settings require one explicit apply");
  Set(w,"step",7);Call(w,"Render");Check(((Button)Get(w,"next")).Content.ToString()=="Skip for now","Daily browser step is skippable by default");
  var browser=Find<ComboBox>(w,"handoff-browser");browser.ApplyTemplate();
  Check(browser.Template.FindName("PART_Popup",browser)!=null&&browser.ItemContainerStyle!=null&&browser.MinHeight>=44,"Browser picker has a themed native popup and generous targets");
  Check(AutomationProperties.GetName(browser)=="Browser for ChatGPT and setup links"&&browser.Focusable,"Browser picker retains accessible naming and keyboard focus");
  browser.SelectedIndex=2;Check((string)Call(w,"Browser")=="edge","Themed picker preserves browser selection");browser.SelectedIndex=0;
  ((CheckBox)Get(w,"dailyOptIn")).IsChecked=true;Call(w,"Render");
  Check(Find<Button>(w,"open-chrome-extensions")!=null&&Find<Button>(w,"open-edge-extensions")!=null&&Find<Button>(w,"open-pairing-page")!=null,"Direct extension and pairing page actions exist");
  Call(w,"Next",null,new RoutedEventArgs());Check((int)Get(w,"step")==8,"Optional browser has its own step before final check");
  Check(!Find<Button>(w,"open-first-chat").IsEnabled,"No stale marker draft is offered");
  string markerFolder=Path.Combine(root,"YGPT-Verification-00000000");Directory.CreateDirectory(markerFolder);string marker=Path.Combine(markerFolder,"marker.txt");File.WriteAllText(marker,"FIXTURE_MARKER");
  HostCore.Save(Path.Combine(data,"first-use-challenge.json"),new{path=marker,generation="fixture"});Call(w,"Render");
  Check(Find<Button>(w,"open-first-chat").IsEnabled,"Fresh marker enables unsent ChatGPT draft");
  Check(!Tree(w).OfType<Button>().Any(b=>Convert.ToString(b.Content).Contains("Copy first")),"Old copy-first-prompt action removed");
  w.Close();app.Shutdown();
 }
 static void Cleanup(string root){
  string install=Path.Combine(root,"installed"),data=Path.Combine(install,"data"),downloads=Path.Combine(root,"downloads"),verification=Path.Combine(root,"YGPT-Verification-00000001");
  Directory.CreateDirectory(install);Directory.CreateDirectory(downloads);Directory.CreateDirectory(verification);HostCore.PrivateDirectory(data);
  string key=HostCore.NewKey(),generation=Guid.NewGuid().ToString("N");HostCore.SaveSecrets(data,new Dictionary<string,object>{{"verificationKey",key},{"localKey",HostCore.NewKey()}});
  string source=Path.Combine(downloads,"owned-setup.bin"),marker=Path.Combine(verification,"marker.txt"),unrelated=Path.Combine(downloads,"personal.txt"),settings=Path.Combine(install,"YGPTLocal.exe");
  foreach(string file in new[]{source,marker,unrelated,settings})File.WriteAllText(file,"FIXTURE");string secretsHash=HostCore.Hash(Path.Combine(data,"credentials.dpapi"));
  string payload=HostCore.Json.Serialize(new{generation=generation,readSucceeded=true,transport="official-secure-tunnel",fixture=true,notRealHostEvidence=true});string mac;
  using(var h=new HMACSHA256(Encoding.UTF8.GetBytes(key)))mac=HostCore.Hex(h.ComputeHash(Encoding.UTF8.GetBytes(payload)));
  HostCore.Save(Path.Combine(data,"first-use-proof.json"),new{payload=payload,mac=mac});HostCore.Save(Path.Combine(data,"connection.json"),new{mode="local-only",fixtureOnly=true});
  var self=Process.GetCurrentProcess();HostCore.Save(Path.Combine(data,"watchdog-health.json"),new{ownerId=HostCore.OwnerId(data),localReady=true,pid=self.Id,birth=self.StartTime.ToUniversalTime().Ticks,at=DateTime.UtcNow.ToString("o"),fixtureOnly=true});
  using(var child=Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,"--hold"){UseShellExecute=false,CreateNoWindow=true})){
   var entries=new[]{InstallCleanup.Entry(source,generation,"setup-download",downloads,true),InstallCleanup.Entry(marker,generation,"verification-marker",verification,false)};
   InstallCleanup.Record(data,install,generation,entries,true,child.Id,child.StartTime.ToUniversalTime().Ticks);
   var pending=Task.Run(()=>InstallCleanup.AfterSetup(data,install));Thread.Sleep(120);
   Check(!child.HasExited&&File.Exists(source)&&File.Exists(marker),"Cleanup waits while original setup process lives");
   var result=pending.GetAwaiter().GetResult();Check(HostCore.S(result,"state")=="complete","Bounded after-exit helper completes cleanup");
   Check(!File.Exists(source)&&!Directory.Exists(verification)&&Convert.ToInt32(result["totalDeleted"])==2,"Exact setup and marker removed, empty marker folder removed");
  }
  Check(File.Exists(unrelated)&&File.Exists(settings)&&HostCore.Hash(Path.Combine(data,"credentials.dpapi"))==secretsHash,"Unrelated download, installed Settings and encrypted data kept");
  Check(Convert.ToInt32(InstallCleanup.Run(data,install)["deleted"])==0,"Cleanup replay is idempotent");
 }
 [STAThread] public static int Main(string[] args){try{if(args[0]=="--hold"){Thread.Sleep(2200);return 0;}string root=Path.GetFullPath(args[0]);Check(root.Contains(".ygpt-local-tests"),"Explicit disposable root required");if(args[1]=="cleanup")Cleanup(root);else{Clipboard();Wizard(root);}Console.WriteLine("SETUP_INTERACTIONS_PASS "+args[1]);return 0;}catch(Exception e){Console.Error.WriteLine(e);return 1;}}
}
