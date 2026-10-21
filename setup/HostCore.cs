using System;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Management;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

public static class HostCore {
 public const string Version="1.0.0-rc.3";
 public static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=32*1024*1024};
 public static string Full(string p){return Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar);}
 public static string HashText(string s){using(var h=SHA256.Create())return Hex(h.ComputeHash(Encoding.UTF8.GetBytes(s)));}
 public static string Hex(byte[] b){return BitConverter.ToString(b).Replace("-","").ToLowerInvariant();}
 public static string Hash(string p){using(var f=File.Open(p,FileMode.Open,FileAccess.Read,FileShare.Read))using(var h=SHA256.Create())return Hex(h.ComputeHash(f));}
 public static string NewKey(){var b=new byte[32];using(var r=RandomNumberGenerator.Create())r.GetBytes(b);return Convert.ToBase64String(b);}
 public static string Arg(string[] a,string name,string fallback){int i=Array.IndexOf(a,name);return i>=0&&i+1<a.Length?a[i+1]:fallback;}
 public static string Q(string value){var b=new StringBuilder("\"");int slash=0;foreach(char c in value){if(c=='\\'){slash++;continue;}if(c=='"'){b.Append('\\',slash*2+1);b.Append('"');}else{b.Append('\\',slash);b.Append(c);}slash=0;}b.Append('\\',slash*2);return b.Append('"').ToString();}
 public static Dictionary<string,object> Read(string p){CheckPath(p);return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(p));}
 public static string S(Dictionary<string,object> d,string k,string fallback=""){return d.ContainsKey(k)&&d[k]!=null?Convert.ToString(d[k]):fallback;}
 public static bool B(Dictionary<string,object> d,string k){return d.ContainsKey(k)&&d[k] is bool&&(bool)d[k];}
 public static void Save(string p,object value){CheckPath(p);string tmp=p+".new-"+Guid.NewGuid().ToString("N");File.WriteAllText(tmp,Json.Serialize(value),new UTF8Encoding(false));if(File.Exists(p))File.Replace(tmp,p,null);else File.Move(tmp,p);}
 public static void CheckPath(string p){for(string t=Path.GetFullPath(p);!String.IsNullOrEmpty(t);t=Path.GetDirectoryName(t)){if((File.Exists(t)||Directory.Exists(t))&&(File.GetAttributes(t)&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked paths are not permitted");}}
 public static bool Within(string p,string root){return Full(p).StartsWith(Full(root)+"\\",StringComparison.OrdinalIgnoreCase);}
 public static void PrivateDirectory(string p){CheckPath(p);Directory.CreateDirectory(p);var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);foreach(var sid in new[]{WindowsIdentity.GetCurrent().User,new SecurityIdentifier("S-1-5-18")})acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(p,acl);}
 public static Dictionary<string,object> Secrets(string data){string p=Path.Combine(data,"credentials.dpapi");if(!File.Exists(p))return new Dictionary<string,object>();CheckPath(p);string s=File.ReadAllText(p);if(!s.StartsWith("dpapi:"))throw new Exception("Unencrypted credential store refused");return Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s.Substring(6)),null,DataProtectionScope.CurrentUser)));}
 public static void SaveSecrets(string data,Dictionary<string,object> s){PrivateDirectory(data);string p=Path.Combine(data,"credentials.dpapi");if(File.Exists(p))File.Copy(p,p+".before-"+DateTime.UtcNow.Ticks);SaveText(p,"dpapi:"+Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Serialize(s)),null,DataProtectionScope.CurrentUser)));}
 public static void SaveText(string p,string text){CheckPath(p);string tmp=p+".new-"+Guid.NewGuid().ToString("N");File.WriteAllText(tmp,text,new UTF8Encoding(false));if(File.Exists(p))File.Replace(tmp,p,null);else File.Move(tmp,p);}
 public static string OwnerId(string data){return HashText(WindowsIdentity.GetCurrent().User.Value+"|"+Full(data).ToLowerInvariant()).Substring(0,24);}
 public static string PipeName(string data){return "YGPT-"+OwnerId(data);}
 public static Dictionary<string,object> Control(string data,string action){var s=Secrets(data);using(var pipe=new NamedPipeClientStream(".",PipeName(data),PipeDirection.InOut)){pipe.Connect(2500);var w=new StreamWriter(pipe,new UTF8Encoding(false),1024,true){AutoFlush=true};w.WriteLine(Json.Serialize(new{key=S(s,"localKey"),action=action}));using(var r=new StreamReader(pipe,Encoding.UTF8,false,4096,true)){var task=r.ReadLineAsync();if(!task.Wait(15000))throw new Exception("Local control timed out; no operation was replayed");return Json.Deserialize<Dictionary<string,object>>(task.Result);}}}
 // Task Scheduler may store the same owner as a short account name rather than
 // the SID supplied at creation. Resolve it back to a SID before comparison.
 public static bool SameUserPrincipal(string recorded,SecurityIdentifier expected){
  if(String.IsNullOrWhiteSpace(recorded))return false;
  if(String.Equals(recorded,expected.Value,StringComparison.OrdinalIgnoreCase))return true;
  try{return String.Equals(((SecurityIdentifier)new NTAccount(recorded).Translate(typeof(SecurityIdentifier))).Value,expected.Value,StringComparison.OrdinalIgnoreCase);}catch{return false;}
 }
 public static string TaskName(string data){return "YGPT-Local-"+OwnerId(data).Substring(0,12)+"-Watchdog";}
 public static void RegisterTask(string install,string data,bool enabled){
  dynamic service=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));service.Connect();dynamic root=service.GetFolder("\\");string taskName=TaskName(data),exe=Path.Combine(Full(install),"YGPTWatchdog.exe");
  // Task Scheduler COM's 0x80070002 (task not found) may be projected by .NET
   // as FileNotFoundException, not only COMException. First-run absence is expected.
   dynamic prior=null;try{prior=root.GetTask(taskName);}catch(Exception e){if(e.HResult!=unchecked((int)0x80070002))throw;}
  if(prior!=null){dynamic actions=prior.Definition.Actions;bool owned=(int)actions.Count==1&&(int)actions.Item(1).Type==0&&String.Equals(Convert.ToString(actions.Item(1).Path),exe,StringComparison.OrdinalIgnoreCase)&&String.Equals(Convert.ToString(actions.Item(1).Arguments),"--data-dir "+Q(Full(data)),StringComparison.OrdinalIgnoreCase)&&SameUserPrincipal(Convert.ToString(prior.Definition.Principal.UserId),WindowsIdentity.GetCurrent().User);if(!owned)throw new InvalidOperationException("The existing startup task belongs to another configuration; it was preserved");}
  if(!enabled){if(prior!=null)root.DeleteTask(taskName,0);return;}
  dynamic task=service.NewTask(0);task.RegistrationInfo.Description="YGPT Local private connection; no setup window required";task.RegistrationInfo.Author="YGPT Local";task.Principal.UserId=WindowsIdentity.GetCurrent().User.Value;task.Principal.LogonType=3;task.Principal.RunLevel=0;
  task.Settings.Enabled=true;task.Settings.Hidden=true;task.Settings.StartWhenAvailable=true;task.Settings.DisallowStartIfOnBatteries=false;task.Settings.StopIfGoingOnBatteries=false;task.Settings.ExecutionTimeLimit="PT0S";task.Settings.MultipleInstances=2;task.Settings.RestartCount=3;task.Settings.RestartInterval="PT1M";
  dynamic trigger=task.Triggers.Create(9);trigger.UserId=WindowsIdentity.GetCurrent().User.Value;trigger.Delay="PT10S";dynamic action=task.Actions.Create(0);action.Path=exe;action.Arguments="--data-dir "+Q(Full(data));action.WorkingDirectory=Full(install);root.RegisterTaskDefinition(taskName,task,6,WindowsIdentity.GetCurrent().User.Value,null,3,null);
  // Remove only this installation's former GUI startup registration. An
  // unrelated production owner or another data directory is never modified.
  using(var k=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run",true)){if(k!=null){string old=Convert.ToString(k.GetValue("YGPTLocal"));if(old.IndexOf(Q(Path.Combine(Full(install),"YGPTLocal.exe")),StringComparison.OrdinalIgnoreCase)>=0&&old.IndexOf(Q(Full(data)),StringComparison.OrdinalIgnoreCase)>=0)k.DeleteValue("YGPTLocal",false);}}
 }
 public static void Start(string install,string data){CheckPath(data);foreach(string file in new[]{"paused","maintenance-request"}){string p=Path.Combine(data,file);CheckPath(p);if(File.Exists(p))File.Delete(p);}Process.Start(new ProcessStartInfo(Path.Combine(install,"YGPTWatchdog.exe"),"--data-dir "+Q(data)){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=install});}
 static bool Stopped(string data,DateTime after){try{var h=Read(Path.Combine(data,"watchdog-health.json"));return S(h,"ownerId")==OwnerId(data)&&B(h,"stopped")&&DateTime.Parse(S(h,"at")).ToUniversalTime()>=after&&!ProcessAlive(Convert.ToInt32(h["pid"]),Convert.ToInt64(h["birth"]));}catch{return false;}}
 static bool NoOwnedWorkers(Dictionary<string,object> health){string root=S(health,"installRoot");if(root=="")return false;using(var query=new ManagementObjectSearcher("SELECT ExecutablePath FROM Win32_Process")){foreach(ManagementObject p in query.Get()){string exe=Convert.ToString(p["ExecutablePath"]);if(exe!=""&&Within(exe,root)&&!new[]{"YGPTLocal.exe","YGPTWatchdog.exe","tunnel-client.exe"}.Contains(Path.GetFileName(exe),StringComparer.OrdinalIgnoreCase))return false;}}return true;}
 // A partially installed profile may not have produced watchdog-health.json yet.
 // Never invent a successful health record or stop an unrelated Tunnel.
 public static void PrepareOwnedRepair(string install,string data){
  string marker=Path.Combine(install,".ygpt-install.json");
  if(!File.Exists(marker))return;
  string health=Path.Combine(data,"watchdog-health.json");
  if(File.Exists(health)){Pause(data);return;}
  // Fail closed unless process inventory proves this installation is idle.
  try{
   using(var query=new ManagementObjectSearcher("SELECT ProcessId,ExecutablePath,CommandLine FROM Win32_Process"))
   foreach(ManagementObject row in query.Get()){
    string exe=Convert.ToString(row["ExecutablePath"]),cmd=Convert.ToString(row["CommandLine"]);
    if((exe!=""&&(String.Equals(Full(exe),Full(install),StringComparison.OrdinalIgnoreCase)||Within(exe,install)))||
       (cmd!=""&&cmd.IndexOf("--data-dir",StringComparison.OrdinalIgnoreCase)>=0&&cmd.IndexOf(Full(data),StringComparison.OrdinalIgnoreCase)>=0))
     throw new InvalidOperationException("An installed YGPT Local process may still be active, but its Watchdog status is missing. Wait for startup or close only this installation safely, then retry. No application files were replaced.");
   }
  }catch(InvalidOperationException){throw;}
   catch(Exception ex){throw new InvalidOperationException("Watchdog status is missing and Windows process inventory could not confirm an idle installation. No files were replaced. Retry or use a clean isolated installation profile.",ex);}
  // Missing state + no owned processes is an incomplete/dormant installation.
  // Continue in Repair mode; never fabricate a health file or a remote handshake.
 }
 public static void Pause(string data){if(File.Exists(Path.Combine(data,"paused"))&&Stopped(data,DateTime.MinValue))return;string barrier=Path.Combine(data,"maintenance-request");SaveText(barrier,"Reject new calls while the owner checks idle state");try{bool safe=false;try{safe=B(Control(data,"drain"),"safeToStop");}catch{var h=Read(Path.Combine(data,"watchdog-health.json"));safe=S(h,"ownerId")==OwnerId(data)&&NoOwnedWorkers(h);}if(!safe)throw new Exception("Finish active work and pending approvals before maintenance");DateTime requested=DateTime.UtcNow;SaveText(Path.Combine(data,"paused"),"owner maintenance");DateTime deadline=DateTime.UtcNow.AddSeconds(25);while(DateTime.UtcNow<deadline){if(Stopped(data,requested))return;try{var h=Read(Path.Combine(data,"watchdog-health.json"));if(S(h,"ownerId")==OwnerId(data)&&!ProcessAlive(Convert.ToInt32(h["pid"]),Convert.ToInt64(h["birth"]))&&NoOwnedWorkers(h)){h["stopped"]=true;h["phase"]="stopped";h["at"]=DateTime.UtcNow.ToString("o");Save(Path.Combine(data,"watchdog-health.json"),h);return;}}catch{}System.Threading.Thread.Sleep(200);}throw new Exception("Connection has not stopped safely; application files were not replaced");}catch{if(!File.Exists(Path.Combine(data,"paused"))&&File.Exists(barrier))File.Delete(barrier);throw;}}
 public static bool ProofValid(string data,string generation){try{var s=Secrets(data);var e=Read(Path.Combine(data,"first-use-proof.json"));if(S(s,"verificationKey").Length<32)return false;string payload=S(e,"payload"),mac;using(var h=new HMACSHA256(Encoding.UTF8.GetBytes(S(s,"verificationKey"))))mac=Hex(h.ComputeHash(Encoding.UTF8.GetBytes(payload)));if(S(e,"mac")!=mac)return false;var p=Json.Deserialize<Dictionary<string,object>>(payload);return S(p,"generation")==generation&&B(p,"readSucceeded")&&new[]{"official-secure-tunnel","authenticated-oauth"}.Contains(S(p,"transport"));}catch{return false;}}
 public static bool ProcessAlive(int pid,long birth){try{using(var p=Process.GetProcessById(pid))return !p.HasExited&&p.StartTime.ToUniversalTime().Ticks==birth;}catch{return false;}}
}

