using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;

public sealed class ClipboardBusyException:InvalidOperationException {
 public ClipboardBusyException():base("Another app is using the Windows clipboard. Close its clipboard or remote-session overlay, then try this button again. Your setup progress is safe."){}
}

public static class SetupInteractions {
 // Keep clipboard work on the calling STA dispatcher. Delays release the UI.
 public static async Task<T> RetryClipboard<T>(Func<T> operation){
  for(int attempt=0;attempt<8;attempt++){
   bool retry=false;
   try{return operation();}
   catch(ExternalException e){if(e.ErrorCode!=unchecked((int)0x800401D0)&&e.ErrorCode!=unchecked((int)0x80070005))throw;retry=true;}
   if(retry){if(attempt==7)throw new ClipboardBusyException();await Task.Delay(35*(attempt+1));}
  }
  throw new ClipboardBusyException();
 }
 public static Task<bool> CopyText(string value){return RetryClipboard(()=>{Clipboard.SetText(value??"");return true;});}
 public static Task<string> ReadText(){return RetryClipboard(()=>Clipboard.GetText());}

 // OpenAI's own training links use ?prompt= to open an unsent draft.
 // Never use ?q=, SendKeys, or an automatic submit action here.
 public static string ChatDraftUrl(string prompt){return "https://chatgpt.com/?prompt="+Uri.EscapeDataString(prompt);}
 public static string FirstPrompt(string install,string marker){
  return "Use @YGPT Local to verify that our local plugin is installed and working. The application folder is "+install+". Report that path, the YGPTLocal.exe size in bytes, and the installed payload size from manifest.json. List this verification folder and note the marker's path and size before reading it: "+Path.GetDirectoryName(marker)+"\n"+marker+
   "\nThen read the marker and report its exact text. Check for unnecessary installation files and delete verified installer-owned leftovers. Even if I have not clicked 'Finish setup', remove the surplus files and this exact downloaded Setup executable through the signed cleanup plan, allowing Setup to close first. Keep installed Settings, runtimes, private data, credentials, snapshots and the retained rollback. Do not sweep unrelated folders. Report what was removed, kept or deferred; a scheduled deletion is not a completed deletion.";
 }
 public static string BrowserExecutable(string browser){
  string name=browser=="chrome"?"chrome.exe":browser=="edge"?"msedge.exe":null;
  if(name==null)throw new InvalidOperationException("Choose Chrome or Edge.");
  foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine})using(var key=hive.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\"+name)){
   string p=key==null?"":Convert.ToString(key.GetValue(""));if(File.Exists(p)&&String.Equals(Path.GetFileName(p),name,StringComparison.OrdinalIgnoreCase))return p;
  }
  string suffix=browser=="chrome"?"Google\\Chrome\\Application\\chrome.exe":"Microsoft\\Edge\\Application\\msedge.exe";
  foreach(string baseDir in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}){string p=Path.Combine(baseDir,suffix);if(File.Exists(p))return p;}
  throw new InvalidOperationException((browser=="chrome"?"Chrome":"Edge")+" was not found. Choose your default browser instead.");
 }
 public static void OpenBrowser(string browser,string url){
  if(browser=="default"){Process.Start(new ProcessStartInfo(url){UseShellExecute=true});return;}
  Process.Start(new ProcessStartInfo(BrowserExecutable(browser),"--new-tab "+HostCore.Q(url)){UseShellExecute=true});
 }
 public static void ScheduleCleanup(string install,string data){
  string exe=Path.Combine(install,"YGPTWatchdog.exe");var manifest=HostCore.Read(Path.Combine(install,"manifest.json"));
  var files=((System.Collections.IEnumerable)manifest["files"]).Cast<System.Collections.Generic.Dictionary<string,object>>();var entry=files.SingleOrDefault(e=>HostCore.S(e,"path")=="YGPTWatchdog.exe");
  if(entry==null||HostCore.Hash(exe)!=HostCore.S(entry,"sha256"))throw new InvalidOperationException("The installed cleanup helper could not be verified. Settings keeps the cleanup receipt available.");
  Process.Start(new ProcessStartInfo(exe,"--cleanup-after-setup --data-dir "+HostCore.Q(data)){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=install});
 }
}
