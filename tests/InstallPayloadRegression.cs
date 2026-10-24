using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Security.Cryptography;
using System.Windows;

// Window constructors are unreachable; this fixture calls only payload logic.
public class SetupWindow:Window {public SetupWindow(string data,string install){throw new Exception("Setup UI must not run in this fixture");}public void Uninstall(){throw new Exception("Uninstall must not run in this fixture");}}
public class UpdateWindow:Window {public UpdateWindow(){throw new Exception("Updater UI must not run in this fixture");}}
public class ApprovalWindow:Window {public ApprovalWindow(string data){throw new Exception("Approval UI must not run in this fixture");}}
public static class InstallPayloadRegression {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void Add(ZipArchive zip,string name,string text){using(var stream=zip.CreateEntry(name).Open())using(var writer=new StreamWriter(stream,new UTF8Encoding(false)))writer.Write(text);}
 static MemoryStream Payload(string mode){
  var stream=new MemoryStream();string content="new application",digest;using(var hash=SHA256.Create())digest=HostCore.Hex(hash.ComputeHash(Encoding.UTF8.GetBytes(content)));
  using(var zip=new ZipArchive(stream,ZipArchiveMode.Create,true)){
   Add(zip,"app.txt",content);
   Add(zip,"manifest.json",HostCore.Json.Serialize(new{product="YGPT Local",version=mode=="wrong-version"?"other":HostCore.Version,files=new[]{new{path="app.txt",bytes=content.Length,sha256=mode=="bad-hash"?new string('0',64):digest}}}));
   if(mode=="unsafe-entry")Add(zip,"../escaped.txt","must not escape");
   // This forces ownership-marker creation to fail after verification. The
   // installed directory must still be present and unchanged at that point.
   if(mode=="marker-write-failure")Add(zip,".ygpt-install.json/child.txt","occupied marker path");
  }
  stream.Position=0;return stream;
 }
 public static int Main(string[] args){
  string root=args[0],install=Path.Combine(root,"application"),data=Path.Combine(root,"private-data");Directory.CreateDirectory(install);Directory.CreateDirectory(data);Directory.CreateDirectory(Path.Combine(install,"data"));File.WriteAllText(Path.Combine(install,"data","nested-sentinel.txt"),"nested private data");
  File.WriteAllText(Path.Combine(install,"original.txt"),"old application");File.WriteAllText(Path.Combine(data,"sentinel.txt"),"private fixture data");
  HostCore.Save(Path.Combine(install,".ygpt-install.json"),new{product="YGPT Local",version="old",installRoot=install});
  foreach(string mode in new[]{"bad-hash","unsafe-entry","wrong-version","marker-write-failure"}){
   bool failed=false;try{using(var payload=Payload(mode))YGPTApp.InstallPayload(install,payload);}catch{failed=true;}
   Check(failed,"Invalid payload accepted: "+mode);
   Check(File.ReadAllText(Path.Combine(install,"original.txt"))=="old application","Original application changed: "+mode);
   Check(HostCore.S(HostCore.Read(Path.Combine(install,".ygpt-install.json")),"version")=="old","Original ownership changed: "+mode);
   Check(Directory.GetDirectories(root,"application.staging-*").Length==0,"Staging was leaked: "+mode);
   Check(Directory.GetDirectories(root,"application.previous-*").Length==0,"Original was moved before validation completed: "+mode);
   Check(!File.Exists(Path.Combine(root,"escaped.txt")),"Archive escaped staging");
  }
  using(var payload=Payload("valid"))YGPTApp.InstallPayload(install,payload);
  Check(File.ReadAllText(Path.Combine(install,"app.txt"))=="new application","New application missing");
  var marker=HostCore.Read(Path.Combine(install,".ygpt-install.json"));Check(HostCore.S(marker,"version")==HostCore.Version&&String.Equals(HostCore.S(marker,"installRoot"),HostCore.Full(install),StringComparison.OrdinalIgnoreCase),"New ownership missing or incorrect");
  var retained=Directory.GetDirectories(root,"application.previous-*");Check(retained.Length==0,"Rollback must never escape the installation root");
  var internalBackups=Directory.GetFiles(Path.Combine(install,".updates"),".ygpt-install.json",SearchOption.AllDirectories);Check(internalBackups.Length==1,"Rollback ownership not retained inside the installation");
  Check(File.ReadAllText(Path.Combine(install,"original.txt"))=="old application","Unknown user file was replaced");
  Check(Directory.GetDirectories(root,"application.staging-*").Length==0,"Successful update leaked staging");
  Check(File.ReadAllText(Path.Combine(data,"sentinel.txt"))=="private fixture data","Private data changed");Check(File.ReadAllText(Path.Combine(install,"data","nested-sentinel.txt"))=="nested private data","Nested data changed during update");
  // A disposable shell shortcut: verify the actual .lnk icon property, never
  // write to the owner's Start Menu or Desktop in a regression fixture.
  string icon=Path.Combine(install,"assets","ygpt-"+HostCore.Version+".ico"),shortcut=Path.Combine(root,"fixture.lnk");Directory.CreateDirectory(Path.GetDirectoryName(icon));
  File.Copy(Path.Combine(Environment.CurrentDirectory,"assets","ygpt.ico"),icon);
  YGPTApp.Shortcut(install,data,shortcut);
  dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic link=shell.CreateShortcut(shortcut);
  Check(String.Equals((string)link.TargetPath,Path.Combine(install,"YGPTLocal.exe"),StringComparison.OrdinalIgnoreCase),"Shortcut target changed");
  Check(String.Equals((string)link.IconLocation,icon+",0",StringComparison.OrdinalIgnoreCase),"Shortcut must use the shipped multi-size HD icon, independently of the cached exe icon");
  Console.WriteLine("INSTALL_PAYLOAD_PASS");return 0;
 }
}
