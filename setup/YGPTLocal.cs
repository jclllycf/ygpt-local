using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Automation;
using Microsoft.Win32;
using F = System.Windows.Forms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

public static class YGPTApp {
 public const string Version=HostCore.Version;
 public static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=32*1024*1024};
 public static string Base=AppDomain.CurrentDomain.BaseDirectory;
 public static string DefaultData=HostCore.DefaultDataDir();
 public static string Q(string s){if(s.IndexOf('"')>=0||s.Any(c=>c<' '))throw new Exception("Invalid path characters");return "\""+s+new string('\\',s.Reverse().TakeWhile(c=>c=='\\').Count())+"\"";}
 public static string Arg(string[] a,string k,string fallback){int i=Array.IndexOf(a,k);return i>=0&&i+1<a.Length?a[i+1]:fallback;}
 [STAThread] public static void Main(string[] args){try{
  Thread.CurrentThread.CurrentUICulture=System.Globalization.CultureInfo.GetCultureInfo("en-US");Thread.CurrentThread.CurrentCulture=System.Globalization.CultureInfo.GetCultureInfo("en-US");
  AppContext.SetSwitch("Switch.UseLegacyAccessibilityFeatures",false);AppContext.SetSwitch("Switch.UseLegacyAccessibilityFeatures.2",false);AppContext.SetSwitch("Switch.UseLegacyAccessibilityFeatures.3",false);
  string selectedInstall=Arg(args,"--install-dir",File.Exists(Path.Combine(Base,".ygpt-install.json"))?Base:HostCore.DefaultInstallDir());
  string data=Arg(args,"--data-dir",HostCore.DataDir(selectedInstall));
  if(args.Contains("--apply-update")){ApplyUpdate(Arg(args,"--install-dir",Base),data);return;}
  if(args.Contains("--background")){Background(data);return;}
  if(args.Contains("--approvals")){var reviewApp=new Application();reviewApp.Run(new ApprovalWindow(data));return;}
  if(args.Contains("--uninstall-worker")){RemoveInstall(Arg(args,"--install-dir",Base),data);return;}
  if(args.Contains("--self-test")){var b=Encoding.UTF8.GetBytes("YGPT fixture");if(!b.SequenceEqual(ProtectedData.Unprotect(ProtectedData.Protect(b,null,DataProtectionScope.CurrentUser),null,DataProtectionScope.CurrentUser)))Environment.Exit(2);return;}
  bool ownSetup;using(var setupOwner=new Mutex(true,"Local\\YGPT-setup-"+HostCore.OwnerId(data),out ownSetup)){if(!ownSetup)return;
  if(args.Contains("--update")||Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location).IndexOf("Update",StringComparison.OrdinalIgnoreCase)>=0){ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;var updateApp=new Application();updateApp.Run(new UpdateWindow());return;}
  ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
  var app=new Application();var w=new SetupWindow(data,selectedInstall);
  if(args.Contains("--uninstall"))w.Loaded+=(s,e)=>w.Uninstall();app.Run(w);}
 }catch(Exception ex){if(args.Contains("--apply-update")){try{string target=Arg(args,"--install-dir",Base),errors=Path.Combine(target,".updates");Directory.CreateDirectory(errors);HostCore.Save(Path.Combine(errors,"last-update-error.json"),new{product="YGPT Local",version=Version,message=ex.Message,at=DateTime.UtcNow.ToString("o")});}catch{}Environment.ExitCode=1;return;}MessageBox.Show(ex.Message,"YGPT Local",MessageBoxButton.OK,MessageBoxImage.Error);Environment.ExitCode=1;}}
 public static string Hash(string file){using(var s=File.OpenRead(file))using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(s)).Replace("-","").ToLowerInvariant();}
 public static string RandomKey(){var b=new byte[32];using(var r=RandomNumberGenerator.Create())r.GetBytes(b);return Convert.ToBase64String(b).TrimEnd('=').Replace('+','-').Replace('/','_');}
 public static Dictionary<string,object> Read(string p){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(p));}
 public static void PrivateDirectory(string p){Directory.CreateDirectory(p);CheckPath(p);var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);foreach(var sid in new[]{WindowsIdentity.GetCurrent().User,new SecurityIdentifier("S-1-5-18")})acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(p,acl);}
 public static void CheckPath(string p){string x=Path.GetFullPath(p);if(x.TrimEnd('\\')==Path.GetPathRoot(x).TrimEnd('\\'))throw new Exception("A drive root is not an application folder");for(string t=x;!String.IsNullOrEmpty(t);t=Path.GetDirectoryName(t)){if(Directory.Exists(t)&&(File.GetAttributes(t)&FileAttributes.ReparsePoint)!=0)throw new Exception("Linked installation/data paths are not supported");}}
 public static Dictionary<string,object> Secrets(string data){string p=Path.Combine(data,"credentials.dpapi");if(!File.Exists(p))return new Dictionary<string,object>();string s=File.ReadAllText(p);if(!s.StartsWith("dpapi:"))throw new Exception("Unencrypted credentials refused");return Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s.Substring(6)),null,DataProtectionScope.CurrentUser)));}
 public static void SaveSecrets(string data,Dictionary<string,object> s){PrivateDirectory(data);string p=Path.Combine(data,"credentials.dpapi");if(File.Exists(p)){if(Json.Serialize(Secrets(data))==Json.Serialize(s))return;File.Copy(p,p+".before-"+DateTime.UtcNow.Ticks);}HostCore.SaveText(p,"dpapi:"+Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Serialize(s)),null,DataProtectionScope.CurrentUser)));}
 public static string Node(string install,string script,string arg,string input){var si=new ProcessStartInfo(Path.Combine(install,"runtimes","node","node.exe"),Q(Path.Combine(install,script))+" "+(String.IsNullOrEmpty(arg)?"":Q(arg))){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true,WorkingDirectory=install};si.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"]="1";si.EnvironmentVariables["PATH"]=Path.Combine(install,"runtimes","node")+";"+si.EnvironmentVariables["PATH"];using(var p=Process.Start(si)){var err=p.StandardError.ReadToEndAsync();var read=p.StandardOutput.ReadToEndAsync();if(input!=null)p.StandardInput.Write(input);p.StandardInput.Close();if(!p.WaitForExit(180000)){p.Kill();throw new Exception("Setup timed out. Inspect configuration before retrying; external resource creation may need reconciliation.");}string output=read.Result.Trim();if(String.IsNullOrEmpty(output))throw new Exception("Local component failed. Check runtime files and Windows permissions.");return output;}}
 public static void StartBackground(string install,string data){HostCore.Start(install,data);}
 public static string UpgradeData(string install,string data){
  bool startup=HostCore.B(HostCore.Read(Path.Combine(data,"connection.json")),"autoStart");
  bool moved=!String.Equals(HostCore.Full(data),HostCore.Full(HostCore.DataDir(install)),StringComparison.OrdinalIgnoreCase);
  if(moved)HostCore.RegisterTask(install,data,false);
  try{
   var r=ReadUpgradeResult(Node(install,"service/upgrade.mjs",null,Json.Serialize(new{install=install,data=data})));
   string next=HostCore.S(r,"data");Register(install,next,startup);
   if(moved){string key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\YGPTLocal-"+HostCore.OwnerId(data).Substring(0,12);bool owned=false;using(var k=Registry.CurrentUser.OpenSubKey(key)){owned=k!=null&&String.Equals(Convert.ToString(k.GetValue("InstallLocation")),install,StringComparison.OrdinalIgnoreCase);}if(owned)Registry.CurrentUser.DeleteSubKeyTree(key,false);string old=ShortcutPath(data);if(old!=ShortcutPath(next)&&File.Exists(old))File.Delete(old);}
   return next;
  }catch{if(moved&&Directory.Exists(data))HostCore.RegisterTask(install,data,startup);throw;}
 }
 static Dictionary<string,object> ReadUpgradeResult(string value){var r=Json.Deserialize<Dictionary<string,object>>(value);if(!HostCore.B(r,"ok"))throw new Exception(HostCore.S(r,"message","Data upgrade failed"));return r;}
 public static void ApplyUpdate(string install,string data){
  bool wasPaused=File.Exists(Path.Combine(data,"paused"));ValidateInstallTarget(install);HostCore.PrepareOwnedRepair(install,data);
  string current=data;
  try{InstallPayload(install);current=UpgradeData(install,data);HostCore.Start(install,current);HostCore.Save(Path.Combine(install,".updates","last-update.json"),new{product="YGPT Local",version=Version,data=current,started=true,at=DateTime.UtcNow.ToString("o")});}
  catch{if(!Directory.Exists(current)&&Directory.Exists(HostCore.DataDir(install)))current=HostCore.DataDir(install);if(!wasPaused&&Directory.Exists(current)&&File.Exists(Path.Combine(current,"ygpt.config.json")))HostCore.Start(install,current);throw;}
 }
 public static Dictionary<string,object> LocalRequest(string data,string route,bool post){var c=Read(Path.Combine(data,"ygpt.config.json"));var s=Secrets(data);var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+Convert.ToString(c["port"])+route);req.Timeout=15000;req.Headers["Authorization"]="Bearer "+s["localKey"];if(post){req.Method="POST";req.ContentLength=0;}using(var r=req.GetResponse())using(var reader=new StreamReader(r.GetResponseStream()))return Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());}
 public static bool IsOwnService(string data,int port){try{var c=Read(Path.Combine(data,"ygpt.config.json"));return Convert.ToInt32(c["port"])==port&&Convert.ToString(LocalRequest(data,"/healthz",false)["product"])=="YGPT Local";}catch{return false;}}
 public static void StopForMaintenance(string data){if(File.Exists(Path.Combine(data,"connection.json"))&&HostCore.S(HostCore.Read(Path.Combine(data,"connection.json")),"architecture").StartsWith("watchdog-")){HostCore.Pause(data);return;}if(!File.Exists(Path.Combine(data,"ygpt.config.json")))return;bool connected=false;try{LocalRequest(data,"/healthz",false);connected=true;}catch(WebException ex){if(ex.Status!=WebExceptionStatus.ConnectFailure)throw new Exception("Could not confirm the existing local service identity. Close active tasks and retry.");}
  DateTime requested=DateTime.UtcNow;if(connected){var r=LocalRequest(data,"/maintenance/drain",true);if(!(bool)r["safeToStop"])throw new Exception("Finish owned tasks and pending approvals before maintenance.");}File.WriteAllText(Path.Combine(data,"paused"),"owner maintenance");
  for(int i=0;i<150;i++){bool stopped=false;try{var p=Path.Combine(data,"service-health.json");stopped=File.Exists(p)&&File.GetLastWriteTimeUtc(p)>=requested&&Read(p).ContainsKey("stopped")&&(bool)Read(p)["stopped"];}catch{}if(stopped||!connected){Thread.Sleep(1200);return;}Thread.Sleep(200);}throw new Exception("The existing service has not stopped safely. No application files were replaced.");}
 public static void Background(string data){HostCore.Start(Base,data);}
 public static string ShortcutPath(string data){return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),"Programs","YGPT Local"+(String.Equals(Path.GetFullPath(data),Path.GetFullPath(DefaultData),StringComparison.OrdinalIgnoreCase)?"":" - "+HostCore.OwnerId(data).Substring(0,8))+".lnk");}
 public static void Shortcut(string install,string data,string shortcutPath=null){string p=shortcutPath??ShortcutPath(data);object shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));object link=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{p});var t=link.GetType();t.InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{Path.Combine(install,"YGPTLocal.exe")});t.InvokeMember("Arguments",BindingFlags.SetProperty,null,link,new object[]{"--data-dir "+Q(data)});t.InvokeMember("IconLocation",BindingFlags.SetProperty,null,link,new object[]{Path.Combine(install,"assets","ygpt-"+Version+".ico")+",0"});t.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);}
 public static void Register(string install,string data,bool startup){string id=HostCore.OwnerId(data).Substring(0,12);using(var k=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\YGPTLocal-"+id)){k.SetValue("DisplayName","YGPT Local");k.SetValue("DisplayVersion",Version);k.SetValue("DisplayIcon",Path.Combine(install,"YGPTLocal.exe"));k.SetValue("InstallLocation",install);k.SetValue("UninstallString",Q(Path.Combine(install,"YGPTLocal.exe"))+" --uninstall --data-dir "+Q(data));}HostCore.RegisterTask(install,data,startup);Shortcut(install,data);RefreshIconCache();}
 public static void ValidateInstallTarget(string target){
  CheckPath(target);string marker=Path.Combine(target,".ygpt-install.json");
  if(Directory.Exists(target)&&Directory.GetFileSystemEntries(target).Length>0&&!File.Exists(marker))
   throw new InvalidOperationException("The Application folder already contains files. Choose a NEW EMPTY installation folder (for example, the default under AppData\\Local\\Programs). Do not select the downloaded or extracted portable ZIP folder. No files were changed.");
  if(File.Exists(marker)){var old=Read(marker);
   if((string)old["product"]!="YGPT Local"||!String.Equals(Path.GetFullPath((string)old["installRoot"]),Path.GetFullPath(target),StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("This folder belongs to a different installation. Select the original YGPT Local path for Repair or choose a separate empty folder.");
  }
 }
 public static void InstallPayload(string install){
  using(var payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("YGPT.Payload"))InstallPayload(install,payload);
 }
 // A separate stream entrypoint lets disposable native fixtures exercise the
 // actual archive validation and directory transaction without an installer.
 internal static void InstallPayload(string install,Stream payload){
  ValidateInstallTarget(install);
  if(payload==null){
   if(!String.Equals(HostCore.Full(Assembly.GetExecutingAssembly().Location),Path.Combine(HostCore.Full(install),"YGPTLocal.exe"),StringComparison.OrdinalIgnoreCase)||!File.Exists(Path.Combine(install,".ygpt-install.json")))throw new Exception("Use the complete Setup package to install or upgrade. Installed Settings can reconfigure its own verified runtime.");
   var existing=Read(Path.Combine(install,"manifest.json"));
   foreach(object item in (System.Collections.IEnumerable)existing["files"]){var f=(Dictionary<string,object>)item;string file=Path.GetFullPath(Path.Combine(install,(string)f["path"]));HostCore.CheckPath(file);if(!HostCore.Within(file,install)||!File.Exists(file)||Hash(file)!=(string)f["sha256"])throw new Exception("Runtime integrity needs repair using the full Setup package.");}
   return;
  }
  string transaction=Path.Combine(install,".updates",Guid.NewGuid().ToString("N"));
  string stage=Path.Combine(transaction,"staging"),previous=Path.Combine(transaction,"previous");
  try{
   CheckPath(stage);Directory.CreateDirectory(stage);long total=0;
   using(var zip=new ZipArchive(payload,ZipArchiveMode.Read,true)){
    foreach(var e in zip.Entries){
     if(e.FullName.EndsWith("/")||e.FullName.EndsWith("\\"))continue;
     string rel=e.FullName.Replace('/','\\'),target=Path.GetFullPath(Path.Combine(stage,rel));
     string first=rel.Split('\\')[0];if(String.Equals(first,"data",StringComparison.OrdinalIgnoreCase)||first.StartsWith(".",StringComparison.Ordinal)&&first!=".ygpt-install.json")throw new Exception("Reserved installation path in payload");
     if(!target.StartsWith(Path.GetFullPath(stage)+"\\",StringComparison.OrdinalIgnoreCase)||rel.Contains(":")||(e.ExternalAttributes>>16&0xF000)==0xA000)throw new Exception("Unsafe archive entry");
     total+=e.Length;if(total>1024L*1024*1024)throw new Exception("Payload exceeds expected bounds");
     Directory.CreateDirectory(Path.GetDirectoryName(target));using(var input=e.Open())using(var output=new FileStream(target,FileMode.CreateNew))input.CopyTo(output);
    }
   }
   var manifest=Read(Path.Combine(stage,"manifest.json"));
   if(HostCore.S(manifest,"product")!="YGPT Local"||HostCore.S(manifest,"version")!=Version)throw new Exception("Installation payload version or product does not match this setup");
   foreach(object record in (System.Collections.IEnumerable)manifest["files"]){var f=(Dictionary<string,object>)record;string rel=(string)f["path"],p=Path.GetFullPath(Path.Combine(stage,rel));if(!p.StartsWith(Path.GetFullPath(stage)+"\\",StringComparison.OrdinalIgnoreCase)||Hash(p)!=(string)f["sha256"])throw new Exception("Installation payload integrity failed");}
   // Commit the ownership marker before moving the current installation. A
   // failed marker write must leave the existing application repairable.
   HostCore.Save(Path.Combine(stage,".ygpt-install.json"),new{product="YGPT Local",version=Version,installRoot=Path.GetFullPath(install)});
   // Swap only application members. Data and update transactions never leave
   // the chosen root. A failed commit restores every moved member.
   Directory.CreateDirectory(previous);
   var moved=new List<string>();var added=new List<string>();
   try{
    foreach(string member in Directory.GetFileSystemEntries(stage)){
     string name=Path.GetFileName(member),dest=Path.Combine(install,name),old=Path.Combine(previous,name);
     HostCore.CheckPath(dest);
     if(Directory.Exists(dest)){MoveDirectoryWithRetry(dest,old);moved.Add(name);}
     else if(File.Exists(dest)){File.Move(dest,old);moved.Add(name);}
     if(Directory.Exists(member))MoveDirectoryWithRetry(member,dest);else File.Move(member,dest);
     added.Add(name);
    }
   }catch{
    foreach(string name in added){string dest=Path.Combine(install,name);if(Directory.Exists(dest))Directory.Delete(dest,true);else if(File.Exists(dest))File.Delete(dest);}
    foreach(string name in moved){string old=Path.Combine(previous,name),dest=Path.Combine(install,name);if(Directory.Exists(old))MoveDirectoryWithRetry(old,dest);else if(File.Exists(old))File.Move(old,dest);}
    throw;
   }
  }finally{
   // Corrupt archives and failed verification must not leak a payload-sized
   // directory. Only this invocation's unique staging directory is eligible.
   try{if(Directory.Exists(stage)){CheckPath(stage);Directory.Delete(stage,true);}if(Directory.Exists(previous)&&Directory.GetFileSystemEntries(previous).Length==0)Directory.Delete(previous);if(Directory.Exists(transaction)&&Directory.GetFileSystemEntries(transaction).Length==0)Directory.Delete(transaction);}catch{}
  }
 }
 // Directory moves over a live previous install can lose a brief race with the
 // outgoing processes and with antivirus scans; retry for a few seconds
 // before bothering the owner (added after the rc.9-over-rc.8 field report).
 static void MoveDirectoryWithRetry(string from,string to){for(int attempt=0;;attempt++){try{Directory.Move(from,to);return;}catch(IOException){if(attempt>=9)throw;Thread.Sleep(400);}catch(UnauthorizedAccessException){if(attempt>=9)throw;Thread.Sleep(400);}}}
 static void DeleteEmptyDirectoryWithRetry(string path){for(int attempt=0;;attempt++){try{Directory.Delete(path,false);return;}catch(IOException){if(attempt>=9)throw;Thread.Sleep(400);}catch(UnauthorizedAccessException){if(attempt>=9)throw;Thread.Sleep(400);}}}
 [System.Runtime.InteropServices.DllImport("shell32.dll")]static extern void SHChangeNotify(uint wEventId,uint uFlags,IntPtr dwItem1,IntPtr dwItem2);
 // Windows caches one icon rendering per app path; after an upgrade the cache
 // can keep serving the old (possibly low-resolution) image. Nudge it.
 public static void RefreshIconCache(){try{SHChangeNotify(0x08000000,0,IntPtr.Zero,IntPtr.Zero);}catch{}}
 public static string HousekeepingText(Dictionary<string,object> report){var r=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(report));var text=new StringBuilder();text.AppendLine("State: "+HostCore.S(r,"state"));text.AppendLine("Files removed: "+HostCore.S(r,"removedFiles","0"));text.AppendLine("Space reclaimed: "+(Convert.ToInt64(r.ContainsKey("bytesReclaimed")?r["bytesReclaimed"]:0)/1048576.0).ToString("F1")+" MiB");text.AppendLine("Rollback copies removed: "+HostCore.S(r,"removedRollbackCopies","0"));text.AppendLine("Verified rollback retained: "+HostCore.S(r,"retainedRollback","not available"));text.AppendLine("Obsolete registrations removed: "+HostCore.S(r,"removedRegistrations","0"));text.AppendLine("Private data, file snapshots and developer folders are kept.");if(HostCore.S(r,"reason")!="")text.AppendLine("Action needed: "+HostCore.S(r,"reason"));text.AppendLine();if(r.ContainsKey("items"))foreach(object value in (System.Collections.IEnumerable)r["items"]){var item=(Dictionary<string,object>)value;text.AppendLine(HostCore.S(item,"outcome").ToUpperInvariant()+" — "+HostCore.S(item,"kind"));text.AppendLine(HostCore.S(item,"path"));text.AppendLine(HostCore.S(item,"reason"));text.AppendLine();}return text.ToString();}
 static string DownloadCleanupNote(string data){try{var r=HostCore.Read(Path.Combine(data,"post-install-cleanup-receipt.json"));if(HostCore.S(r,"state")=="review-required")return "Registered download cleanup needs review\n"+HostCore.S(r,"reason")+"\n\n";}catch{}return "";}
 public static Window CreateHousekeepingResultWindow(Dictionary<string,object> report,string install,string data){
  var w=new Window{Title="YGPT Local — Installation cleanup",Width=860,Height=740,MinWidth=680,MinHeight=560,WindowStartupLocation=WindowStartupLocation.CenterOwner,FontFamily=new FontFamily("Segoe UI Variable Text, Segoe UI"),FontSize=15,Background=new SolidColorBrush(Color.FromRgb(247,251,254)),Foreground=new SolidColorBrush(Color.FromRgb(15,42,68))};AutomationProperties.SetAutomationId(w,"ygpt.installation-cleanup");var root=new DockPanel{Margin=new Thickness(26)};w.Content=root;
  var footer=new WrapPanel{Margin=new Thickness(0,16,0,0)};DockPanel.SetDock(footer,Dock.Bottom);root.Children.Add(footer);var head=new StackPanel();DockPanel.SetDock(head,Dock.Top);root.Children.Add(head);var title=new TextBlock{Text="Review installation leftovers",FontSize=25,FontWeight=FontWeights.SemiBold,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,12)};AutomationProperties.SetLiveSetting(title,AutomationLiveSetting.Assertive);head.Children.Add(title);head.Children.Add(new TextBlock{Text="Only verified installer caches and obsolete YGPT registrations are eligible. One verified rollback is retained; private data and developer folders are kept.",TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,16)});var text=new TextBox{Text=DownloadCleanupNote(data)+HousekeepingText(report),IsReadOnly=true,FontFamily=new FontFamily("Consolas"),FontSize=13,TextWrapping=TextWrapping.Wrap,Padding=new Thickness(12),VerticalScrollBarVisibility=ScrollBarVisibility.Auto};root.Children.Add(text);bool cleaning=false;
  foreach(string label in new[]{"Clean verified leftovers","Copy details","Open application folder","Close"}){string action=label;var button=new Button{Content=label,Padding=new Thickness(14,9,14,9),MinHeight=44,Margin=new Thickness(0,0,8,8),Background=new SolidColorBrush(Color.FromRgb(197,233,252)),Foreground=w.Foreground};footer.Children.Add(button);button.Click+=async(s,e)=>{if(action=="Close"){w.Close();return;}if(action=="Copy details"){try{await SetupInteractions.CopyText(text.Text);title.Text="Details copied";}catch(ClipboardBusyException ex){title.Text=ex.Message;}catch(Exception ex){title.Text="Copy could not finish: "+ex.Message;}return;}if(action=="Open application folder"){Process.Start(new ProcessStartInfo(install){UseShellExecute=true});return;}if(cleaning)return;cleaning=true;button.IsEnabled=false;title.Text="Cleaning verified leftovers…";try{report=await Task.Run(()=>InstallationHousekeeping.Run(install,data,true));text.Text=DownloadCleanupNote(data)+HousekeepingText(report);title.Text=HostCore.S(report,"state")=="deferred"?"Cleanup is waiting for a healthy connection":"Cleanup finished — review the result";}catch(Exception ex){title.Text="Cleanup could not finish";text.Text=ex.Message+"\n\n"+text.Text;}finally{cleaning=false;button.IsEnabled=true;}};}w.Closing+=(s,e)=>{if(cleaning){e.Cancel=true;title.Text="Please wait for cleanup to finish";}};return w;
 }

 public static Dictionary<string,object> RemoveOwnedFiles(string install,string data){
  install=HostCore.Full(install);data=HostCore.Full(data);CheckPath(install);var marker=Read(Path.Combine(install,".ygpt-install.json"));
  if(HostCore.S(marker,"product")!="YGPT Local"||!String.Equals(HostCore.Full(HostCore.S(marker,"installRoot")),install,StringComparison.OrdinalIgnoreCase))throw new Exception("Installation identity mismatch; nothing removed");
  var manifest=Read(Path.Combine(install,"manifest.json"));var entries=new List<Dictionary<string,object>>();var known=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var parents=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var retained=new List<Dictionary<string,string>>();
  foreach(object r in (System.Collections.IEnumerable)manifest["files"]){var entry=(Dictionary<string,object>)r;string rel=HostCore.S(entry,"path"),p=Path.GetFullPath(Path.Combine(install,rel));if(!p.StartsWith(install+"\\",StringComparison.OrdinalIgnoreCase)||!System.Text.RegularExpressions.Regex.IsMatch(HostCore.S(entry,"sha256"),"^[a-fA-F0-9]{64}$"))throw new Exception("Unsafe uninstall entry; no application files removed");entry=new Dictionary<string,object>(entry);entry["fullPath"]=p;entries.Add(entry);known.Add(p);}
  int removed=0,missing=0,changed=0,blocked=0;long bytes=0;string updates=Path.Combine(install,".updates");
  foreach(var entry in entries){string p=HostCore.S(entry,"fullPath"),rel=HostCore.S(entry,"path");if(HostCore.Within(p,data)||HostCore.Within(p,updates)){retained.Add(new Dictionary<string,string>{{"path",rel},{"reason","private data or recovery files"}});continue;}if(!File.Exists(p)){missing++;continue;}
   try{HostCore.CheckPath(p);if(!String.Equals(Hash(p),HostCore.S(entry,"sha256"),StringComparison.OrdinalIgnoreCase)){changed++;retained.Add(new Dictionary<string,string>{{"path",rel},{"reason","changed since installation"}});continue;}long size=new FileInfo(p).Length;File.Delete(p);removed++;bytes+=size;for(string parent=Path.GetDirectoryName(p);parent!=install&&HostCore.Within(parent,install);parent=Path.GetDirectoryName(parent))parents.Add(parent);}
   catch(Exception e){blocked++;retained.Add(new Dictionary<string,string>{{"path",rel},{"reason","could not remove: "+e.Message}});}
  }
  foreach(string parent in parents.OrderByDescending(p=>p.Length)){try{if(!HostCore.Within(parent,data)&&!HostCore.Within(parent,updates)&&Directory.Exists(parent)&&!Directory.EnumerateFileSystemEntries(parent).Any()){HostCore.CheckPath(parent);Directory.Delete(parent);}}catch{}}
  if(blocked==0&&changed==0){foreach(string name in new[]{"manifest.json",".ygpt-install.json"})try{File.Delete(Path.Combine(install,name));}catch(Exception e){blocked++;retained.Add(new Dictionary<string,string>{{"path",name},{"reason","could not remove: "+e.Message}});}}
  else retained.Add(new Dictionary<string,string>{{"path","manifest.json / .ygpt-install.json"},{"reason","kept for repair after incomplete removal"}});
  var pending=new Queue<string>();pending.Enqueue(install);int inspected=0;bool truncated=false;
  while(pending.Count>0){string dir=pending.Dequeue();try{foreach(string p in Directory.EnumerateFileSystemEntries(dir)){if(++inspected>2000){truncated=true;break;}if(HostCore.Within(p,data)||HostCore.Within(p,updates)||known.Contains(p)||Path.GetFileName(p)=="manifest.json"||Path.GetFileName(p)==".ygpt-install.json")continue;var a=File.GetAttributes(p);if((a&FileAttributes.ReparsePoint)!=0){retained.Add(new Dictionary<string,string>{{"path",p.Substring(install.Length+1)},{"reason","unregistered link; kept"}});continue;}if((a&FileAttributes.Directory)!=0)pending.Enqueue(p);else retained.Add(new Dictionary<string,string>{{"path",p.Substring(install.Length+1)},{"reason","unregistered user file; kept"}});}}catch(Exception e){retained.Add(new Dictionary<string,string>{{"path",dir},{"reason","inventory unavailable: "+e.Message}});}if(truncated)break;}
  retained.Add(new Dictionary<string,string>{{"path",data},{"reason","private settings, encrypted credentials and snapshots; kept intentionally"}});if(Directory.Exists(updates))retained.Add(new Dictionary<string,string>{{"path",updates},{"reason","update/recovery records and this uninstaller; kept for review"}});
  return new Dictionary<string,object>{{"product","YGPT Local"},{"version",Version},{"at",DateTime.UtcNow.ToString("o")},{"state",blocked>0||changed>0?"files-remain":"removed-data-kept"},{"removedFiles",removed},{"removedBytes",bytes},{"alreadyMissing",missing},{"changedFilesKept",changed},{"blockedFiles",blocked},{"privateData",data},{"applicationFolder",install},{"inventoryTruncated",truncated},{"retained",retained}};
 }
 public static Window CreateUninstallResultWindow(Dictionary<string,object> report){
  bool partial=HostCore.S(report,"state")=="files-remain";string data=HostCore.S(report,"privateData"),install=HostCore.S(report,"applicationFolder");
  var w=new Window{Title="YGPT Local — Uninstall result",Width=800,Height=700,MinWidth=640,MinHeight=560,WindowStartupLocation=WindowStartupLocation.CenterScreen,FontFamily=new FontFamily("Segoe UI Variable Text, Segoe UI"),FontSize=15,Background=new SolidColorBrush(Color.FromRgb(247,251,254)),Foreground=new SolidColorBrush(Color.FromRgb(15,42,68))};AutomationProperties.SetAutomationId(w,"ygpt.uninstall-result");
  var root=new DockPanel{Margin=new Thickness(28)};w.Content=root;var footer=new WrapPanel{Margin=new Thickness(0,16,0,0)};DockPanel.SetDock(footer,Dock.Bottom);root.Children.Add(footer);
  string title=partial?"Uninstall finished with files remaining":"Uninstall complete — private data kept";string details="Application files removed: "+report["removedFiles"]+"\nAlready absent: "+report["alreadyMissing"]+"\nChanged files kept: "+report["changedFilesKept"]+"\nCould not remove: "+report["blockedFiles"]+"\n\nPrivate data: "+data+"\n\nRetained paths:\n";
  foreach(var item in (List<Dictionary<string,string>>)report["retained"])details+=item["path"]+" — "+item["reason"]+"\n";if(HostCore.B(report,"inventoryTruncated"))details+="\nInventory limit reached. Review the retained folder for additional files.\n";if(report.ContainsKey("registrationWarnings"))details+="\nWindows registration notes: "+report["registrationWarnings"];
  foreach(string label in new[]{"Open retained folder","Copy details","Close"}){string selected=label;var b=new Button{Content=label,Padding=new Thickness(16,9,16,9),MinHeight=44,Margin=new Thickness(0,0,10,0),Background=new SolidColorBrush(Color.FromRgb(197,233,252)),Foreground=w.Foreground};b.Click+=async(s,e)=>{if(selected=="Close")w.Close();else if(selected=="Copy details"){try{await SetupInteractions.CopyText(title+"\n\n"+details);b.Content="Copied";}catch(ClipboardBusyException){b.Content="Clipboard busy — try again";}catch(Exception){b.Content="Copy failed — try again";}}else Process.Start(new ProcessStartInfo(install){UseShellExecute=true});};footer.Children.Add(b);}
  var content=new StackPanel();root.Children.Add(new ScrollViewer{Content=content,VerticalScrollBarVisibility=ScrollBarVisibility.Auto});var heading=new TextBlock{Text=title,FontSize=25,FontWeight=FontWeights.SemiBold,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,16)};AutomationProperties.SetLiveSetting(heading,AutomationLiveSetting.Assertive);content.Children.Add(new Border{Background=new SolidColorBrush(partial?Color.FromRgb(255,246,229):Color.FromRgb(234,247,239)),Padding=new Thickness(18),CornerRadius=new CornerRadius(10),Child=heading});content.Children.Add(new TextBlock{Text=partial?"Some application files were changed, locked or inaccessible. Review the list below before removing anything manually.":"The registered application files were removed. Your private data and recovery records remain so you can restore or reinstall later.",TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,18,0,16)});content.Children.Add(new TextBox{Text=details,IsReadOnly=true,TextWrapping=TextWrapping.Wrap,FontFamily=new FontFamily("Consolas"),FontSize=13,BorderThickness=new Thickness(1),Padding=new Thickness(14),VerticalScrollBarVisibility=ScrollBarVisibility.Auto,MinHeight=180,MaxHeight=360});return w;
 }
 public static void ValidateUninstallData(string install,string data){if(!String.Equals(HostCore.Full(data),HostCore.Full(HostCore.DataDir(install)),StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("This uninstall entry points to an obsolete data folder. Open the current YGPT Local settings instead. No connection or application files were changed.");}
 public static void RemoveInstall(string install,string data){
  ValidateUninstallData(install,data);StopForMaintenance(data);HostCore.RegisterTask(install,data,false);var report=RemoveOwnedFiles(install,data);var warnings=new List<string>();
  try{using(var k=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){string value=Convert.ToString(k.GetValue("YGPTLocal"));if(value.StartsWith(Q(Path.Combine(install,"YGPTLocal.exe")),StringComparison.OrdinalIgnoreCase)&&value.IndexOf(Q(data),StringComparison.OrdinalIgnoreCase)>=0)k.DeleteValue("YGPTLocal",false);}
   string registration="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\YGPTLocal-"+HostCore.OwnerId(data).Substring(0,12);bool ownsRegistration=false;using(var k=Registry.CurrentUser.OpenSubKey(registration)){ownsRegistration=k!=null&&String.Equals(Convert.ToString(k.GetValue("InstallLocation")),install,StringComparison.OrdinalIgnoreCase);}if(ownsRegistration){Registry.CurrentUser.DeleteSubKeyTree(registration,false);string link=ShortcutPath(data);if(File.Exists(link)){object shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));object shortcut=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{link});if(String.Equals(Convert.ToString(shortcut.GetType().InvokeMember("TargetPath",BindingFlags.GetProperty,null,shortcut,null)),Path.Combine(install,"YGPTLocal.exe"),StringComparison.OrdinalIgnoreCase))File.Delete(link);}}
  }catch(Exception e){warnings.Add(e.Message);report["state"]="files-remain";}
  report["registrationWarnings"]=String.Join("\n",warnings);try{HostCore.Save(Path.Combine(data,"uninstall-report.json"),report);}catch(Exception e){report["registrationWarnings"]="Report could not be saved: "+e.Message;}
  var window=CreateUninstallResultWindow(report);if(Application.Current==null)new Application().Run(window);else window.ShowDialog();
 }

}
