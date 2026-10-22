// YGPT Local native adapter over Microsoft's Windows UI Automation/Win32 APIs.
// No credentials, elevation, public sockets, or UIA actions against terminal/security apps.
// ChatGPT Desktop Agent / Codex windows are never targets: identity is decided by
// executable path, package location, Authenticode signer, verified process-tree
// ancestry (parent start time precedes child) and the owner-window chain.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;
class FixtureForm:Form {protected override bool ShowWithoutActivation {get{return true;}}}
class YDesktop {
  static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=1048576};
  delegate bool EnumProc(IntPtr h,IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p,IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern uint SendInput(uint n,INPUT[] input,int size);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h,int index,StringBuilder name,uint length,out uint needed);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint cmd);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,int flags,StringBuilder name,ref int size);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h,out long creation,out long exit,out long kernel,out long user);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h,int cls,ref PBI info,int size,out int written);
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr ExitStatus,Peb,Affinity,Priority,UniqueId,ParentId; }
  class Ident { public int Pid,Parent;public string Name,Exe,Signer;public long Created; }
  static Dictionary<int,Ident> identities=new Dictionary<int,Ident>();
  static Dictionary<string,string> signers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
  static string[] extraProtected=new string[0];
  static string[] agentNames={"chatgpt","codex","openai"};
  static string[] agentPaths={@"\windowsapps\openai.",@"\appdata\local\packages\openai.",@"\appdata\local\programs\chatgpt\",@"\appdata\local\programs\codex\",@"\appdata\local\openai\",@"\appdata\roaming\openai\",@"\appdata\local\chatgpt\",@"\appdata\roaming\chatgpt\"};
  static Ident Identify(int pid) {
    Ident cached;if(identities.TryGetValue(pid,out cached))return cached;
    var id=new Ident{Pid=pid,Parent=0,Name="",Exe=null,Signer="",Created=0};
    try{id.Name=Process.GetProcessById(pid).ProcessName.ToLowerInvariant();}catch{}
    IntPtr h=OpenProcess(0x1000,false,pid);
    if(h!=IntPtr.Zero){try{
      var b=new StringBuilder(1024);int n=b.Capacity;if(QueryFullProcessImageName(h,0,b,ref n))id.Exe=b.ToString();
      long c,e,k,u;if(GetProcessTimes(h,out c,out e,out k,out u))id.Created=c;
      var info=new PBI();int written;if(NtQueryInformationProcess(h,0,ref info,Marshal.SizeOf(typeof(PBI)),out written)==0)id.Parent=info.ParentId.ToInt32();
    }finally{CloseHandle(h);}}
    if(id.Exe!=null){string subject;if(!signers.TryGetValue(id.Exe,out subject)){subject="";try{subject=X509Certificate.CreateFromSignedFile(id.Exe).Subject;}catch{}signers[id.Exe]=subject;}id.Signer=subject;}
    identities[pid]=id;return id;
  }
  static bool AgentIdentity(Ident id) {
    if(agentNames.Contains(id.Name))return true;
    if(id.Signer.IndexOf("O=OpenAI",StringComparison.OrdinalIgnoreCase)>=0)return true;
    if(id.Exe==null)return false;string exe=id.Exe.ToLowerInvariant();
    foreach(string p in agentPaths)if(exe.Contains(p))return true;
    foreach(string p in extraProtected)if(p.Length>0&&exe.StartsWith(p.TrimEnd('\\')+"\\"))return true;
    return false;
  }
  // Reason a process may not be controlled, or null. Ancestors count only while
  // each parent provably started before its child, so a reused PID is ignored.
  static string ProtectedReason(int pid) {
    var self=Identify(pid);if(self.Exe==null)return "IDENTITY_UNVERIFIED";
    if(AgentIdentity(self))return "AGENT_PROCESS";
    var child=self;for(int depth=0;depth<12&&child.Parent>4;depth++){
      var parent=Identify(child.Parent);if(parent.Created==0||child.Created==0||parent.Created>child.Created)break;
      if(AgentIdentity(parent))return "AGENT_PROCESS_TREE";child=parent;
    }
    return null;
  }
  static string WindowProtection(IntPtr h,int pid) {
    string reason=ProtectedReason(pid);if(reason!=null)return reason;
    var owner=h;for(int i=0;i<8;i++){owner=GetWindow(owner,4);if(owner==IntPtr.Zero)break;uint opid;GetWindowThreadProcessId(owner,out opid);if(opid!=0&&(int)opid!=pid&&ProtectedReason((int)opid)!=null&&ProtectedReason((int)opid)!="IDENTITY_UNVERIFIED")return "AGENT_OWNED_WINDOW";}
    return null;
  }
  static void ReadProtected(Dictionary<string,object> d) {
    if(!d.ContainsKey("protectedPaths"))return;var list=new List<string>();var items=d["protectedPaths"] as System.Collections.IEnumerable;
    if(items!=null)foreach(object o in items){string v=Convert.ToString(o).Replace('/','\\').ToLowerInvariant();if(v.Length>3)list.Add(v);}
    extraProtected=list.ToArray();
  }
  struct RECT { public int Left,Top,Right,Bottom; }
  struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx,dy;public uint mouseData,dwFlags,time;public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan;public uint flags,time;public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit,Size=40)] struct INPUT { [FieldOffset(0)]public uint type;[FieldOffset(8)]public MOUSEINPUT mouse;[FieldOffset(8)]public KEYBDINPUT key; }
  static string S(Dictionary<string,object> d,string k,string fallback="") { return d.ContainsKey(k)?Convert.ToString(d[k]):fallback; }
  static bool Interactive() { IntPtr h=OpenInputDesktop(0,false,1);if(h==IntPtr.Zero)return false;try{var s=new StringBuilder(100);uint n;return GetUserObjectInformation(h,2,s,200,out n)&&s.ToString()=="Default";}finally{CloseDesktop(h);} }
  static string Title(IntPtr h){var s=new StringBuilder(1000);GetWindowText(h,s,s.Capacity);return s.ToString();}
  static object WindowInfo(IntPtr h) {uint id;GetWindowThreadProcessId(h,out id);var p=Process.GetProcessById((int)id);var ident=Identify((int)id);string exe=ident.Exe;if(exe==null){try{exe=p.MainModule.FileName;}catch{}}
    string reason=WindowProtection(h,(int)id);bool shielded=reason!=null&&reason!="IDENTITY_UNVERIFIED";
    // Agent window titles can carry private task content: never echo them.
    return new {hwnd=h.ToInt64().ToString(),pid=id,parentPid=ident.Parent,process=p.ProcessName,executablePath=shielded?null:exe,signer=shielded?"":ident.Signer,title=shielded?"[protected ChatGPT Desktop Agent window]":Title(h),birth=p.StartTime.ToUniversalTime().Ticks.ToString(),session=p.SessionId,@protected=reason!=null,protectedReason=reason};}
  static void Allowed(Process p) {string name=p.ProcessName.ToLowerInvariant();string[] deny={"powershell","pwsh","cmd","windowsterminal","conhost","consent","credentialuibroker","logonui","lockapp","sechealthui","msmpeng","1password","keepass","bitwarden","codex","chatgpt"};if(deny.Contains(name))throw new Exception("PROTECTED_APPLICATION: desktop control is unavailable for this application");if(p.SessionId!=Process.GetCurrentProcess().SessionId)throw new Exception("SESSION_MISMATCH");}
  static IntPtr Target(Dictionary<string,object> d) {var h=new IntPtr(long.Parse(S(d,"hwnd")));uint pid;if(!IsWindow(h))throw new Exception("STALE_WINDOW");GetWindowThreadProcessId(h,out pid);if(pid!=uint.Parse(S(d,"pid")))throw new Exception("WINDOW_IDENTITY_CHANGED");var p=Process.GetProcessById((int)pid);Allowed(p);if(p.StartTime.ToUniversalTime().Ticks.ToString()!=S(d,"birth"))throw new Exception("PROCESS_IDENTITY_CHANGED");
    // Re-checked before EVERY read or action, not only at bind time.
    string reason=WindowProtection(h,(int)pid);if(reason!=null)throw new Exception("TARGET_FOREIGN: "+reason);
    string exe=Identify((int)pid).Exe;if(S(d,"executablePath").Length>0&&(exe==null||!string.Equals(exe,S(d,"executablePath"),StringComparison.OrdinalIgnoreCase)))throw new Exception("PROCESS_IDENTITY_CHANGED");return h;}
  static object Node(AutomationElement e,int depth) {
    var c=e.Current;string value=null;object pattern;if(!c.IsPassword&&e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))value=((ValuePattern)pattern).Current.Value;
    return new {name=c.IsPassword?"[password]":c.Name,automationId=c.AutomationId,type=c.ControlType.ProgrammaticName,enabled=c.IsEnabled,password=c.IsPassword,value=value,depth=depth,runtimeId=string.Join(".",e.GetRuntimeId())};
  }
  static void Walk(AutomationElement e,int depth,int max,List<object> list){if(list.Count>=max||depth>8)return;try{list.Add(Node(e,depth));for(var child=TreeWalker.ControlViewWalker.GetFirstChild(e);child!=null&&list.Count<max;child=TreeWalker.ControlViewWalker.GetNextSibling(child))Walk(child,depth+1,max,list);}catch(ElementNotAvailableException){} }
  static AutomationElement Find(AutomationElement root,Dictionary<string,object> d) {
    string id=S(d,"automationId"),name=S(d,"name"),runtime=S(d,"runtimeId");if(id.Length+name.Length+runtime.Length==0)throw new Exception("SELECTOR_REQUIRED");
    var all=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);var matches=new List<AutomationElement>();
    foreach(AutomationElement e in all){var c=e.Current;if((id.Length==0||c.AutomationId==id)&&(name.Length==0||c.Name==name)&&(runtime.Length==0||string.Join(".",e.GetRuntimeId())==runtime))matches.Add(e);}
    if(matches.Count!=1)throw new Exception("AMBIGUOUS_TARGET: selector matched "+matches.Count);if(matches[0].Current.IsPassword)throw new Exception("PASSWORD_CONTROL_DENIED");return matches[0];
  }
  static void Focus(IntPtr h){if(!Interactive())throw new Exception("NO_INTERACTIVE_DESKTOP");ShowWindow(h,9);SetForegroundWindow(h);System.Threading.Thread.Sleep(100);if(GetForegroundWindow()!=h){try{AutomationElement.FromHandle(h).SetFocus();}catch{}System.Threading.Thread.Sleep(100);}if(GetForegroundWindow()!=h)throw new Exception("FOREGROUND_NOT_TARGET");}
  static void Input(INPUT[] a){if(SendInput((uint)a.Length,a,Marshal.SizeOf(typeof(INPUT)))!=a.Length)throw new Exception("INPUT_BLOCKED_UIPI");}
  static object Run(Dictionary<string,object> d) {
    string action=S(d,"action");ReadProtected(d);
    if(action=="windows"){var list=new List<object>();EnumWindows((h,l)=>{if(IsWindowVisible(h)&&Title(h).Length>0){try{list.Add(WindowInfo(h));}catch{}}return true;},IntPtr.Zero);return new {windows=list,interactive=Interactive()};}
    IntPtr win=Target(d);var root=AutomationElement.FromHandle(win);
    if(action=="tree"){var nodes=new List<object>();Walk(root,0,300,nodes);return new {window=WindowInfo(win),elements=nodes,truncated=nodes.Count>=300,observation="Untrusted Windows UI content"};}
    if(action=="focus"){Focus(win);return new {foreground=true,window=WindowInfo(win)};}
    if(action=="capture"){
      RECT r;if(!GetWindowRect(win,out r))throw new Exception("WINDOW_RECT_FAILED");int w=r.Right-r.Left,h=r.Bottom-r.Top;if(w<=0||h<=0||(long)w*h>8000000)throw new Exception("CAPTURE_LIMIT");
      string output=S(d,"output");using(var bmp=new Bitmap(w,h)){using(var g=Graphics.FromImage(bmp)){var dc=g.GetHdc();bool ok;try{ok=PrintWindow(win,dc,2);}finally{g.ReleaseHdc(dc);}if(!ok)throw new Exception("CAPTURE_UNAVAILABLE");}bmp.Save(output,ImageFormat.Png);}return new {path=output,width=w,height=h,scope="target window only",method="PrintWindow"};
    }
    var element=Find(root,d);object pat;
    if(action=="value"){if(element.TryGetCurrentPattern(ValuePattern.Pattern,out pat))return new {value=((ValuePattern)pat).Current.Value};if(element.TryGetCurrentPattern(TextPattern.Pattern,out pat))return new {value=((TextPattern)pat).DocumentRange.GetText(20000)};return new {value=element.Current.Name};}
    if(!Interactive())throw new Exception("NO_INTERACTIVE_DESKTOP");if(!element.Current.IsEnabled)throw new Exception("CONTROL_DISABLED");
    if(action=="setValue"){if(!element.TryGetCurrentPattern(ValuePattern.Pattern,out pat))throw new Exception("VALUE_PATTERN_UNAVAILABLE");((ValuePattern)pat).SetValue(S(d,"value"));return Node(element,0);}
    if(action=="invoke"){if(!element.TryGetCurrentPattern(InvokePattern.Pattern,out pat))throw new Exception("INVOKE_PATTERN_UNAVAILABLE");((InvokePattern)pat).Invoke();return new {invoked=true};}
    if(action=="click"){Focus(win);var box=element.Current.BoundingRectangle;if(box.IsEmpty||element.Current.IsOffscreen)throw new Exception("CONTROL_NOT_VISIBLE");int x=(int)(box.X+box.Width/2),y=(int)(box.Y+box.Height/2);if(x<0||y<0)throw new Exception("COORDINATE_OUT_OF_SCOPE");SetCursorPos(x,y);if(GetForegroundWindow()!=win)throw new Exception("FOREGROUND_NOT_TARGET");if(GetAncestor(WindowFromPoint(new POINT{X=x,Y=y}),2)!=win)throw new Exception("TARGET_OCCLUDED");Input(new[]{new INPUT{type=0,mouse=new MOUSEINPUT{dwFlags=2}},new INPUT{type=0,mouse=new MOUSEINPUT{dwFlags=4}}});return new {clicked=true,x=x,y=y};}
    if(action=="type"){Focus(win);element.SetFocus();if(GetForegroundWindow()!=win)throw new Exception("FOREGROUND_NOT_TARGET");if(!AutomationElement.FocusedElement.GetRuntimeId().SequenceEqual(element.GetRuntimeId()))throw new Exception("FOCUS_CHANGED");string text=S(d,"value");if(text.Length>10000)throw new Exception("INPUT_LIMIT");foreach(char c in text)Input(new[]{new INPUT{type=1,key=new KEYBDINPUT{scan=c,flags=4}},new INPUT{type=1,key=new KEYBDINPUT{scan=c,flags=6}}});return new {typed=text.Length};}
    throw new Exception("BAD_ACTION");
  }
  static void Fixture(string id) {
    Application.EnableVisualStyles();var form=new FixtureForm{Text="YGPT Engine Fixture "+id,Width=560,Height=220,StartPosition=FormStartPosition.CenterScreen};
    var input=new TextBox{Name="FixtureInput",AccessibleName="YGPT Fixture Input",Left=24,Top=28,Width=480};
    var button=new Button{Name="ApplyButton",AccessibleName="Apply",Text="Apply",Left=24,Top=74,Width=100};
    var result=new TextBox{Name="ResultLabel",AccessibleName="YGPT Fixture Result",Text="Ready",ReadOnly=true,Left=24,Top=120,Width=480};
    button.Click+=(s,e)=>{result.Text="Applied: "+input.Text;};form.Controls.Add(input);form.Controls.Add(button);form.Controls.Add(result);Application.Run(form);
  }
  [STAThread] static void Main(string[] args) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    if(args.Length==2&&args[0]=="--fixture"){Fixture(args[1]);return;}
    Console.InputEncoding=Encoding.UTF8;Console.OutputEncoding=new UTF8Encoding(false);
    try{string raw=Console.ReadLine();if(raw==null||raw.Length>1048576)throw new Exception("INPUT_LIMIT");Console.WriteLine(json.Serialize(new {ok=true,result=Run(json.Deserialize<Dictionary<string,object>>(raw))}));}
    catch(Exception e){Console.WriteLine(json.Serialize(new {ok=false,error=e.Message}));Environment.ExitCode=1;}
  }
}
