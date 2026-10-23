import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Uninstall reports deleted, changed, locked and private files without deleting retained data',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-uninstall-report-'));
 try{
  fs.copyFileSync('build/YGPTLocal.exe',path.join(root,'YGPTLocal.exe'));
  const source=String.raw`using System;using System.IO;using System.Linq;using System.Collections.Generic;
public static class UninstallReportFixture {
 static void Check(bool value,string text){if(!value)throw new Exception(text);}
 public static int Main(string[] args){string install=Path.Combine(args[0],"application"),data=Path.Combine(install,"data");Directory.CreateDirectory(data);Directory.CreateDirectory(Path.Combine(install,".updates"));
  File.WriteAllText(Path.Combine(data,"private.txt"),"owner data");File.WriteAllText(Path.Combine(install,"good.txt"),"installed");File.WriteAllText(Path.Combine(install,"changed.txt"),"installed");File.WriteAllText(Path.Combine(install,"locked.txt"),"installed");File.WriteAllText(Path.Combine(install,"notes.txt"),"user notes");
  HostCore.Save(Path.Combine(install,".ygpt-install.json"),new{product="YGPT Local",installRoot=install});
  var files=new List<object>();foreach(string name in new[]{"good.txt","changed.txt","locked.txt","data/private.txt"})files.Add(new{path=name,sha256=YGPTApp.Hash(Path.Combine(install,name))});HostCore.Save(Path.Combine(install,"manifest.json"),new{files=files});File.WriteAllText(Path.Combine(install,"changed.txt"),"owner change");
  Dictionary<string,object> report;using(var locked=new FileStream(Path.Combine(install,"locked.txt"),FileMode.Open,FileAccess.ReadWrite,FileShare.None))report=YGPTApp.RemoveOwnedFiles(install,data);
  Check(Convert.ToInt32(report["removedFiles"])==1,"Exact installed file must be removed");Check(Convert.ToInt32(report["changedFilesKept"])==1&&Convert.ToInt32(report["blockedFiles"])==1,"Changed and locked files need distinct counts");Check((string)report["state"]=="files-remain","Partial removal must not be reported as complete");
  foreach(string name in new[]{"changed.txt","locked.txt","notes.txt","data/private.txt","manifest.json",".ygpt-install.json"})Check(File.Exists(Path.Combine(install,name)),"Retained file missing: "+name);
  string details=HostCore.Json.Serialize(report);Check(details.Contains("unregistered user file")&&details.Contains("private data"),"Receipt must explain remaining files");
  var second=YGPTApp.RemoveOwnedFiles(install,data);Check(Convert.ToInt32(second["removedFiles"])==1&&Convert.ToInt32(second["changedFilesKept"])==1,"Retry must remove the unlocked file but preserve edits");
  string unsafeDir=Path.Combine(args[0],"unsafe");Directory.CreateDirectory(unsafeDir);File.WriteAllText(Path.Combine(unsafeDir,"keep.txt"),"keep");HostCore.Save(Path.Combine(unsafeDir,".ygpt-install.json"),new{product="YGPT Local",installRoot=unsafeDir});HostCore.Save(Path.Combine(unsafeDir,"manifest.json"),new{files=new[]{new{path="keep.txt",sha256=YGPTApp.Hash(Path.Combine(unsafeDir,"keep.txt"))},new{path="../outside.txt",sha256=new string('0',64)}}});bool refused=false;try{YGPTApp.RemoveOwnedFiles(unsafeDir,Path.Combine(unsafeDir,"data"));}catch{refused=true;}Check(refused&&File.Exists(Path.Combine(unsafeDir,"keep.txt")),"Validate every entry before deleting any file");
  Console.WriteLine("UNINSTALL_REPORT_PASS");return 0;}}
`;
  const file=path.join(root,'Fixture.cs');fs.writeFileSync(file,source);
  const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319');
  execFileSync(path.join(framework,'csc.exe'),['/nologo','/target:exe','/out:'+path.join(root,'Fixture.exe'),'/reference:'+path.join(root,'YGPTLocal.exe'),file],{windowsHide:true,stdio:'pipe'});
  const output=execFileSync(path.join(root,'Fixture.exe'),[root],{windowsHide:true,encoding:'utf8',timeout:30000});assert.match(output,/UNINSTALL_REPORT_PASS/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
