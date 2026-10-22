using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class YGPTWatchdog {
 static string install=AppDomain.CurrentDomain.BaseDirectory,data;static Process child;static int restarts=0;static bool authFailure=false;static string phase="starting",lastError="";static int lastExitCode=-1,retryInSeconds=0;static DateTime started=DateTime.UtcNow;static IntPtr job=IntPtr.Zero;
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct BASIC {public long PerProcess,PerJob;public uint LimitFlags;public UIntPtr Min,Max;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct LIMIT {public BASIC Basic;public IO Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
 // The transport is owned by this job. Descendants may leave the job so that
 // durable task workers retain their existing crash-recovery semantics; closing
 // transport stdio asks the broker to shut down normally, without replay.
 static void OwnChild(Process p){job=CreateJobObject(IntPtr.Zero,null);var v=new LIMIT();v.Basic.LimitFlags=0x3000;int size=Marshal.SizeOf(typeof(LIMIT));IntPtr mem=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(v,mem,false);if(job==IntPtr.Zero||!SetInformationJobObject(job,9,mem,(uint)size)||!AssignProcessToJobObject(job,p.Handle)){if(!p.HasExited)p.Kill();throw new Exception("OWNED_JOB_UNAVAILABLE");}}finally{Marshal.FreeHGlobal(mem);}}
 static void StopChild(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}else if(child!=null&&!child.HasExited)child.Kill();if(child!=null){child.Dispose();child=null;}}
 static void Health(bool localReady,bool connected){HostCore.Save(Path.Combine(data,"watchdog-health.json"),new{product="YGPT Local",version=HostCore.Version,ownerId=HostCore.OwnerId(data),installRoot=install,pid=Process.GetCurrentProcess().Id,birth=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks,childPid=child!=null&&!child.HasExited?(int?)child.Id:null,phase=phase,localReady=localReady,tunnelConnected=connected,restarts=restarts,lastError=lastError,lastExitCode=lastExitCode,retryInSeconds=retryInSeconds,stopped=phase=="stopped",guiRequired=false,at=DateTime.UtcNow.ToString("o")});}
 static bool Connected(){try{string p=Path.Combine(data,"tunnel-health.url");HostCore.CheckPath(p);var u=new Uri(File.ReadAllText(p).Trim());if(u.Scheme!="http"||u.Host!="127.0.0.1"||u.IsDefaultPort||u.UserInfo!=""||u.Query!=""||u.Fragment!="")return false;var q=(HttpWebRequest)WebRequest.Create(u.GetLeftPart(UriPartial.Authority)+"/readyz");q.Proxy=null;q.Timeout=2000;using(var r=(HttpWebResponse)q.GetResponse())return r.StatusCode==HttpStatusCode.OK;}catch{return false;}}
 static string ClassifyClientError(string line){
  if(String.IsNullOrWhiteSpace(line))return "";
  // Path/stdio launch failures must not masquerade as Tunnel network failures.
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(mcpclient: start stdio command|fork/exec.*(cannot find|not found)|The system cannot find the file specified)"))return "TUNNEL_STDIO_PROCESS_PATH_INVALID";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(invalid_api_key|key_expired|\b401\b|unauthorized)"))return "RUNTIME_KEY_INVALID_OR_EXPIRED";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(insufficient_permissions|permission_denied|\b403\b|forbidden|workspace.*(access|denied))"))return "TUNNEL_PERMISSION_OR_WORKSPACE_DENIED";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(\b429\b|rate.limit|too.many.requests)"))return "OPENAI_TUNNEL_RATE_LIMITED";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(certificate|x509|tls.handshake|unknown.ca)"))return "TUNNEL_TLS_OR_CERTIFICATE_ERROR";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(lookup.*(no.such.host|failed)|dns|name.resolution|host.not.found)"))return "TUNNEL_DNS_FAILURE";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(proxy.*(refused|failed|error|authentication)|proxyconnect)"))return "TUNNEL_PROXY_FAILURE";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(timeout|timed.out|connection.refused|unreachable|network.is.down)"))return "TUNNEL_NETWORK_UNREACHABLE";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(unknown.flag|unexpected.argument|invalid.argument|unrecognized.option)"))return "TUNNEL_CLIENT_ARGUMENT_ERROR";
  if(System.Text.RegularExpressions.Regex.IsMatch(line,@"(?i)(tunnel.*(not.found|does.not.exist)|invalid.tunnel.id)"))return "TUNNEL_ID_NOT_FOUND_OR_WRONG_ORGANIZATION";
  return ""; // Never store raw client stderr: it may contain credentials.
 }
 static void ObserveClientLine(string line){string code=ClassifyClientError(line);if(code!=""){lastError=code;if(code=="RUNTIME_KEY_INVALID_OR_EXPIRED"||code=="TUNNEL_PERMISSION_OR_WORKSPACE_DENIED")authFailure=true;}}
 static void WaitRetry(int seconds){for(int remaining=seconds;remaining>0&&!File.Exists(Path.Combine(data,"paused"));remaining--){retryInSeconds=remaining;Health(false,false);Thread.Sleep(1000);}retryInSeconds=0;}
 static void ProxyEnvironment(ProcessStartInfo si,Dictionary<string,object> connection){string proxy=HostCore.S(connection,"proxyUrl");if(proxy==""){try{var target=new Uri("https://api.openai.com");var inherited=WebRequest.DefaultWebProxy.GetProxy(target);if(inherited!=target&&inherited.UserInfo=="")proxy=inherited.GetLeftPart(UriPartial.Authority);}catch{}}if(proxy!=""){var u=new Uri(proxy);if(!new[]{"http","https"}.Contains(u.Scheme)||u.UserInfo!="")throw new Exception("PROXY_SETTINGS_INVALID");si.EnvironmentVariables["HTTP_PROXY"]=proxy;si.EnvironmentVariables["HTTPS_PROXY"]=proxy;}si.EnvironmentVariables["NO_PROXY"]="localhost,127.0.0.1,::1";}
 static void EnsureNoForeignTunnel(string id){
  var si=new ProcessStartInfo(Path.Combine(install,"runtime","NativeWindows.exe")){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true};using(var p=Process.Start(si)){p.StandardInput.Write(HostCore.Json.Serialize(new{action="tunnel-inventory",id=id}));p.StandardInput.Close();var output=p.StandardOutput.ReadToEndAsync();var error=p.StandardError.ReadToEndAsync();if(!p.WaitForExit(15000)){p.Kill();throw new Exception("TUNNEL_OWNER_UNKNOWN");}var envelope=HostCore.Json.Deserialize<Dictionary<string,object>>(output.Result);if(!HostCore.B(envelope,"ok"))throw new Exception("TUNNEL_OWNER_UNKNOWN");var r=(Dictionary<string,object>)envelope["result"];if(!HostCore.B(r,"processInventoryAvailable")||HostCore.B(r,"conflict"))throw new Exception("TUNNEL_ALREADY_OWNED");}
 }
 // --mcp.command is parsed by a POSIX-style tokenizer. Use forward slashes
 // in native Windows absolute paths or backslashes disappear on tokenization.
 public static string StdioMcpCommand(string node,string bootstrap){
  if(!Path.IsPathRooted(node)||!Path.IsPathRooted(bootstrap))throw new ArgumentException("Absolute MCP executable paths are required");
  return HostCore.Q(node.Replace('\\','/'))+" "+HostCore.Q(bootstrap.Replace('\\','/'));
 }
 static void Launch(Dictionary<string,object> connection,Dictionary<string,object> secrets){
  string mode=HostCore.S(connection,"mode"),node=Path.Combine(install,"runtimes","node","node.exe");ProcessStartInfo si;
  if(mode=="secure-tunnel"){
   string id=HostCore.S(connection,"tunnelId");EnsureNoForeignTunnel(id);
   // tunnel-client tokenizes mcp.command using shell-style escapes: raw Windows
   // backslashes become escape characters, e.g. D:\\AI becomes D:AI.
   // Windows process spawning also accepts forward-slash absolute paths.
   string command=StdioMcpCommand(node,Path.Combine(install,"runtime","bootstrap.mjs"));
   si=new ProcessStartInfo(Path.Combine(install,"runtimes","tunnel-client.exe"),"run --control-plane.tunnel-id "+HostCore.Q(id)+" --control-plane.api-key env:YGPT_TUNNEL_RUNTIME_KEY --mcp.command "+HostCore.Q("command="+command)+" --mcp.stdio-send-initialized-notification --health.listen-addr 127.0.0.1:0 --health.url-file "+HostCore.Q(Path.Combine(data,"tunnel-health.url")));
   si.EnvironmentVariables["YGPT_TUNNEL_RUNTIME_KEY"]=HostCore.S(secrets,"runtimeKey");si.EnvironmentVariables["YGPT_TRANSPORT_SOURCE"]="official-secure-tunnel";
  }else si=new ProcessStartInfo(node,HostCore.Q(Path.Combine(install,"service","supervisor.mjs"))+" "+HostCore.Q(data));
  si.UseShellExecute=false;si.CreateNoWindow=true;si.WindowStyle=ProcessWindowStyle.Hidden;si.WorkingDirectory=install;si.RedirectStandardOutput=true;si.RedirectStandardError=true;
  si.EnvironmentVariables["YGPT_CONFIG"]=Path.Combine(data,"ygpt.config.json");si.EnvironmentVariables["YGPT_SETUP_DATA_DIR"]=data;si.EnvironmentVariables["YGPT_FIRST_USE_KEY"]=HostCore.S(secrets,"verificationKey");si.EnvironmentVariables["YGPT_LOCAL_CONTROL_KEY"]=HostCore.S(secrets,"localKey");si.EnvironmentVariables["YGPT_CONTROL_PIPE"]="\\\\.\\pipe\\"+HostCore.PipeName(data);si.EnvironmentVariables["PATH"]=Path.GetDirectoryName(node)+";"+si.EnvironmentVariables["PATH"];si.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"]="1";ProxyEnvironment(si,connection);
  authFailure=false;child=Process.Start(si);OwnChild(child);child.OutputDataReceived+=(s,e)=>ObserveClientLine(e.Data);child.ErrorDataReceived+=(s,e)=>ObserveClientLine(e.Data);child.BeginOutputReadLine();child.BeginErrorReadLine();started=DateTime.UtcNow;
 }
 public static int Main(string[] args){
  try{
   data=HostCore.Full(HostCore.Arg(args,"--data-dir",HostCore.DefaultDataDir()));install=HostCore.Full(HostCore.Arg(args,"--install-dir",install));HostCore.CheckPath(data);HostCore.CheckPath(install);
   if(args.Contains("--cleanup-once")){InstallCleanup.Run(data,install);return 0;}
   var connection=HostCore.Read(Path.Combine(data,"connection.json"));var secrets=HostCore.Secrets(data);bool fresh;using(var owner=new Mutex(true,"Local\\YGPT-owner-"+HostCore.OwnerId(data),out fresh)){if(!fresh)return 0;
    string tunnel=HostCore.S(connection,"tunnelId",HostCore.S(connection,"publicOrigin",data));bool unique;using(var tunnelOwner=new Mutex(true,"Local\\YGPT-tunnel-"+HostCore.HashText(System.Security.Principal.WindowsIdentity.GetCurrent().User.Value+"|"+tunnel).Substring(0,32),out unique)){if(!unique){phase="other-owner-active";Health(false,false);return 2;}
     int failures=0;while(!File.Exists(Path.Combine(data,"paused"))){
      if(child!=null&&child.HasExited){try{child.WaitForExit(300);}catch{}try{lastExitCode=child.ExitCode;}catch{lastExitCode=-1;}if(lastError=="")lastError="TUNNEL_CLIENT_EXITED_CODE_"+lastExitCode;if(authFailure){StopChild();phase="credentials-required";Health(false,false);return 0;}StopChild();failures++;restarts++;phase="reconnecting";int backoff=Math.Min(120,2*(1<<Math.Min(failures,6)));WaitRetry(backoff);if(File.Exists(Path.Combine(data,"paused")))break;}
      if(child==null){try{lastExitCode=-1;Launch(connection,secrets);phase="starting";}catch(Exception e){lastError=new[]{"TUNNEL_ALREADY_OWNED","TUNNEL_OWNER_UNKNOWN","PROXY_SETTINGS_INVALID","OWNED_JOB_UNAVAILABLE"}.Contains(e.Message)?e.Message:"START_FAILED";phase="needs-attention";Health(false,false);return 3;}}
      bool local=false;try{local=HostCore.B(HostCore.Control(data,"status"),"localReady");}catch{}
      bool connected=HostCore.S(connection,"mode")=="secure-tunnel"&&Connected();if(connected&&!authFailure){lastError="";failures=0;}phase=authFailure?"credentials-required":local?(connected?"connected":"local-ready-awaiting-remote"):connected?"tunnel-ready-awaiting-first-mcp-call":"starting";Health(local,connected);
      if(authFailure){StopChild();Health(false,false);return 0;}
      if(local){failures=0;if(connected||HostCore.S(connection,"mode")!="secure-tunnel")lastError="";try{string receipt=Path.Combine(data,"post-install-cleanup-receipt.json");if((HostCore.S(connection,"mode")!="secure-tunnel"||connected)&&!File.Exists(receipt))InstallCleanup.Run(data,install);}catch{lastError="CLEANUP_SKIPPED_CONNECTION_RETAINED";}}
      // The official client can wait for the first remote handshake before it
      // creates a stdio server. Absence of a broker is not a tunnel failure.
      if(child.HasExited||HostCore.S(connection,"mode")!="secure-tunnel"&&!local&&(DateTime.UtcNow-started).TotalSeconds>90){StopChild();restarts++;failures++;phase="reconnecting";Health(false,false);int seconds=Math.Min(120,2*(1<<Math.Min(failures,6)));WaitRetry(seconds);continue;}
      for(int i=0;i<5&&!File.Exists(Path.Combine(data,"paused"));i++)Thread.Sleep(1000);
     }
     StopChild();phase="stopped";Health(false,false);return 0;
    }
   }
  }catch{try{phase="needs-attention";lastError="WATCHDOG_START_FAILED";Health(false,false);}catch{}return 5;}finally{StopChild();}
 }
}
