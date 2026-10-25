using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Linq;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

// Explicit UAC only. The ordinary stdio launcher owns a random, SID-private
// pipe. Both ends verify the opposite process ID; no elevation token or
// reusable command channel is returned to a model or stored on disk.
public static class YGPTAdmin {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=524288};
 static readonly string Sid=WindowsIdentity.GetCurrent().User.Value;
 static IntPtr job=IntPtr.Zero;
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(IntPtr pipe,out uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(IntPtr pipe,out uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr handle,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr handle,int cls,IntPtr info,uint length);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [StructLayout(LayoutKind.Sequential)] struct BASIC {public long ProcessTime,JobTime;public uint Flags;public UIntPtr Min,Max;public uint Active;public UIntPtr Affinity;public uint Priority,Schedule;}
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct LIMIT {public BASIC Basic;public IO Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;}
 public static string Quote(string s){if(s==null||s.IndexOf('\0')>=0)throw new Exception("ADMIN_INVALID_ARGUMENT");var b=new StringBuilder("\"");int n=0;foreach(char c in s){if(c=='\\'){n++;continue;}if(c=='\"'){b.Append('\\',n*2+1);b.Append(c);}else{b.Append('\\',n);b.Append(c);}n=0;}b.Append('\\',n*2);return b.Append('"').ToString();}
 static string Read(TextReader reader){var b=new StringBuilder();for(;;){int c=reader.Read();if(c<0)return b.Length==0?null:b.ToString();if(c=='\n')return b.ToString().TrimEnd('\r');if(b.Length>=262144)throw new Exception("ADMIN_MESSAGE_TOO_LARGE");b.Append((char)c);}}
 static Dictionary<string,object> Parse(string s){if(s==null)throw new Exception("ADMIN_CHANNEL_CLOSED");return Json.Deserialize<Dictionary<string,object>>(s);}
 static string S(Dictionary<string,object> v,string k,string fallback=""){return v.ContainsKey(k)?Convert.ToString(v[k]):fallback;}
 static void Send(TextWriter w,object v){w.WriteLine(Json.Serialize(v));w.Flush();}
 static bool Alive(int pid,long birth){try{using(var p=Process.GetProcessById(pid))return !p.HasExited&&p.StartTime.ToUniversalTime().Ticks==birth;}catch{return false;}}
 static Timer Watch(int pid,long birth,DateTime expires){return new Timer(_=>{if(DateTime.UtcNow>=expires||!Alive(pid,birth))Environment.Exit(0);},null,100,100);}
 static void OwnWorker(){job=CreateJobObject(IntPtr.Zero,null);var limits=new LIMIT();limits.Basic.Flags=0x2000;int size=Marshal.SizeOf(typeof(LIMIT));IntPtr p=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(limits,p,false);if(job==IntPtr.Zero||!SetInformationJobObject(job,9,p,(uint)size)||!AssignProcessToJobObject(job,Process.GetCurrentProcess().Handle))throw new Exception("ADMIN_JOB_UNAVAILABLE");}finally{Marshal.FreeHGlobal(p);}}
 static bool Elevated(){return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);}
 static DateTime Deadline(string text){var at=DateTime.Parse(text,null,System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime();if(at<=DateTime.UtcNow||at>DateTime.UtcNow.AddHours(12).AddSeconds(5))throw new Exception("ADMIN_EXPIRY_INVALID");return at;}
 static void Launch(bool fixture){
  var input=Parse(Read(Console.In));int parent=Convert.ToInt32(input["parentPid"]);long birth=Convert.ToInt64(input["parentBirth"]);DateTime expires=Deadline(S(input,"expiresAt"));if(!Alive(parent,birth))throw new Exception("ADMIN_PARENT_GONE");
  using(var watch=Watch(parent,birth,expires)){
   string name="YGPT-Admin-"+Guid.NewGuid().ToString("N");var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Sid),PipeAccessRights.FullControl,AccessControlType.Allow));
   using(var pipe=new NamedPipeServerStream(name,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security)){
    var self=Process.GetCurrentProcess();var args=String.Join(" ",new[]{fixture?"--fixture-worker":"--worker",name,self.Id.ToString(),self.StartTime.ToUniversalTime().Ticks.ToString(),expires.ToString("o"),Sid}.Select(Quote));
    var start=new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location,args){UseShellExecute=!fixture,Verb=fixture?"":"runas",WindowStyle=ProcessWindowStyle.Hidden,CreateNoWindow=fixture,WorkingDirectory=AppDomain.CurrentDomain.BaseDirectory};
    Process worker;try{worker=Process.Start(start);}catch(Win32Exception e){Send(Console.Out,new{ok=false,code=e.NativeErrorCode==1223?"UAC_CANCELLED":"ADMIN_LAUNCH_FAILED",elevated=false});return;}
    if(worker==null)throw new Exception("ADMIN_NO_WORKER");int transferring=1;using(worker)using(var workerWatch=new Timer(_=>{try{if(Volatile.Read(ref transferring)==0&&worker.HasExited)Environment.Exit(0);}catch{}},null,250,250)){var connected=pipe.WaitForConnectionAsync();if(!connected.Wait(90000))throw new Exception("ADMIN_UAC_TIMEOUT");uint peer;if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out peer)||peer!=worker.Id)throw new Exception("ADMIN_PEER_MISMATCH");
     using(var reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true))using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true)){writer.AutoFlush=true;var ready=Parse(Read(reader));if(Convert.ToInt32(ready["pid"])!=worker.Id||S(ready,"sid")!=Sid)throw new Exception("ADMIN_IDENTITY_MISMATCH");Send(Console.Out,ready);
      Volatile.Write(ref transferring,0);string line;while((line=Read(Console.In))!=null){Volatile.Write(ref transferring,1);writer.WriteLine(line);var answer=Read(reader);if(answer==null)throw new Exception("ADMIN_WORKER_EXITED");Console.Out.WriteLine(answer);Console.Out.Flush();Volatile.Write(ref transferring,0);}
     }
    }
   }
  }
 }
 static void Worker(string[] args,bool fixture){
  int parent=int.Parse(args[2]);long birth=long.Parse(args[3]);DateTime expires=Deadline(args[4]);if(Sid!=args[5]||!Alive(parent,birth)||!fixture&&!Elevated())throw new Exception("ADMIN_IDENTITY_OR_ELEVATION_REQUIRED");
  OwnWorker();using(var watch=Watch(parent,birth,expires))using(var pipe=new NamedPipeClientStream(".",args[1],PipeDirection.InOut,PipeOptions.Asynchronous)){
   pipe.Connect(10000);uint peer;if(!GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out peer)||peer!=parent)throw new Exception("ADMIN_PEER_MISMATCH");
   using(var reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true))using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true)){writer.AutoFlush=true;Send(writer,new{ok=true,ready=true,elevated=Elevated(),pid=Process.GetCurrentProcess().Id,sid=Sid});string line;
    while((line=Read(reader))!=null){var request=Parse(line);object id=request.ContainsKey("id")?request["id"]:null;bool started=false;try{
     string exe=S(request,"executable"),cwd=S(request,"cwd");if(DateTime.UtcNow>=expires)throw new Exception("ADMIN_EXPIRED");if(!Path.IsPathRooted(exe)||!Path.IsPathRooted(cwd)||!exe.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(exe)||!Directory.Exists(cwd)||exe.IndexOf('\0')>=0||cwd.IndexOf('\0')>=0)throw new Exception("ADMIN_EXECUTABLE_OR_CWD_INVALID");
     var argv=request.ContainsKey("args")?((System.Collections.IEnumerable)request["args"]).Cast<object>().ToArray():new object[0];if(argv.Length>128)throw new Exception("ADMIN_ARGUMENT_LIMIT");int timeout=request.ContainsKey("timeoutMs")?Convert.ToInt32(request["timeoutMs"]):25000;if(timeout<100||timeout>25000)throw new Exception("ADMIN_TIMEOUT_INVALID");
     var start=new ProcessStartInfo(exe,String.Join(" ",argv.Select(a=>Quote(Convert.ToString(a))))){WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true};
     var output=new StringBuilder();var error=new StringBuilder();var streams=new CountdownEvent(2);Action<StringBuilder,string> append=(b,s)=>{if(s==null)return;lock(b){if(b.Length<32768)b.AppendLine(s.Length>32768-b.Length?s.Substring(0,32768-b.Length):s);}};
     using(var process=new Process{StartInfo=start}){process.OutputDataReceived+=(s,e)=>{if(e.Data==null)streams.Signal();else append(output,e.Data);};process.ErrorDataReceived+=(s,e)=>{if(e.Data==null)streams.Signal();else append(error,e.Data);};process.Start();started=true;process.StandardInput.Close();process.BeginOutputReadLine();process.BeginErrorReadLine();if(!process.WaitForExit(Math.Min(timeout,Math.Max(1,(int)(expires-DateTime.UtcNow).TotalMilliseconds)))){Send(writer,new{id,ok=false,code="ADMIN_COMMAND_TIMEOUT",effectStarted=true,outcomeUnknown=true});Environment.Exit(124);}bool complete=streams.Wait(500);Send(writer,new{id,outputComplete=complete,ok=true,state=process.ExitCode==0?"succeeded":"failed",exitCode=process.ExitCode,stdout=output.ToString(),stderr=error.ToString(),elevated=Elevated()});}
    }catch(Exception e){Send(writer,new{id,ok=false,code=e is Win32Exception?"ADMIN_PROCESS_START_FAILED":e.Message,effectStarted=started,outcomeUnknown=started});}}
   }
  }
 }
 public static void Main(string[] args){Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);try{if(args.Length==1&&args[0]=="--probe"){Send(Console.Out,new{elevated=Elevated(),sid=Sid,processBirth=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks});return;}if(args.Length==1&&(args[0]=="--launch"||args[0]=="--fixture")){Launch(args[0]=="--fixture");return;}if(args.Length==6&&(args[0]=="--worker"||args[0]=="--fixture-worker")){Worker(args,args[0]=="--fixture-worker");return;}throw new Exception("ADMIN_ARGUMENTS_INVALID");}catch(Exception e){Send(Console.Out,new{ok=false,code=e.Message,elevated=false});Environment.ExitCode=1;}finally{if(job!=IntPtr.Zero)CloseHandle(job);}}
}
