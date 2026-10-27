using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Automation;
using System.Windows.Threading;

// Disposable offscreen WPF/DPAPI fixture. No real account, registry change,
// browser navigation, Tunnel process or production installation is used.
public static class AccountConnectionsRegression {
 static readonly BindingFlags Flags=BindingFlags.Instance|BindingFlags.NonPublic;
 static void Check(bool ok,string text){if(!ok)throw new Exception(text);}
 static IEnumerable<DependencyObject> Tree(DependencyObject value){yield return value;foreach(object child in LogicalTreeHelper.GetChildren(value))if(child is DependencyObject)foreach(var next in Tree((DependencyObject)child))yield return next;}
 static T Find<T>(Window window,string id) where T:DependencyObject{return Tree(window).OfType<T>().Single(x=>AutomationProperties.GetAutomationId(x)==id);}
 [STAThread] public static int Main(string[] args){
  string install=Path.Combine(args[0],"app"),data=Path.Combine(install,"data");HostCore.PrivateDirectory(data);
  HostCore.Save(Path.Combine(install,".ygpt-install.json"),new{product="YGPT Local"});
  string first="tunnel_"+new string('1',32),second="tunnel_"+new string('2',32);
  HostCore.Save(Path.Combine(data,"connection.json"),new{mode="secure-tunnel",tunnelId=first,autoStart=false});
  HostCore.Save(Path.Combine(data,"ygpt.config.json"),new{port=17854,projectRoots=new[]{args[0]}});
  HostCore.SaveSecrets(data,new Dictionary<string,object>{{"runtimeKey","FIXTURE_PRIMARY_ONLY"},{"localKey",HostCore.NewKey()}});
  byte[] original=File.ReadAllBytes(Path.Combine(data,"credentials.dpapi"));
  string id=AccountConnections.Save(data,null,"Second account",second,"FIXTURE_SECOND_ONLY",false);
  Check(AccountConnections.List(data).Count==1,"Connection not added");
  Check(original.SequenceEqual(File.ReadAllBytes(Path.Combine(data,"credentials.dpapi"))),"Default credentials changed");
  Check(HostCore.S(HostCore.Secrets(AccountConnections.Root(data,id)),"runtimeKey")=="FIXTURE_SECOND_ONLY","Separate encrypted key not retained");
  Check(!File.ReadAllText(Path.Combine(data,"connections.json")).Contains("FIXTURE_"),"Secret in public metadata");
  AccountConnections.Save(data,id,"Renamed account",second,"",false);
  Check(HostCore.S(HostCore.Secrets(AccountConnections.Root(data,id)),"runtimeKey")=="FIXTURE_SECOND_ONLY","Blank edit replaced saved key");
  bool duplicate=false;try{AccountConnections.Save(data,null,"Third account",first,"FIXTURE_KEY",true);}catch{duplicate=true;}Check(duplicate,"Duplicate Tunnel accepted");
  bool traversal=false;try{AccountConnections.Root(data,"../outside");}catch{traversal=true;}Check(traversal,"Path traversal accepted");
  AccountConnections.Enable(data,id,true);Check(HostCore.B(AccountConnections.List(data)[0],"enabled"),"Enable not persisted");AccountConnections.Enable(data,id,false);
  var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};var window=new SetupWindow(data,install);
  ((DispatcherTimer)typeof(SetupWindow).GetField("timer",Flags).GetValue(window)).Stop();
  typeof(SetupWindow).GetField("connectionsView",Flags).SetValue(window,true);typeof(SetupWindow).GetMethods(Flags|BindingFlags.DeclaredOnly).Single(m=>m.Name=="Render"&&m.GetParameters().Length==0).Invoke(window,null);
  Check(Find<Button>(window,"add-account-connection").IsEnabled,"Add account missing from Setup");
  Check(Find<Button>(window,"next").Visibility==Visibility.Collapsed,"Profiles should not trigger installer Next");
  typeof(SetupWindow).GetField("editingConnection",Flags).SetValue(window,id);typeof(SetupWindow).GetMethods(Flags|BindingFlags.DeclaredOnly).Single(m=>m.Name=="Render"&&m.GetParameters().Length==0).Invoke(window,null);
  Check(Find<TextBox>(window,"connection-name").Text=="Renamed account","Saved name missing");
  Check(Find<PasswordBox>(window,"connection-api-key").Password=="","UI exposed saved API key");
  Check(Find<Button>(window,"save-account-connection")!=null,"Save action missing");
  if(args.Length>1){var content=(FrameworkElement)window.Content;content.Width=1120;content.Height=860;content.Measure(new Size(1120,860));content.Arrange(new Rect(0,0,1120,860));content.UpdateLayout();var bitmap=new RenderTargetBitmap(1120,860,96,96,PixelFormats.Pbgra32);bitmap.Render(content);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using(var stream=File.Create(args[1]))encoder.Save(stream);}
  window.Close();app.Shutdown();Console.WriteLine("ACCOUNT_CONNECTIONS_PASS");return 0;
 }
}
