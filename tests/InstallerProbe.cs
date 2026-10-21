using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class InstallerProbe {
 static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=4*1024*1024};
 static AutomationElement window;static string phase="start";static Process app;static string data;
 static T Wait<T>(Func<T> fn,int seconds=40) where T:class {var end=DateTime.UtcNow.AddSeconds(seconds);Exception last=null;while(DateTime.UtcNow<end){try{var value=fn();if(value!=null)return value;}catch(Exception e){last=e;}Thread.Sleep(200);}throw new Exception("Condition not observed at "+phase+(last==null?"":": "+last.Message));}
 static AutomationElement Find(string id){return window.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.AutomationIdProperty,id));}
 static void Value(string id,string value){((ValuePattern)Wait(()=>Find(id)).GetCurrentPattern(ValuePattern.Pattern)).SetValue(value);}
 static void Next(){((InvokePattern)Find("next").GetCurrentPattern(InvokePattern.Pattern)).Invoke();}
 static string Quote(string s){if(s.Contains("\"")||s.Any(c=>c<' '))throw new Exception("Invalid path");return "\""+s+"\"";}
 static string Run(string exe,string args){var si=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};using(var p=Process.Start(si)){var stdout=p.StandardOutput.ReadToEndAsync();var stderr=p.StandardError.ReadToEndAsync();if(!p.WaitForExit(15000))throw new Exception("Bundled runtime test timed out");if(p.ExitCode!=0)throw new Exception("Bundled runtime returned "+p.ExitCode);return stdout.Result.Trim();}}
 static bool OnPath(string name){return (Environment.GetEnvironmentVariable("PATH")??"").Split(';').Any(p=>File.Exists(Path.Combine(p,name)));}
 static Dictionary<string,object> Read(string file){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));}
 [STAThread] public static int Main(string[] args){var result=new Dictionary<string,object>{{"passed",false},{"source","actual packaged GUI installation driven by Windows UI Automation"},{"phase",phase},{"chatgptVerified",false},{"cleanWindowsVm",false}};
  if(args.Length<3)throw new Exception("Arguments: installer, new disposable scratch folder, result file");string setup=Path.GetFullPath(args[0]),scratch=Path.GetFullPath(args[1]),output=Path.GetFullPath(args[2]);
  try{
   if(Directory.Exists(scratch)||scratch==Path.GetPathRoot(scratch))throw new Exception("Use a new disposable scratch folder");Directory.CreateDirectory(scratch);string workspace=Path.Combine(scratch,"workspace"),install=Path.Combine(scratch,"application");data=Path.Combine(scratch,"data");Directory.CreateDirectory(workspace);
   result["nodeOnPathBefore"]=OnPath("node.exe");result["pythonOnPathBefore"]=OnPath("python.exe");result["gitOnPathBefore"]=OnPath("git.exe");result["administratorToken"]=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
   var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
   app=Process.Start(new ProcessStartInfo(setup,"--install-dir "+Quote(install)+" --data-dir "+Quote(data)){UseShellExecute=false});phase="window";window=Wait(()=>{app.Refresh();return app.MainWindowHandle==IntPtr.Zero?null:AutomationElement.FromHandle(app.MainWindowHandle);});Value("folder",workspace);((TogglePattern)Find("consent").GetCurrentPattern(TogglePattern.Pattern)).Toggle();Next();
   phase="environment";Wait(()=>Find("port"));Value("port",port.ToString());foreach(AutomationElement e in window.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.CheckBox))){object pattern;if(e.TryGetCurrentPattern(TogglePattern.Pattern,out pattern)&&((TogglePattern)pattern).Current.ToggleState==ToggleState.On)((TogglePattern)pattern).Toggle();}Next();
   phase="connection";((SelectionItemPattern)Wait(()=>Find("mode-local-only")).GetCurrentPattern(SelectionItemPattern.Pattern)).Select();Next();Next();phase="install";var button=Wait(()=>window.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.NameProperty,"Install & configure"),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button))));((InvokePattern)button.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
   phase="configuration";Wait(()=>{if(File.Exists(Path.Combine(data,"ygpt.config.json")))return "ready";var e=Find("setup-message");if(e!=null&&e.Current.Name.Length>0&&!e.Current.Name.StartsWith("Installing"))throw new Exception(e.Current.Name);return null;},180);
   var encrypted=File.ReadAllText(Path.Combine(data,"credentials.dpapi"));if(!encrypted.StartsWith("dpapi:"))throw new Exception("Unencrypted credentials");var secrets=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(encrypted.Substring(6)),null,DataProtectionScope.CurrentUser)));
   phase="local service";var health=Wait(()=>{var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+port+"/healthz");req.Headers["Authorization"]="Bearer "+secrets["localKey"];req.Timeout=1500;using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());});if(!(bool)health["localReady"]||(bool)health["hostLinked"])throw new Exception("Local/host state mismatch");
   result["node"]=Run(Path.Combine(install,"runtimes","node","node.exe"),"--version");result["python"]=Run(Path.Combine(install,"runtimes","python","python.exe"),"-c \"import platform; print(platform.python_version())\"");result["publicTools"]=health["publicTools"];result["appOnly"]=health["appOnly"];result["localReady"]=true;result["credentialsEncrypted"]=true;result["passed"]=true;
  }catch(Exception e){result["error"]=e.Message;result["errorType"]=e.GetType().Name;}finally{result["phase"]=phase;result["at"]=DateTime.UtcNow.ToString("o");Directory.CreateDirectory(Path.GetDirectoryName(output));File.WriteAllText(output,json.Serialize(result),new UTF8Encoding(false));if(data!=null&&Directory.Exists(data))File.WriteAllText(Path.Combine(data,"paused"),"Disposable installer test complete");if(app!=null&&!app.HasExited)app.CloseMainWindow();}
  return (bool)result["passed"]?0:1;
 }
}
