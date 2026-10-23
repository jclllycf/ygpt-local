using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Automation;
using Microsoft.Win32;

// YGPT Local updater: upgrades an existing installation in place. It never
// uninstalls, never re-provisions and never touches the owner's ChatGPT
// plugin, credentials or connection identity — it pauses the owned
// connection, swaps the application payload, optionally saves the brand
// choice, and starts the connection again. Entered via --update or when the
// exe file name contains "Update" (the YGPTLocal-Update package).
public class UpdateWindow:Window{
 static readonly string Mint="#0369A1",Ink="#0F2A44",Muted="#5B6F84",Line="#D9E7F2",Cream="#F7FBFE";
 static readonly string[] BrandIconFiles={"plugin-icon-256.png","ygpt-local-green-y-256.png","ygpt-local-sky-y-256.png","ygpt-local-green-256.png","ygpt-local-signature-256.png"};
 static readonly string[] BrandIconResources={"YGPT.Brand","YGPT.BrandGreenY","YGPT.BrandSkyY","YGPT.BrandGreen","YGPT.BrandSignature"};
 readonly List<string[]> installs;
 readonly StackPanel body=new StackPanel();
 readonly TextBlock log=new TextBlock{TextWrapping=TextWrapping.Wrap,FontSize=13,Foreground=B(Muted),Margin=new Thickness(0,12,0,0)};
 readonly Button updateButton=new Button{Content="Update now",MinWidth=140,MinHeight=42,HorizontalAlignment=HorizontalAlignment.Left};
 readonly ComboBox installChoice=new ComboBox{MinHeight=36,Margin=new Thickness(0,0,0,10)};
 readonly StackPanel pickerHost=new StackPanel();
 readonly StackPanel summary=new StackPanel();
 string install="",data="",brandIcon="plugin-icon-256.png",approvalStyle="current";
 readonly List<Border> iconTiles=new List<Border>();
 Border previewHost;
 bool busy=false,idleWait=false,closed=false;
 static SolidColorBrush B(string s){return (SolidColorBrush)new BrushConverter().ConvertFromString(s);}
 public UpdateWindow():this(DiscoverInstalls()){}
 internal UpdateWindow(List<string[]> availableInstalls){
  installs=availableInstalls;
  Title="YGPT Local — Update";Width=760;Height=760;MinWidth=680;MinHeight=620;WindowStartupLocation=WindowStartupLocation.CenterScreen;FontFamily=new FontFamily("Segoe UI");FontSize=14;Background=B(Cream);Foreground=B(Ink);
  var root=new DockPanel{Margin=new Thickness(28,22,28,22)};Content=root;
  var head=new StackPanel{Orientation=Orientation.Horizontal,Margin=new Thickness(0,0,0,14)};DockPanel.SetDock(head,Dock.Top);root.Children.Add(head);
  BitmapSource brand=null;using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("YGPT.Brand")){if(stream!=null){var b=new BitmapImage();b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.StreamSource=stream;b.EndInit();brand=b;}}
  if(brand!=null)head.Children.Add(new Image{Source=brand,Width=44,Height=44,Margin=new Thickness(0,0,14,0)});
  var titles=new StackPanel();titles.Children.Add(new TextBlock{Text="Update YGPT Local",FontSize=22,FontWeight=FontWeights.SemiBold});titles.Children.Add(new TextBlock{Text="In place. Nothing is uninstalled, and your ChatGPT plugin stays connected.",FontSize=13,Foreground=B(Muted)});head.Children.Add(titles);
  var scroll=new ScrollViewer{Content=body,VerticalScrollBarVisibility=ScrollBarVisibility.Auto};root.Children.Add(scroll);
  if(installs.Count==0){
   Text("No existing YGPT Local installation was found on this PC.",14,true);
   Text("The update package upgrades an installed copy. For a first install, run the full Setup package instead.",13,false,Muted);
   return;
  }
  if(installs.Count>1){Text("Choose the installation to update",14,true);foreach(var entry in installs)installChoice.Items.Add(entry[2]+"  —  "+entry[0]);installChoice.SelectedIndex=0;installChoice.SelectionChanged+=(s,e)=>SelectInstall(installChoice.SelectedIndex);body.Children.Add(installChoice);}
  body.Children.Add(summary);body.Children.Add(pickerHost);
  SelectInstall(0);
  Closing+=(s,e)=>{if(busy&&!idleWait){e.Cancel=true;Log("Please wait for the update to finish before closing this window.");}};Closed+=(s,e)=>closed=true;
  updateButton.Click+=async(s,e)=>await RunUpdate();
  AutomationProperties.SetAutomationId(updateButton,"update-now");
  body.Children.Add(updateButton);body.Children.Add(log);
 }
 void Text(string s,double size=14,bool bold=false,string color=null){body.Children.Add(new TextBlock{Text=s,FontSize=size,FontWeight=bold?FontWeights.SemiBold:FontWeights.Normal,Foreground=B(color??Ink),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,10)});}
 void PickerText(Panel p,string s,double size,bool bold,string color){p.Children.Add(new TextBlock{Text=s,FontSize=size,FontWeight=bold?FontWeights.SemiBold:FontWeights.Normal,Foreground=B(color),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,8)});}
 static List<string[]> DiscoverInstalls(){
  var found=new List<string[]>();var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  System.Action<string,string> add=(inst,dat)=>{
   try{
    if(String.IsNullOrEmpty(inst)||String.IsNullOrEmpty(dat))return;
    inst=HostCore.Full(inst);dat=HostCore.Full(dat);
    string marker=Path.Combine(inst,".ygpt-install.json");
    if(!File.Exists(marker)||!File.Exists(Path.Combine(dat,"ygpt.config.json")))return;
    var m=YGPTApp.Read(marker);if(HostCore.S(m,"product")!="YGPT Local")return;
    if(seen.Add(inst+"|"+dat))found.Add(new[]{inst,dat,HostCore.S(m,"version","unknown")});
   }catch{}
  };
  try{
   using(var parent=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall")){
    if(parent!=null)foreach(string name in parent.GetSubKeyNames()){
     if(!name.StartsWith("YGPTLocal-",StringComparison.OrdinalIgnoreCase))continue;
     using(var k=parent.OpenSubKey(name)){
      if(k==null)continue;
      string loc=Convert.ToString(k.GetValue("InstallLocation")),un=Convert.ToString(k.GetValue("UninstallString")),dat="";
      int i=un.IndexOf("--data-dir ",StringComparison.Ordinal);
      if(i>=0)dat=un.Substring(i+"--data-dir ".Length).Trim().Trim('"');
      add(loc,dat);
     }
    }
   }
  }catch{}
  add(HostCore.DefaultInstallDir(),HostCore.DefaultDataDir());
  add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","YGPTLocal"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YGPTLocal"));
  // The Start Menu shortcut Setup created points at the real folders even if
  // the owner later moved them or changed download/install locations.
  try{
   string lnk=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"Microsoft","Windows","Start Menu","Programs","YGPT Local.lnk");
   if(File.Exists(lnk)){
    Type shellType=Type.GetTypeFromProgID("WScript.Shell");
    if(shellType!=null){
     dynamic shell=Activator.CreateInstance(shellType);dynamic shortcut=shell.CreateShortcut(lnk);
     string target=Convert.ToString(shortcut.TargetPath),args=Convert.ToString(shortcut.Arguments),dat="";
     int i=args.IndexOf("--data-dir ",StringComparison.Ordinal);if(i>=0)dat=args.Substring(i+"--data-dir ".Length).Trim().Trim('"');
     if(!String.IsNullOrEmpty(target))add(Path.GetDirectoryName(target),dat);
    }
   }
  }catch{}
  // Fixed-drive roots: fresh installs prefer a non-system drive, and owners
  // relocate folders; check each drive's YGPTLocal / YGPTLocalData pair.
  try{foreach(var d in DriveInfo.GetDrives()){if(d.DriveType!=DriveType.Fixed)continue;add(Path.Combine(d.RootDirectory.FullName,"YGPTLocal"),Path.Combine(d.RootDirectory.FullName,"YGPTLocalData"));}}catch{}
  return found;
 }
 void SelectInstall(int index){
  if(busy||index<0||index>=installs.Count)return;
  install=installs[index][0];data=installs[index][1];
  brandIcon="plugin-icon-256.png";approvalStyle="current";
  try{var c=YGPTApp.Read(Path.Combine(data,"ygpt.config.json"));string saved=HostCore.S(c,"brandIcon");if(Array.IndexOf(BrandIconFiles,saved)>=0)brandIcon=saved;approvalStyle=HostCore.S(c,"approvalStyle")=="legacy"?"legacy":"current";}catch{}
  // Rebuild the summary + picker for this target.
  summary.Children.Clear();
  summary.Children.Add(new TextBlock{Text="Installed: "+installs[index][2]+"   →   This update: "+HostCore.Version,FontSize=14,FontWeight=FontWeights.SemiBold,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,4)});
  summary.Children.Add(new TextBlock{Text=install,FontSize=12,Foreground=B(Muted),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,4)});
  summary.Children.Add(new TextBlock{Text="Kept as-is: settings, encrypted keys, connection identity, snapshots and your ChatGPT plugin.",FontSize=13,Foreground=B(Muted),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,12)});
  pickerHost.Children.Clear();BuildPicker(pickerHost);
 }
 BitmapSource BrandBitmap(int i){
  string file=Path.Combine(install,"assets","brand",BrandIconFiles[i]);if(File.Exists(file)){try{using(var stream=File.OpenRead(file)){var b=new BitmapImage();b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.StreamSource=stream;b.EndInit();b.Freeze();return b;}}catch{}}
  using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(BrandIconResources[i])){if(stream==null)return null;var b=new BitmapImage();b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.StreamSource=stream;b.EndInit();return b;}
 }
 void RefreshIconTiles(){for(int i=0;i<iconTiles.Count;i++)iconTiles[i].BorderBrush=B(BrandIconFiles[i]==brandIcon?Mint:Line);}
 void BuildPicker(Panel p){
  PickerText(p,"Approval icon",14,true,Ink);PickerText(p,"Shown on the approval strip in ChatGPT.",12,false,Muted);
  var row=new StackPanel{Orientation=Orientation.Horizontal,Margin=new Thickness(0,2,0,10)};p.Children.Add(row);iconTiles.Clear();
  for(int i=0;i<BrandIconFiles.Length;i++){int idx=i;var tile=new Border{Child=new Image{Source=BrandBitmap(idx),Width=44,Height=44,Margin=new Thickness(2)},BorderThickness=new Thickness(2),CornerRadius=new CornerRadius(9),Margin=new Thickness(0,0,8,0),Background=B("#FFFFFF")};tile.MouseLeftButtonUp+=(s,e)=>{brandIcon=BrandIconFiles[idx];RefreshIconTiles();RefreshBrandPreview();};AutomationProperties.SetAutomationId(tile,"brand-icon-"+idx);iconTiles.Add(tile);row.Children.Add(tile);}
  RefreshIconTiles();
  PickerText(p,"Approval strip style",14,true,Ink);
  var current=new RadioButton{Content="New strip — follows the icon you pick",GroupName="approvalstyle",MinHeight=32,Margin=new Thickness(0,2,0,2),IsChecked=approvalStyle!="legacy"};AutomationProperties.SetAutomationId(current,"approval-style-current");current.Checked+=(s,e)=>{approvalStyle="current";RefreshBrandPreview();};
  var legacy=new RadioButton{Content="Classic strip — the original design",GroupName="approvalstyle",MinHeight=32,Margin=new Thickness(0,2,0,2),IsChecked=approvalStyle=="legacy"};AutomationProperties.SetAutomationId(legacy,"approval-style-legacy");legacy.Checked+=(s,e)=>{approvalStyle="legacy";RefreshBrandPreview();};
  p.Children.Add(current);p.Children.Add(legacy);
  PickerText(p,"Preview",14,true,Ink);previewHost=new Border{Margin=new Thickness(0,2,0,12)};p.Children.Add(previewHost);RefreshBrandPreview();
 }
  void RefreshBrandPreview(){
  if(previewHost==null)return;
  string resource=approvalStyle=="legacy"?"YGPT.PreviewClassic":"YGPT.PreviewNew0";
  if(approvalStyle!="legacy")for(int i=0;i<BrandIconFiles.Length;i++)if(BrandIconFiles[i]==brandIcon)resource="YGPT.PreviewNew"+i;
  BitmapSource shot=null;using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)){if(stream!=null){var b=new BitmapImage();b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.StreamSource=stream;b.EndInit();shot=b;}}
  previewHost.Child=shot!=null?new Image{Source=shot,Stretch=Stretch.Uniform}:(UIElement)new TextBlock{Text=approvalStyle=="legacy"?"Classic strip - the original design.":"New strip - follows the icon you pick.",Foreground=B(Muted)};
 }
 void Log(string line){log.Text=log.Text.Length==0?line:log.Text+"\n"+line;}
 // Post-update housekeeping (owner request): retained program copies used
 // to pile up next to the application folder as <install>.previous-<ticks>
 // siblings, alongside staging folders left by interrupted runs. Retained
 // copies now live inside the application folder (.previous-<ticks>);
 // after a verified update, remove them from BOTH places. A folder is
 // deleted only when its own manifest or install marker identifies it as
 // a YGPT Local program copy — anything else is left untouched.
 List<string> CleanupUpdateBackups(string target){
  var removed=new List<string>();
  string full=HostCore.Full(target),parent=Path.GetDirectoryName(full),name=Path.GetFileName(full);
  var candidates=new List<string>();
  try{candidates.AddRange(Directory.GetDirectories(full,".previous-*"));}catch{}
  if(!String.IsNullOrEmpty(parent)){
   try{candidates.AddRange(Directory.GetDirectories(parent,name+".previous-*"));}catch{}
   try{candidates.AddRange(Directory.GetDirectories(parent,name+".staging-*"));}catch{}
  }
  foreach(string candidate in candidates){
   try{
    if(String.Equals(HostCore.Full(candidate),full,StringComparison.OrdinalIgnoreCase))continue;
    if((File.GetAttributes(candidate)&FileAttributes.ReparsePoint)!=0)continue;
    if(!IsYGPTProgramCopy(candidate))continue;
    Directory.Delete(candidate,true);removed.Add(Path.GetFileName(candidate));
   }catch{}
  }
  return removed;
 }
 bool IsYGPTProgramCopy(string dir){
  try{string manifest=Path.Combine(dir,"manifest.json");if(File.Exists(manifest)&&HostCore.S(YGPTApp.Read(manifest),"product")=="YGPT Local")return true;}catch{}
  try{string marker=Path.Combine(dir,".ygpt-install.json");if(File.Exists(marker)&&HostCore.S(YGPTApp.Read(marker),"product")=="YGPT Local")return true;}catch{}
  return false;
 }
 async Task RunUpdate(){
  if(busy)return;busy=true;updateButton.IsEnabled=false;installChoice.IsEnabled=false;pickerHost.IsEnabled=false;log.Text="";
  // Bind every asynchronous step to the installation selected at the click.
  string targetInstall=install,targetData=data,selectedIcon=brandIcon,selectedStyle=approvalStyle;
  bool wasPaused=File.Exists(Path.Combine(targetData,"paused")),restarted=false;
  Exception failed=null;
  try{
  try{
   Log("Pausing the current connection…");
   bool pausedOk=false;
   for(int attempt=0;attempt<120&&!pausedOk;attempt++){
    Exception failure=null;
    try{await Task.Run(()=>{YGPTApp.ValidateInstallTarget(targetInstall);if(!File.Exists(Path.Combine(targetInstall,".ygpt-install.json")))throw new Exception("The selected installation is no longer present. Reopen the updater to discover it again.");HostCore.PrepareOwnedRepair(targetInstall,targetData);});pausedOk=true;}
    catch(Exception ex){failure=ex;}
    if(pausedOk)break;
    if(!failure.Message.Contains("Finish active work"))throw failure;
    if(attempt==0)Log("Waiting — something in ChatGPT is still active: a request waiting for your Allow/Deny, or a running task. Nothing has been changed yet. I'll continue automatically as soon as it clears; deciding that request now is the fastest way. You can close this window to cancel.");
    // Nothing is paused or replaced between attempts (Pause removes its own
    // barrier when it refuses), so the owner may close the window to cancel.
    idleWait=true;try{await Task.Delay(5000);}finally{idleWait=false;}
    if(closed)return;
   }
   if(!pausedOk){Log("Stopped after waiting 10 minutes: the connection stayed busy, so nothing was changed. Finish the pending request in ChatGPT, then run the update again.");return;}
   Log("Replacing application files (your data folder is not touched)…");
   await Task.Run(()=>YGPTApp.InstallPayload(targetInstall));
   Log("Saving your icon and strip style…");
   try{await Task.Run(()=>{string cfgPath=Path.Combine(targetData,"ygpt.config.json");var cfg=YGPTApp.Read(cfgPath);cfg["brandIcon"]=selectedIcon;cfg["approvalStyle"]=selectedStyle;HostCore.Save(cfgPath,cfg);YGPTApp.Shortcut(targetInstall,targetData);});}
   catch(Exception ex){Log("Note: the icon choice could not be saved ("+ex.Message+"). Cosmetic choices never block a core update — you can pick it again later via Setup → Repair.");}
   YGPTApp.RefreshIconCache();
   Log("Restarting the connection…");
   await Task.Run(()=>HostCore.Start(targetInstall,targetData));restarted=true;
   bool live=false;
   for(int i=0;i<25&&!live;i++){
    await Task.Delay(1000);
    try{var h=HostCore.Read(Path.Combine(targetData,"watchdog-health.json"));live=HostCore.S(h,"ownerId")==HostCore.OwnerId(targetData)&&HostCore.S(h,"version")==HostCore.Version&&!HostCore.B(h,"stopped")&&(DateTime.UtcNow-DateTime.Parse(HostCore.S(h,"at")).ToUniversalTime()).TotalSeconds<25;}catch{}
   }
   Log(live?"Update complete — now running "+HostCore.Version+". Your ChatGPT plugin, settings and keys were kept; nothing to re-add.":"Update complete — now running "+HostCore.Version+". The connection is still starting; it reconnects automatically. Your plugin, settings and keys were kept.");
   if(live){
    try{
     var removed=await Task.Run(()=>CleanupUpdateBackups(targetInstall));
     if(removed.Count>0)Log("Cleaned up "+removed.Count+" old update backup folder(s): "+String.Join(", ",removed.ToArray())+".");
    }catch(Exception cleanupError){Log("Note: old update backups could not be cleaned ("+cleanupError.Message+"). They sit in or next to the application folder and can be deleted manually.");}
   }
  }catch(Exception ex){failed=ex;}
  // C# 5 (the .NET Framework csc used by the Windows build) cannot await
  // inside a catch block, so recovery runs after it.
  if(failed!=null){
   Log("Update stopped: "+failed.Message);
   // Resume only a pause this run created (including a pause that timed out
   // before the service reported stopped); an owner's earlier pause is kept.
   if(!wasPaused&&!restarted&&File.Exists(Path.Combine(targetData,"paused"))){
    try{await Task.Run(()=>{YGPTApp.ValidateInstallTarget(targetInstall);if(!File.Exists(Path.Combine(targetInstall,".ygpt-install.json"))||!File.Exists(Path.Combine(targetInstall,"YGPTWatchdog.exe")))throw new Exception("The previous application could not be restored to its original folder; use the full Setup package to repair it.");HostCore.Start(targetInstall,targetData);});Log("The retained installation was restarted after the failed update.");}
    catch(Exception restartError){Log("The connection remains paused: "+restartError.Message);}
   }
   Log("Nothing was uninstalled. Your previous version was left in place where possible; running the full Setup package as Repair also works.");
  }
  }finally{busy=false;idleWait=false;updateButton.IsEnabled=true;installChoice.IsEnabled=true;pickerHost.IsEnabled=true;}
 }
}
