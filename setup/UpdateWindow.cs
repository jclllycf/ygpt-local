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
 string install="",data="",brandIcon="plugin-icon-256.png",approvalStyle="current";
 readonly List<Border> iconTiles=new List<Border>();
 Image previewIcon;Border previewHost;
 bool busy=false;
 static SolidColorBrush B(string s){return (SolidColorBrush)new BrushConverter().ConvertFromString(s);}
 public UpdateWindow(){
  installs=DiscoverInstalls();
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
  SelectInstall(0);
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
  return found;
 }
 void SelectInstall(int index){
  if(index<0||index>=installs.Count)return;
  install=installs[index][0];data=installs[index][1];
  try{var c=YGPTApp.Read(Path.Combine(data,"ygpt.config.json"));string saved=HostCore.S(c,"brandIcon");if(Array.IndexOf(BrandIconFiles,saved)>=0)brandIcon=saved;approvalStyle=HostCore.S(c,"approvalStyle")=="legacy"?"legacy":"current";}catch{}
  // Rebuild the summary + picker for this target.
  while(body.Children.Count>0&&(installs.Count>1?body.Children[0]!=installChoice:true))body.Children.RemoveAt(installs.Count>1?1:0);
  var summary=new StackPanel();
  summary.Children.Add(new TextBlock{Text="Installed: "+installs[index][2]+"   →   This update: "+HostCore.Version,FontSize=14,FontWeight=FontWeights.SemiBold,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,4)});
  summary.Children.Add(new TextBlock{Text=install,FontSize=12,Foreground=B(Muted),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,4)});
  summary.Children.Add(new TextBlock{Text="Kept as-is: settings, encrypted keys, connection identity, snapshots and your ChatGPT plugin.",FontSize=13,Foreground=B(Muted),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,12)});
  if(installs.Count>1)body.Children.Insert(1,summary);else body.Children.Insert(0,summary);
  pickerHost.Children.Clear();BuildPicker(pickerHost);
  if(!body.Children.Contains(pickerHost))body.Children.Insert(installs.Count>1?2:1,pickerHost);
 }
 BitmapSource BrandBitmap(int i){
  string file=Path.Combine(install,"assets","brand",BrandIconFiles[i]);if(File.Exists(file)){try{return new BitmapImage(new Uri(file));}catch{}}
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
 Border BuildStripMock(){
  var inner=new StackPanel();
  var head=new DockPanel{Margin=new Thickness(0,0,0,8)};previewIcon=new Image{Width=26,Height=26,Margin=new Thickness(0,0,10,0)};head.Children.Add(previewIcon);
  head.Children.Add(new TextBlock{Text="Review an operation",FontSize=14,FontWeight=FontWeights.SemiBold,VerticalAlignment=VerticalAlignment.Center});
  var pill=new Border{Background=B("#EFF8FE"),CornerRadius=new CornerRadius(8),Padding=new Thickness(8,2,8,2),Child=new TextBlock{Text="Awaiting approval",FontSize=11,Foreground=B(Muted)}};DockPanel.SetDock(pill,Dock.Right);head.Children.Add(pill);inner.Children.Add(head);
  inner.Children.Add(new TextBlock{Text="D:\\Projects\\demo\\app.log",FontSize=13,Margin=new Thickness(0,0,0,6)});
  inner.Children.Add(new TextBlock{Text="The file will be moved to the Recycle Bin. A snapshot keeps it restorable.",FontSize=13,Foreground=B(Muted),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,0,0,10)});
  var actions=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};
  foreach(var label in new[]{"Allow once","Always allow in this chat","Deny"})actions.Children.Add(new Button{Content=label,IsEnabled=false,MinHeight=30,Padding=new Thickness(10,2,10,2),Margin=new Thickness(6,0,0,0),FontSize=12});
  inner.Children.Add(actions);
  return new Border{Background=Brushes.White,BorderBrush=B(Line),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(12),Padding=new Thickness(14),Child=inner};
 }
 void RefreshBrandPreview(){
  if(previewHost==null)return;
  if(approvalStyle=="legacy"){
   BitmapSource classic=null;using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("YGPT.PreviewClassic")){if(stream!=null){var b=new BitmapImage();b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.StreamSource=stream;b.EndInit();classic=b;}}
   previewHost.Child=classic!=null?new Image{Source=classic,Stretch=Stretch.Uniform}:(UIElement)new TextBlock{Text="Classic strip — the original design.",Foreground=B(Muted)};
  }else{
   previewHost.Child=BuildStripMock();
   for(int i=0;i<BrandIconFiles.Length;i++)if(BrandIconFiles[i]==brandIcon)previewIcon.Source=BrandBitmap(i);
  }
 }
 void Log(string line){log.Text=log.Text.Length==0?line:log.Text+"\n"+line;}
 async Task RunUpdate(){
  if(busy)return;busy=true;updateButton.IsEnabled=false;log.Text="";
  try{
   Log("Pausing the current connection…");
   await Task.Run(()=>{if(File.Exists(Path.Combine(install,".ygpt-install.json")))HostCore.PrepareOwnedRepair(install,data);});
   Log("Replacing application files (your data folder is not touched)…");
   await Task.Run(()=>YGPTApp.InstallPayload(install));
   Log("Saving your icon and strip style…");
   await Task.Run(()=>{string cfgPath=Path.Combine(data,"ygpt.config.json");var cfg=YGPTApp.Read(cfgPath);cfg["brandIcon"]=brandIcon;cfg["approvalStyle"]=approvalStyle;HostCore.Save(cfgPath,cfg);});
   YGPTApp.RefreshIconCache();
   Log("Restarting the connection…");
   await Task.Run(()=>HostCore.Start(install,data));
   bool live=false;
   for(int i=0;i<25&&!live;i++){
    await Task.Delay(1000);
    try{var h=HostCore.Read(Path.Combine(data,"watchdog-health.json"));live=HostCore.S(h,"ownerId")==HostCore.OwnerId(data)&&(DateTime.UtcNow-DateTime.Parse(HostCore.S(h,"at")).ToUniversalTime()).TotalSeconds<25;}catch{}
   }
   Log(live?"Update complete — now running "+HostCore.Version+". Your ChatGPT plugin, settings and keys were kept; nothing to re-add.":"Update complete — now running "+HostCore.Version+". The connection is still starting; it reconnects automatically. Your plugin, settings and keys were kept.");
  }catch(Exception ex){
   Log("Update stopped: "+ex.Message);
   Log("Nothing was uninstalled. Your previous version was left in place where possible; running the full Setup package as Repair also works.");
  }finally{busy=false;updateButton.IsEnabled=true;}
 }
}
