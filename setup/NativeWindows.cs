using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Management;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Management.Automation.Language;
using Microsoft.Win32.SafeHandles;

// Fixed Windows operations only. No script execution, Runspace, shell, policy
// changes, elevation, dynamic command construction or network requests.
public static class NativeWindows {
 static readonly string Sid=WindowsIdentity.GetCurrent().User.Value;
 static readonly string[] Allowed={Sid,"S-1-5-18"};
 const string EdgeSid="S-1-15-3-1024-3239966617-1410756637-3494353204-65451782-2225605771-3526040376-1730753648-3419555762",ChromeSid="S-1-15-3-1024-1653277547-598600573-1504598449-2187120098-1115546814-1860042162-2924348907-3700367812";
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h,uint code,IntPtr input,uint inputBytes,byte[] output,uint outputBytes,out uint returned,IntPtr overlap);
 // Read the substitute name without following the link. Only mount points can
 // be permitted; symbolic-link targets are read solely for refusal diagnostics.
 static string ReparseTarget(string file,bool mountOnly){
  using(var h=CreateFile(file,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){
   uint n;var b=new byte[16384];if(h.IsInvalid||!DeviceIoControl(h,0x900A8,IntPtr.Zero,0,b,(uint)b.Length,out n,IntPtr.Zero)||n<16||n>b.Length)return null;
   uint tag=BitConverter.ToUInt32(b,0);int start=tag==0xa0000003?16:!mountOnly&&tag==0xa000000c?20:0;
   if(start==0||n<start||BitConverter.ToUInt16(b,4)+8>n)return null;
   int offset=BitConverter.ToUInt16(b,8),length=BitConverter.ToUInt16(b,10);
   if(offset%2!=0||length%2!=0||start+offset+length>n)return null;
   return Encoding.Unicode.GetString(b,start+offset,length);
  }
 }
 static bool JunctionTargets(string file,string expected){return String.Equals(ReparseTarget(file,true),"\\??\\"+expected,StringComparison.OrdinalIgnoreCase);}
 static Exception StateFailure(string code,string file){var e=new Exception(code);e.Data["path"]=file;return e;}
 static Exception RefusedLink(string file){var e=StateFailure("STATE_LINK_REFUSED",file);try{e.Data["target"]=ReparseTarget(file,false)??"unavailable";}catch{e.Data["target"]="unavailable";}return e;}
 static bool SafeCacheJunction(string file,string root){
  foreach(string profile in new[]{"engine-home","home"}){string baseDir=Path.Combine(root,profile,"AppData","Local","Microsoft","Windows","INetCache"),expected=Path.Combine(baseDir,"IE");if(!String.Equals(file,Path.Combine(baseDir,"Content.IE5"),StringComparison.OrdinalIgnoreCase)||!Directory.Exists(expected))continue;try{HostCore.CheckPath(expected);}catch(IOException){return false;}
   return JunctionTargets(file,expected);
  }return false;
 }
 // Bun's immutable Windows package cache uses version-directory junctions
 // (for example scope/pkg/1.2.3@@@1 -> scope/pkg@1.2.3@@@1). Permit only this
 // exact two/three-component mapping under the isolated YGPT home, and only
 // when the NTFS mount-point target resolves to that existing cache sibling.
 // The target remains in the ordinary audit walk, so its ACL is still checked.
 static bool SafeBunCacheJunction(string file,string root){
  string cache=Path.Combine(root,"home",".bun","install","cache");if(!HostCore.Within(file,cache))return false;string relative=HostCore.Full(file).Substring(HostCore.Full(cache).Length+1);string[] parts=relative.Split('\\');string version;string expected="";
  if(parts.Length==2&&Regex.IsMatch(parts[0],@"^[A-Za-z0-9._-]+$")&&(version=Regex.Match(parts[1],@"^([A-Za-z0-9][A-Za-z0-9._+-]*)@@@1$").Groups[1].Value)!="")expected=Path.Combine(cache,parts[0]+"@"+version+"@@@1");
  else if(parts.Length==3&&Regex.IsMatch(parts[0],@"^@[A-Za-z0-9._-]+$")&&Regex.IsMatch(parts[1],@"^[A-Za-z0-9._-]+$")&&(version=Regex.Match(parts[2],@"^([A-Za-z0-9][A-Za-z0-9._+-]*)@@@1$").Groups[1].Value)!="")expected=Path.Combine(Path.Combine(cache,parts[0]),parts[1]+"@"+version+"@@@1");
  if(expected==""||!Directory.Exists(expected))return false;expected=HostCore.Full(expected);if(!HostCore.Within(expected,cache))return false;try{HostCore.CheckPath(expected);}catch(IOException){return false;}return JunctionTargets(file,expected);
 }
 static void CheckStateRoot(string root){for(string p=root;!String.IsNullOrEmpty(p);p=Path.GetDirectoryName(p)){if((File.Exists(p)||Directory.Exists(p))&&(File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw RefusedLink(p);}}
 static FileSystemSecurity Acl(string p){return Directory.Exists(p)?(FileSystemSecurity)Directory.GetAccessControl(p):File.GetAccessControl(p);}
 static bool Extra(FileSystemSecurity acl){return acl.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(r=>r.AccessControlType==AccessControlType.Allow&&!Allowed.Contains(r.IdentityReference.Value));}
 static void SetPrivate(string root){var acl=Directory.GetAccessControl(root,AccessControlSections.Access);acl.SetAccessRuleProtection(true,false);foreach(FileSystemAccessRule r in acl.GetAccessRules(true,false,typeof(SecurityIdentifier)))acl.RemoveAccessRuleSpecific(r);foreach(string s in Allowed)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(s),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(root,acl);}
 static void FixOwnedShims(string root){string tmp=Path.Combine(root,"tmp");if(!Directory.Exists(tmp))return;HostCore.CheckPath(tmp);foreach(string dir in Directory.GetDirectories(tmp,"bun-node-*",SearchOption.TopDirectoryOnly)){HostCore.CheckPath(dir);if(Extra(Acl(dir)))throw new Exception("SHIM_PARENT_ACL_UNSAFE");foreach(string name in new[]{"bun.exe","node.exe"}){string file=Path.Combine(dir,name);if(!File.Exists(file))continue;HostCore.CheckPath(file);if(File.GetAccessControl(file,AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier)).Value!=Sid)throw new Exception("SHIM_OWNER_MISMATCH");var acl=File.GetAccessControl(file,AccessControlSections.Access);if(!Extra(acl))continue;acl.SetAccessRuleProtection(true,false);foreach(FileSystemAccessRule r in acl.GetAccessRules(true,false,typeof(SecurityIdentifier)))acl.RemoveAccessRuleSpecific(r);foreach(string s in Allowed)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(s),FileSystemRights.FullControl,AccessControlType.Allow));File.SetAccessControl(file,acl);}}}
 // Chrome's network service also grants its fixed capability SID to numbered
 // profiles. Limit that exception to owned cache/storage descendants in the
 // isolated Chrome tree; profile roots, credentials and arbitrary SIDs still fail.
 static bool ChromeCache(string relative){return Regex.IsMatch(relative,@"^(?:engine-home|home)\\AppData\\Local\\Google\\Chrome\\User Data\\(?:Default|Profile [1-9][0-9]*)\\(?:Cache|Network|Safe Browsing Network|Shared Dictionary|Storage)(?:\\|$)",RegexOptions.IgnoreCase);}
 // Application-created cache DACLs are not control-state DACLs. Recognize
 // only observed cache layouts and their expected Windows principal; owner
 // checks, links, credentials and unknown SIDs remain fail-closed below.
 static bool ApplicationCacheSid(string relative,string sid){
  if(sid=="S-1-5-32-544"&&Regex.IsMatch(relative,@"^tmp\\WinGet(?:\\|$)",RegexOptions.IgnoreCase))return true;
  bool wheel=Regex.IsMatch(relative,@"^(?:engine-home|home)\\AppData\\Local\\pip\\cache\\wheels\\(?:[a-f0-9]{2}\\){3}[a-f0-9]{16,}\\[^\\/]+\.whl$",RegexOptions.IgnoreCase);
  if(wheel&&sid=="S-1-5-32-544")return true;
  return sid==EdgeSid&&Regex.IsMatch(relative,@"^(?:tmp\\tmp[a-z0-9_-]{6,}|(?:engine-home|home)\\AppData\\Roaming\\[a-z0-9_. -]+\.exe|(?:engine-home|home)\\AppData\\Local\\io\.github\.clash-verge-rev\.clash-verge-rev)\\EBWebView\\Default\\(?:Cache|Network|Shared Dictionary)(?:\\|$)",RegexOptions.IgnoreCase);
 }
 public static object State(string root,bool verify){root=HostCore.Full(root);if(root==Path.GetPathRoot(root).TrimEnd('\\'))throw StateFailure("DRIVE_ROOT_REFUSED",root);CheckStateRoot(root);if(!verify){Directory.CreateDirectory(root);SetPrivate(root);FixOwnedShims(root);}var actual=Directory.GetAccessControl(root);if(!actual.AreAccessRulesProtected||Extra(actual))throw StateFailure("STATE_ACL_UNSAFE",root);
  var stack=new Stack<string>();stack.Push(root);while(stack.Count>0){string dir=stack.Pop();foreach(string file in Directory.GetFileSystemEntries(dir)){var attributes=File.GetAttributes(file);if((attributes&FileAttributes.ReparsePoint)!=0){if(SafeCacheJunction(file,root)||SafeBunCacheJunction(file,root))continue;throw RefusedLink(file);}var acl=Acl(file);string relative=file.Substring(root.Length+1);bool edge=Regex.IsMatch(relative,@"^tmp\\playwright_chromiumdev_profile-[A-Za-z0-9_-]{6,}\\Default\\(?:Cache|Network|Shared Dictionary)(?:\\|$)",RegexOptions.IgnoreCase),chrome=ChromeCache(relative);bool owner=acl.GetOwner(typeof(SecurityIdentifier)).Value==Sid;foreach(FileSystemAccessRule r in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))){string sid=r.IdentityReference.Value;if(r.AccessControlType==AccessControlType.Allow&&!Allowed.Contains(sid)&&!(owner&&((edge&&sid==EdgeSid)||(chrome&&sid==ChromeSid)||ApplicationCacheSid(relative,sid))))throw StateFailure("STATE_DESCENDANT_ACL_UNSAFE",file);}if((attributes&FileAttributes.Directory)!=0)stack.Push(file);}}
  return new{ownerSid=Sid,@protected=actual.AreAccessRulesProtected,allowedSids=Allowed,descendantsChecked=true,sddl=actual.GetSecurityDescriptorSddlForm(AccessControlSections.All)};
 }
 static string Flag(string command,string flag){var m=Regex.Match(command,@"(?:^|\s)"+Regex.Escape(flag)+"(?:=|\\s+)(?:\"([^\"]*)\"|([^\\s]+))");return m.Success?(m.Groups[1].Success?m.Groups[1].Value:m.Groups[2].Value):"";}
 public static object TunnelInventory(string id){if(!Regex.IsMatch(id,@"^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$"))throw new Exception("INVALID_TUNNEL_ID");bool known=true,conflict=false;try{using(var query=new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='tunnel-client.exe'")){foreach(ManagementObject p in query.Get()){string command=Convert.ToString(p["CommandLine"]);if(command==""){known=false;continue;}if(Regex.IsMatch(command,@"(?<![a-z0-9_])"+Regex.Escape(id)+@"(?![a-z0-9_])")){conflict=true;continue;}string literal=Flag(command,"--control-plane.tunnel-id");if(Regex.IsMatch(literal,@"^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$"))continue;string profile=Flag(command,"--profile"),dir=Flag(command,"--profile-dir");if(dir==""||!Regex.IsMatch(profile,@"^[A-Za-z0-9_-][A-Za-z0-9_.-]*$")||profile.Contains("..")){known=false;continue;}string file=Path.Combine(dir,profile+".yaml");HostCore.CheckPath(file);string text=File.ReadAllText(file),other="";var m=Regex.Match(text,"(?m)^\\s*tunnel_id:\\s*[\"']?(tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32})[\"']?\\s*(?:#.*)?$");if(m.Success)other=m.Groups[1].Value;else if(text.TrimStart().StartsWith("{")){var obj=HostCore.Json.Deserialize<Dictionary<string,object>>(text);if(obj.ContainsKey("control_plane"))other=HostCore.S((Dictionary<string,object>)obj["control_plane"],"tunnel_id");}if(!Regex.IsMatch(other,@"^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$")){known=false;continue;}if(other==id)conflict=true;}}}catch{known=false;}return new{conflict=conflict,processInventoryAvailable=known};}
 static readonly HashSet<string> ReadCommands=new HashSet<string>(("get-childitem gci dir ls get-content gc cat type get-item gi get-itemproperty get-itempropertyvalue test-path resolve-path convert-path split-path join-path select-object select where-object where foreach-object sort-object sort measure-object group-object select-string format-list format-table format-wide out-string convertto-json convertfrom-json get-date get-location pwd get-process get-service get-scheduledtask get-scheduledtaskinfo get-ciminstance get-wmiobject get-winevent get-eventlog get-disk get-partition get-volume get-acl get-filehash get-computerinfo write-output echo").Split(' '),StringComparer.OrdinalIgnoreCase);
 public static bool ReadOnly(string text){if(text.Length>12000)return false;Token[] tokens;ParseError[] errors;var ast=Parser.ParseInput(text,out tokens,out errors);if(errors.Length>0)return false;int count=0;foreach(var n in ast.FindAll(a=>true,true)){var command=n as CommandAst;if(command!=null){count++;string name=command.GetCommandName();if(name==null||!ReadCommands.Contains(name)||command.InvocationOperator!=TokenKind.Unknown)return false;foreach(var e in command.CommandElements){var parameter=e as CommandParameterAst;if(parameter!=null&&Regex.IsMatch(parameter.ParameterName,@"^(?:OutVariable|ov|PipelineVariable|pv|ErrorVariable|ev)$",RegexOptions.IgnoreCase))return false;}if(String.Equals(name,"foreach-object",StringComparison.OrdinalIgnoreCase)&&command.CommandElements.Skip(1).Any(e=>!(e is ScriptBlockExpressionAst)&&!(e is CommandParameterAst)))return false;}
   if(n is InvokeMemberExpressionAst||n is AssignmentStatementAst||n is RedirectionAst||n is TypeExpressionAst||n is FunctionDefinitionAst||n is UsingStatementAst||n is TrapStatementAst)return false;var unary=n as UnaryExpressionAst;if(unary!=null&&new[]{TokenKind.PlusPlus,TokenKind.MinusMinus,TokenKind.PostfixPlusPlus,TokenKind.PostfixMinusMinus}.Contains(unary.TokenKind))return false;var variable=n as VariableExpressionAst;if(variable!=null&&!Regex.IsMatch(variable.VariablePath.UserPath,@"^(?:_|PSItem|true|false|null|env:[A-Za-z_][A-Za-z0-9_]*)$",RegexOptions.IgnoreCase))return false;var member=n as MemberExpressionAst;if(member!=null&&member.Static)return false;}
  return count>0;
 }
 static string PartitionType(ManagementObject p){string g=Convert.ToString(p["GptType"]).Trim('{','}').ToLowerInvariant();switch(g){case "c12a7328-f81f-11d2-ba4b-00a0c93ec93b":return "System";case "e3c9e316-0b5c-4db8-817d-f92df00215ae":return "Reserved";case "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7":return "Basic";case "de94bba4-06d1-4d40-a16a-bfd50179d6ac":return "Recovery";}return g!=""?g:Convert.ToString(p["MbrType"]);}
 public static object Disks(){var disks=new List<object>();var scope=new ManagementScope(@"\\.\root\Microsoft\Windows\Storage");string[] buses={"Unknown","SCSI","ATAPI","ATA","1394","SSA","Fibre Channel","USB","RAID","iSCSI","SAS","SATA","SD","MMC","Virtual","File Backed Virtual","Storage Spaces","NVMe","SCM","UFS"};using(var q=new ManagementObjectSearcher(scope,new ObjectQuery("SELECT Number,FriendlyName,SerialNumber,Size,BusType,IsReadOnly,IsOffline FROM MSFT_Disk"))){foreach(ManagementObject d in q.Get()){uint number=Convert.ToUInt32(d["Number"]);int bus=Convert.ToInt32(d["BusType"]);var parts=new List<object>();using(var pq=new ManagementObjectSearcher(scope,new ObjectQuery("SELECT * FROM MSFT_Partition WHERE DiskNumber="+number))){foreach(ManagementObject p in pq.Get())parts.Add(new{number=p["PartitionNumber"],driveLetter=Convert.ToString(p["DriveLetter"]).Trim('\0'),sizeBytes=p["Size"],type=PartitionType(p)});}disks.Add(new{number=number,model=d["FriendlyName"],serial=Convert.ToString(d["SerialNumber"]).Trim(),sizeBytes=d["Size"],busType=bus>=0&&bus<buses.Length?buses[bus]:"Unknown",partitions=parts,readOnly=d["IsReadOnly"],offline=d["IsOffline"]});}}return disks;}
 public static int Main(){try{Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);var q=HostCore.Json.Deserialize<Dictionary<string,object>>(Console.In.ReadToEnd());string action=HostCore.S(q,"action");object result;switch(action){case "state-prepare":result=State(HostCore.S(q,"root"),false);break;case "state-verify":result=State(HostCore.S(q,"root"),true);break;case "tunnel-inventory":result=TunnelInventory(HostCore.S(q,"id"));break;case "command-readonly":result=ReadOnly(HostCore.S(q,"command"));break;case "disk-inventory":result=Disks();break;default:throw new Exception("UNSUPPORTED_ACTION");}Console.WriteLine(HostCore.Json.Serialize(new{ok=true,result=result}));return 0;}catch(Exception e){string code=Regex.IsMatch(e.Message,@"^[A-Z_]+$")?e.Message:"WINDOWS_CHECK_UNAVAILABLE";Console.WriteLine(HostCore.Json.Serialize(new{ok=false,code=code,path=e.Data["path"] as string,target=e.Data["target"] as string}));return 1;}}
}