public static class OwnedFiles {
 [StructLayout(LayoutKind.Sequential)] public struct INFO {public uint Attr,CreateLow,CreateHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out INFO info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int cls,byte[] info,uint size);
 static string Id(INFO i){return i.Volume.ToString("x8")+":"+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8");}
 public static Dictionary<string,object> Identity(string p){HostCore.CheckPath(p);using(var f=CreateFile(p,0x80000000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){if(f.IsInvalid)throw new IOException("Cannot lock owned file");INFO i;if(!GetFileInformationByHandle(f,out i)||(i.Attr&0x410)!=0)throw new IOException("Not an ordinary file");using(var stream=new FileStream(f,FileAccess.Read))using(var hash=SHA256.Create())return new Dictionary<string,object>{{"normalizedAbsolutePath",HostCore.Full(p)},{"fileId",Id(i)},{"size",((long)i.SizeHigh<<32)|i.SizeLow},{"sha256",HostCore.Hex(hash.ComputeHash(stream))}};}}
 public static string DeleteExact(Dictionary<string,object> item){
  string p=HostCore.S(item,"normalizedAbsolutePath"),root=HostCore.S(item,"allowedRoot");var parents=new List<SafeFileHandle>();
  try{
   HostCore.CheckPath(p);if(HostCore.Full(p)==Path.GetPathRoot(p).TrimEnd('\\')||!HostCore.Within(p,root))return "BOUNDARY_CHANGED";
   for(string parent=Path.GetDirectoryName(p);!String.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent)){var ph=CreateFile(parent,0x80,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(ph.IsInvalid){ph.Dispose();return "PARENT_IN_USE";}INFO pi;if(!GetFileInformationByHandle(ph,out pi)||(pi.Attr&0x400)!=0){ph.Dispose();return "REPARSE_POINT";}parents.Add(ph);}
   using(var file=CreateFile(p,0x80010000,0,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){
    if(file.IsInvalid)return File.Exists(p)?"IN_USE_OR_ACCESS_DENIED":"ALREADY_ABSENT";INFO i;if(!GetFileInformationByHandle(file,out i)||(i.Attr&0x410)!=0)return "NOT_ORDINARY_FILE";if(i.Links>1)return "HARD_LINK_REFERENCE";if(Id(i)!=HostCore.S(item,"fileId")||(((long)i.SizeHigh<<32)|i.SizeLow)!=Convert.ToInt64(item["size"]))return "IDENTITY_CHANGED";
    using(var stream=new FileStream(file,FileAccess.Read)){using(var hash=SHA256.Create())if(HostCore.Hex(hash.ComputeHash(stream))!=HostCore.S(item,"sha256"))return "HASH_CHANGED";if(!SetFileInformationByHandle(file,4,new byte[]{1},1))return "DELETE_REFUSED";}
   }
   return "DELETED";
  }catch{return "VALIDATION_FAILED";}finally{foreach(var h in parents)h.Dispose();}
 }
}

public static class InstallCleanup {
 static string Mac(string text,string key){if(key.Length<32)throw new Exception("Cleanup verification key is missing");using(var h=new HMACSHA256(Encoding.UTF8.GetBytes(key)))return HostCore.Hex(h.ComputeHash(Encoding.UTF8.GetBytes(text)));}
 public static void Record(string data,string install,string generation,IEnumerable<Dictionary<string,object>> entries,bool consent,int setupPid,long setupBirth){
  var record=new Dictionary<string,object>{{"version",1},{"product","YGPT Local"},{"installedGeneration",generation},{"installRoot",HostCore.Full(install)},{"dataRoot",HostCore.Full(data)},{"authorized",consent},{"setupPid",setupPid},{"setupBirth",setupBirth},{"createdAt",DateTime.UtcNow.ToString("o")},{"entries",entries.ToArray()}};
  string payload=HostCore.Json.Serialize(record);record["signedPayload"]=payload;record["manifestMac"]=Mac(payload,HostCore.S(HostCore.Secrets(data),"verificationKey"));HostCore.Save(Path.Combine(data,"installation-ownership.json"),record);
 }
 public static Dictionary<string,object> Entry(string file,string generation,string kind,string allowedRoot,bool explicitFileConsent){var e=OwnedFiles.Identity(file);foreach(var pair in new Dictionary<string,object>{{"createdByInstaller",!explicitFileConsent},{"explicitFileConsent",explicitFileConsent},{"allowedRoot",HostCore.Full(allowedRoot)},{"kind",kind},{"sourceVersion",HostCore.Version},{"purpose","installation-only"},{"neededByRuntime",false},{"neededByMaintenance",false},{"neededByRollback",false},{"cleanupEligibility",true},{"createdAt",DateTime.UtcNow.ToString("o")},{"installedGeneration",generation}})e[pair.Key]=pair.Value;return e;}
 public static Dictionary<string,object> Run(string data,string install){
  var envelope=HostCore.Read(Path.Combine(data,"installation-ownership.json"));string payload=HostCore.S(envelope,"signedPayload");if(HostCore.S(envelope,"manifestMac")!=Mac(payload,HostCore.S(HostCore.Secrets(data),"verificationKey")))throw new Exception("Ownership manifest signature mismatch");var r=HostCore.Json.Deserialize<Dictionary<string,object>>(payload);string generation=HostCore.S(r,"installedGeneration");
  if(!HostCore.B(r,"authorized"))return new Dictionary<string,object>{{"state","not-authorized"}};
  if(!HostCore.ProofValid(data,generation))return new Dictionary<string,object>{{"state","awaiting-real-first-use"}};
  if(HostCore.ProcessAlive(Convert.ToInt32(r["setupPid"]),Convert.ToInt64(r["setupBirth"])))return new Dictionary<string,object>{{"state","waiting-for-setup-exit"}};
  try{var live=HostCore.Read(Path.Combine(data,"watchdog-health.json"));string mode=HostCore.S(HostCore.Read(Path.Combine(data,"connection.json")),"mode");if(HostCore.S(live,"ownerId")!=HostCore.OwnerId(data)||!HostCore.B(live,"localReady")||mode=="secure-tunnel"&&!HostCore.B(live,"tunnelConnected")||!HostCore.ProcessAlive(Convert.ToInt32(live["pid"]),Convert.ToInt64(live["birth"]))||(DateTime.UtcNow-DateTime.Parse(HostCore.S(live,"at")).ToUniversalTime()).TotalSeconds>25)throw new Exception();}catch{return new Dictionary<string,object>{{"state","awaiting-live-connection"}};}
  if(HostCore.Full(install)!=HostCore.S(r,"installRoot")||HostCore.Full(data)!=HostCore.S(r,"dataRoot"))throw new Exception("Installation ownership mismatch");
  var references=new List<string>();bool referencesKnown=true;
  try{
   using(var query=new ManagementObjectSearcher("SELECT CommandLine,ExecutablePath FROM Win32_Process"))foreach(ManagementObject process in query.Get()){references.Add(Convert.ToString(process["ExecutablePath"]));references.Add(Convert.ToString(process["CommandLine"]));}
   using(var run=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))if(run!=null)foreach(string name in run.GetValueNames())references.Add(Convert.ToString(run.GetValue(name)));
   foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine})foreach(string tree in new[]{"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall","Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"})using(var parent=hive.OpenSubKey(tree)){if(parent!=null)foreach(string name in parent.GetSubKeyNames())using(var key=parent.OpenSubKey(name)){if(key!=null)foreach(string valueName in new[]{"UninstallString","QuietUninstallString","ModifyPath","DisplayIcon","InstallLocation"})references.Add(Convert.ToString(key.GetValue(valueName)));}}
   dynamic scheduler=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));scheduler.Connect();CollectTaskReferences(scheduler.GetFolder("\\"),references);
  }catch{referencesKnown=false;}
  var results=new List<object>();long bytes=0;int deleted=0,skipped=0;
  foreach(object value in (System.Collections.IEnumerable)r["entries"]){var e=(Dictionary<string,object>)value;string p=HostCore.S(e,"normalizedAbsolutePath"),why="RETAINED";
   if(!referencesKnown)why="REFERENCE_CHECK_UNAVAILABLE";
   else if(!new[]{"setup-download","portable-download","staging","install-cache"}.Contains(HostCore.S(e,"kind")))why="UNKNOWN_KIND";
   else if(HostCore.Within(p,Environment.GetFolderPath(Environment.SpecialFolder.Windows))||HostCore.Within(p,Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles))||HostCore.Within(p,Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)))why="SYSTEM_ROOT";
   else if(references.Any(s=>!String.IsNullOrEmpty(s)&&s.Replace('/','\\').IndexOf(HostCore.Full(p),StringComparison.OrdinalIgnoreCase)>=0))why="LIVE_OR_STARTUP_REFERENCE";
   else if(HostCore.S(e,"installedGeneration")!=generation)why="FOREIGN_GENERATION";
   else if(!HostCore.B(e,"createdByInstaller")&&!HostCore.B(e,"explicitFileConsent"))why="NO_FILE_OWNERSHIP";
   else if(!HostCore.B(e,"cleanupEligibility")||HostCore.B(e,"neededByRuntime")||HostCore.B(e,"neededByMaintenance")||HostCore.B(e,"neededByRollback"))why="REQUIRED_REFERENCE";
   else if(HostCore.Within(p,data)||HostCore.Full(p)==HostCore.Full(data)||HostCore.Within(p,install)||HostCore.Full(p)==HostCore.Full(install))why="PERSISTENT_OR_INSTALLED_ROOT";
   else why=OwnedFiles.DeleteExact(e);
   if(why=="DELETED"){deleted++;bytes+=Convert.ToInt64(e["size"]);}else if(why!="ALREADY_ABSENT")skipped++;
   results.Add(new{entry=results.Count+1,kind=HostCore.S(e,"kind"),outcome=why});
  }
  int totalDeleted=deleted,attempt=1;long totalBytes=bytes;string receiptPath=Path.Combine(data,"post-install-cleanup-receipt.json");if(File.Exists(receiptPath)){var before=HostCore.Read(receiptPath);if(HostCore.S(before,"generation")==generation){totalDeleted+=Convert.ToInt32(before["totalDeleted"]);totalBytes+=Convert.ToInt64(before["totalBytesReclaimed"]);attempt=Convert.ToInt32(before["attempt"])+1;}}
  var receipt=new Dictionary<string,object>{{"state",skipped>0?"partially-skipped":"complete"},{"generation",generation},{"attempt",attempt},{"deleted",deleted},{"bytesReclaimed",bytes},{"totalDeleted",totalDeleted},{"totalBytesReclaimed",totalBytes},{"skipped",skipped},{"files",results},{"at",DateTime.UtcNow.ToString("o")},{"uninstallInvoked",false}};HostCore.Save(receiptPath,receipt);return receipt;
 }
 static void CollectTaskReferences(dynamic folder,List<string> output){foreach(dynamic task in folder.GetTasks(1))foreach(dynamic action in task.Definition.Actions){if((int)action.Type==0){output.Add(Convert.ToString(action.Path));output.Add(Convert.ToString(action.Arguments));}}foreach(dynamic child in folder.GetFolders(0))CollectTaskReferences(child,output);}
}
