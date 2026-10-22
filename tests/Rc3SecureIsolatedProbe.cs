using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

public class Rc3SecureIsolatedProbe {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static string S(Dictionary<string,object> d,string key) { return d.ContainsKey(key)&&d[key]!=null?Convert.ToString(d[key]):""; }
 static bool B(Dictionary<string,object> d,string key) { return d.ContainsKey(key)&&d[key] is bool && (bool)d[key]; }
 public static int Main(string[] args){
  if(args.Length!=3) return 10;
  string root=Path.GetFullPath(args[0]),keyPath=Path.GetFullPath(args[1]),tunnelPath=Path.GetFullPath(args[2]);
  if(root.IndexOf(".ygpt-local-tests",StringComparison.OrdinalIgnoreCase)<0) return 11;
  string data=Path.Combine(root,"data"),install=Path.Combine(root,"application"),folder=Path.Combine(root,"workspace");
  var report=new Dictionary<string,object>{{"test","Isolated secure tunnel on real Windows; not a ChatGPT call"},{"sourceInstallerTest","separate packaged GUI acceptance"},{"keyPrinted",false},{"productionModified",false},{"phase","preflight"},{"remoteHandshakeVerified",false}};
  int exit=0;
  try{
   if(!File.Exists(Path.Combine(install,"YGPTWatchdog.exe"))||!File.Exists(Path.Combine(data,"credentials.dpapi"))||!Directory.Exists(folder))
     throw new InvalidOperationException("BASE_FIXTURE_MISSING");
   string keyFile=File.ReadAllText(keyPath,Encoding.UTF8);
   var m=Regex.Match(keyFile,@"sk-[A-Za-z0-9_-]{20,}");
   string tunnel=File.ReadAllText(tunnelPath,Encoding.UTF8).Trim();
   if(!m.Success||!Regex.IsMatch(tunnel,@"^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$"))throw new InvalidOperationException("CREDENTIAL_FILE_FORMAT_ERROR");
   var s=YGPTApp.Secrets(data);s["runtimeKey"]=m.Value;
   YGPTApp.SaveSecrets(data,s);
   report["phase"]="provision-secure-tunnel";
   var cfg=HostCore.Read(Path.Combine(data,"ygpt.config.json"));
   int port=Convert.ToInt32(cfg["port"]);
   var request=new Dictionary<string,object>{{"dataDir",data},{"projectRoot",folder},{"port",port},{"mode","secure-tunnel"},{"tunnelId",tunnel},{"autoStart",false},{"proxyUrl",""}};
   string response=YGPTApp.Node(install,"service/provision.mjs",null,Json.Serialize(request));
   var result=Json.Deserialize<Dictionary<string,object>>(response);
   if(!B(result,"ok"))throw new InvalidOperationException("PROVISION_FAILED: "+S(result,"code")+" "+S(result,"message"));
   report["phase"]="launch-owned-watchdog";
   HostCore.Start(install,data);
   var until=DateTime.UtcNow.AddSeconds(145);
   int maxRestarts=0;bool healthSeen=false;string lastPhase="unknown",lastError="",lastExit="";
   while(DateTime.UtcNow<until){
    Thread.Sleep(2000);
    try {
     var h=HostCore.Read(Path.Combine(data,"watchdog-health.json"));
     healthSeen=true;
     lastPhase=S(h,"phase");lastError=S(h,"lastError");lastExit=S(h,"lastExitCode");
     int r=Convert.ToInt32(h["restarts"]);if(r>maxRestarts)maxRestarts=r;
     if(B(h,"tunnelConnected")) {report["remoteHandshakeVerified"]=true;break;}
     if(lastPhase=="credentials-required"||lastPhase=="needs-attention"||lastPhase=="other-owner-active")break;
     if(r>=5)break;
    }catch{}
   }
   report["watchdogHealthSeen"]=healthSeen;
   report["watchdogPhase"]=lastPhase;
   report["classifiedError"]=lastError;
   report["lastExitCode"]=lastExit;
   report["maxRestarts"]=maxRestarts;
   report["phase"]="stop-only-this-test-profile";
   try {HostCore.Pause(data);report["safeStop"]=true;}catch{report["safeStop"]=false;}
   if(!B(report,"remoteHandshakeVerified")) {report["result"]="remote-connection-unverified";exit=2;}else {report["result"]="secure-tunnel-ready";exit=0;}
  } catch(Exception e){report["phase"]="failed";report["error"]=e is InvalidOperationException?e.Message:"ISOLATED_TEST_FAILED_"+e.GetType().Name;exit=3;}
  finally {
   report["finishedAt"]=DateTime.UtcNow.ToString("o");
   try {File.WriteAllText(Path.Combine(root,"secure-test-result.json"),Json.Serialize(report),new UTF8Encoding(false));}catch{}
   // Intentionally never print credentials, IDs, command lines or environment variables.
   Console.WriteLine(Json.Serialize(report));
  }
  return exit;
 }
}
