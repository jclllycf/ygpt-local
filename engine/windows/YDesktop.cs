// YGPT Local native adapter over Microsoft's Windows UI Automation/Win32 APIs.
// No credentials, elevation or public sockets. Owner blacklist model (rc.13):
// this adapter refuses nothing by application identity — every window is a
// potential target, and the broker's human approval (bind + per-action) is
// the control point. Identity (executable path, signer, process birth) is
// still verified before every read or action so an approval cannot be
// replayed against a different program.
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
using System.Text.RegularExpressions;
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
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll",SetLastError=true)] static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] input,int size);
  [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int info,IntPtr buffer,int size,out int needed);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
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
  static bool effectStarted=false;
  static string requestedAction="";
  static IntPtr inputWindow=IntPtr.Zero;
  internal static Dictionary<string,object> inputDiagnostics;
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
  [StructLayout(LayoutKind.Sequential)] internal struct MOUSEINPUT { public int dx,dy;public uint mouseData,dwFlags,time;public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] internal struct KEYBDINPUT { public ushort vk,scan;public uint flags,time;public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit,Size=40)] internal struct INPUT { [FieldOffset(0)]public uint type;[FieldOffset(8)]public MOUSEINPUT mouse;[FieldOffset(8)]public KEYBDINPUT key; }
  class TokenLevel { public int? Rid;public bool? UiAccess; }
  static TokenLevel TokenInfo(int pid){
    var result=new TokenLevel();IntPtr process=OpenProcess(0x1000,false,pid),token=IntPtr.Zero;if(process==IntPtr.Zero)return result;
    try{if(!OpenProcessToken(process,8,out token))return result;int needed;GetTokenInformation(token,25,IntPtr.Zero,0,out needed);
      if(needed>0&&needed<65536){IntPtr buffer=Marshal.AllocHGlobal(needed);try{if(GetTokenInformation(token,25,buffer,needed,out needed)){IntPtr sid=Marshal.ReadIntPtr(buffer);byte count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));if(count>0)result.Rid=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));}}finally{Marshal.FreeHGlobal(buffer);}}
      IntPtr flag=Marshal.AllocHGlobal(4);try{if(GetTokenInformation(token,26,flag,4,out needed))result.UiAccess=Marshal.ReadInt32(flag)!=0;}finally{Marshal.FreeHGlobal(flag);}
    }finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}return result;
  }
  static object InputAccess(int pid){var source=TokenInfo(Process.GetCurrentProcess().Id);var target=TokenInfo(pid);return new {sourceIntegrityRid=source.Rid,targetIntegrityRid=target.Rid,sourceUiAccess=source.UiAccess,higherIntegrityTarget=source.Rid.HasValue&&target.Rid.HasValue?(bool?)(target.Rid.Value>source.Rid.Value):null};}
  static void PrepareInput(IntPtr win){
    inputWindow=win;uint pid;GetWindowThreadProcessId(win,out pid);var source=TokenInfo(Process.GetCurrentProcess().Id);var target=TokenInfo((int)pid);
    inputDiagnostics=new Dictionary<string,object>{{"sourceIntegrityRid",source.Rid},{"targetIntegrityRid",target.Rid},{"sourceUiAccess",source.UiAccess},{"requested",0u},{"inserted",0u}};
    if(source.Rid.HasValue&&target.Rid.HasValue&&target.Rid.Value>source.Rid.Value&&source.UiAccess==false)throw new Exception("INPUT_INTEGRITY_MISMATCH: target has a higher Windows integrity level; no input was sent. Full Access does not elevate desktop tools. Use a normal-permission target or explicitly arrange owner-approved elevation; do not repeat the same approval.");
  }
  static string S(Dictionary<string,object> d,string k,string fallback="") { return d.ContainsKey(k)?Convert.ToString(d[k]):fallback; }
  static bool Interactive() { IntPtr h=OpenInputDesktop(0,false,1);if(h==IntPtr.Zero)return false;try{var s=new StringBuilder(100);uint n;return GetUserObjectInformation(h,2,s,200,out n)&&s.ToString()=="Default";}finally{CloseDesktop(h);} }
  static string Title(IntPtr h){var s=new StringBuilder(1000);GetWindowText(h,s,s.Capacity);return s.ToString();}
  static object WindowInfo(IntPtr h) {uint id;GetWindowThreadProcessId(h,out id);var p=Process.GetProcessById((int)id);var ident=Identify((int)id);string exe=ident.Exe;if(exe==null){try{exe=p.MainModule.FileName;}catch{}}
    // Owner blacklist model (rc.13): every window is listed with its real
    // title and identity. Nothing is shielded or refused at this layer; the
    // human approval in the broker is the control point for binding/actions.
    return new {hwnd=h.ToInt64().ToString(),pid=id,parentPid=ident.Parent,process=p.ProcessName,executablePath=exe,signer=ident.Signer,title=Title(h),birth=p.StartTime.ToUniversalTime().Ticks.ToString(),session=p.SessionId,inputAccess=InputAccess((int)id),@protected=false,protectedReason=(string)null};}
  static void Allowed(Process p) {if(p.SessionId!=Process.GetCurrentProcess().SessionId)throw new Exception("SESSION_MISMATCH");}
  static IntPtr Target(Dictionary<string,object> d) {var h=new IntPtr(long.Parse(S(d,"hwnd")));uint pid;if(!IsWindow(h))throw new Exception("STALE_WINDOW");GetWindowThreadProcessId(h,out pid);if(pid!=uint.Parse(S(d,"pid")))throw new Exception("WINDOW_IDENTITY_CHANGED");var p=Process.GetProcessById((int)pid);Allowed(p);if(p.StartTime.ToUniversalTime().Ticks.ToString()!=S(d,"birth"))throw new Exception("PROCESS_IDENTITY_CHANGED");
    string exe=Identify((int)pid).Exe;if(S(d,"executablePath").Length>0&&(exe==null||!string.Equals(exe,S(d,"executablePath"),StringComparison.OrdinalIgnoreCase)))throw new Exception("PROCESS_IDENTITY_CHANGED");return h;}
  static object Node(AutomationElement e,int depth) {
    var c=e.Current;string value=null;object pattern;if(!c.IsPassword&&e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))value=((ValuePattern)pattern).Current.Value;
    var box=c.BoundingRectangle;string toggle=null;if(e.TryGetCurrentPattern(TogglePattern.Pattern,out pattern))toggle=((TogglePattern)pattern).Current.ToggleState.ToString();
    return new {name=c.IsPassword?"[password]":c.Name,automationId=c.AutomationId,type=c.ControlType.ProgrammaticName,enabled=c.IsEnabled,password=c.IsPassword,value=value,toggleState=toggle,depth=depth,runtimeId=string.Join(".",e.GetRuntimeId()),offscreen=c.IsOffscreen,bounds=box.IsEmpty?null:new {x=box.X,y=box.Y,width=box.Width,height=box.Height},patterns=e.GetSupportedPatterns().Select(p=>p.ProgrammaticName).ToArray()};
  }
  class TreeSnapshot {
    public List<object> Elements=new List<object>();public bool DepthLimited,NodeLimited,Changed;public int MaxDepth,MaxNodes;
    public void Walk(AutomationElement e,int depth){
      if(Elements.Count>=MaxNodes){NodeLimited=true;return;}
      try{Elements.Add(Node(e,depth));var child=TreeWalker.ControlViewWalker.GetFirstChild(e);
        if(child!=null&&depth>=MaxDepth){DepthLimited=true;return;}
        while(child!=null){if(Elements.Count>=MaxNodes){NodeLimited=true;return;}Walk(child,depth+1);child=TreeWalker.ControlViewWalker.GetNextSibling(child);}
      }catch(ElementNotAvailableException){Changed=true;}
    }
  }
  static int Limit(Dictionary<string,object> d,string key,int fallback,int min,int max){int value;if(!int.TryParse(S(d,key),out value))return fallback;return Math.Max(min,Math.Min(max,value));}
  static AutomationElement Find(AutomationElement root,Dictionary<string,object> d) {
    string id=S(d,"automationId"),name=S(d,"name"),runtime=S(d,"runtimeId");if(id.Length+name.Length+runtime.Length==0)throw new Exception("SELECTOR_REQUIRED: use a current runtimeId, automationId or unique name from y_desktop_inspect; type does not implicitly target keyboard focus");
    var conditions=new List<Condition>();if(id.Length>0)conditions.Add(new PropertyCondition(AutomationElement.AutomationIdProperty,id));if(name.Length>0)conditions.Add(new PropertyCondition(AutomationElement.NameProperty,name));
    Condition filter=conditions.Count==0?Condition.TrueCondition:conditions.Count==1?conditions[0]:new AndCondition(conditions.ToArray());
    var all=root.FindAll(TreeScope.Descendants,filter);var matches=new List<AutomationElement>();
    foreach(AutomationElement e in all){var c=e.Current;if((id.Length==0||c.AutomationId==id)&&(name.Length==0||c.Name==name)&&(runtime.Length==0||string.Join(".",e.GetRuntimeId())==runtime))matches.Add(e);}
    if(matches.Count!=1)throw new Exception("AMBIGUOUS_TARGET: selector matched "+matches.Count);return matches[0];
  }
  static void Focus(IntPtr h){
    if(!Interactive())throw new Exception("NO_INTERACTIVE_DESKTOP");if(IsIconic(h))ShowWindow(h,9);SetForegroundWindow(h);System.Threading.Thread.Sleep(100);if(GetForegroundWindow()==h)return;
    uint ignored,current=GetCurrentThreadId(),front=GetWindowThreadProcessId(GetForegroundWindow(),out ignored),target=GetWindowThreadProcessId(h,out ignored);bool joinedFront=false,joinedTarget=false;
    try{if(front!=0&&front!=current)joinedFront=AttachThreadInput(current,front,true);if(target!=0&&target!=current&&target!=front)joinedTarget=AttachThreadInput(current,target,true);BringWindowToTop(h);SetForegroundWindow(h);System.Threading.Thread.Sleep(100);}
    finally{if(joinedTarget)AttachThreadInput(current,target,false);if(joinedFront)AttachThreadInput(current,front,false);}
    if(GetForegroundWindow()!=h)throw new Exception("FOREGROUND_NOT_TARGET: Windows did not activate the requested window; no input was sent");
  }
  // SendInput cannot identify UIPI as the reason for a zero return. Keep the
  // actual delivery count and Win32 error; never turn an unconfirmed cause into
  // another permission request. A partial batch must not be replayed.
  internal static void InputResult(uint requested,uint inserted,int error){
    if(inputDiagnostics==null)inputDiagnostics=new Dictionary<string,object>();
    inputDiagnostics["requested"]=requested;inputDiagnostics["inserted"]=inserted;inputDiagnostics["win32Error"]=error;
    if(inserted>0)effectStarted=true;if(inserted==requested)return;
    string code=inserted>0?"INPUT_PARTIAL":error==87?"INPUT_INVALID_PARAMETER":error==5?"INPUT_ACCESS_DENIED":"INPUT_NOT_INSERTED";
    throw new Exception(code+": Windows inserted "+inserted+" of "+requested+" input events (Win32 error "+error+"). "+(inserted>0?"Inspect the window and keyboard state; do not replay this batch.":"No events from this batch were inserted. The return value does not prove UIPI; inspect inputDiagnostics and the input desktop before a new action."));
  }
  static void Input(INPUT[] a){
    if(!Interactive())throw new Exception("NO_INTERACTIVE_DESKTOP: no input was sent");
    if(inputWindow==IntPtr.Zero||GetForegroundWindow()!=inputWindow)throw new Exception("FOREGROUND_NOT_TARGET: no input was sent");
    SetLastError(0);uint inserted=SendInput((uint)a.Length,a,Marshal.SizeOf(typeof(INPUT)));int error=Marshal.GetLastWin32Error();InputResult((uint)a.Length,inserted,error);
  }
  static bool OwnedWindow(IntPtr candidate,IntPtr target){if(candidate==target||IsChild(target,candidate))return true;for(int n=0;n<16&&candidate!=IntPtr.Zero;n++){candidate=GetWindow(candidate,4);if(candidate==target)return true;}return false;}
  static object Click(IntPtr win,AutomationElement element,string method){
    PrepareInput(win);Focus(win);var box=element.Current.BoundingRectangle;if(box.IsEmpty||element.Current.IsOffscreen)throw new Exception("CONTROL_NOT_VISIBLE");
    var points=new List<System.Windows.Point>();System.Windows.Point clickable;try{if(element.TryGetClickablePoint(out clickable))points.Add(clickable);}catch{}
    points.Add(new System.Windows.Point(box.X+box.Width/2,box.Y+box.Height/2));
    foreach(var point in points){int x=(int)Math.Round(point.X),y=(int)Math.Round(point.Y);if(!SystemInformation.VirtualScreen.Contains(x,y))continue;
      if(GetForegroundWindow()!=win)throw new Exception("FOREGROUND_NOT_TARGET");
      if(!OwnedWindow(GetAncestor(WindowFromPoint(new POINT{X=x,Y=y}),2),win))continue;
      if(!SetCursorPos(x,y))throw new Exception("CURSOR_MOVE_FAILED");
      if(GetForegroundWindow()!=win||!OwnedWindow(GetAncestor(WindowFromPoint(new POINT{X=x,Y=y}),2),win))throw new Exception("TARGET_OCCLUDED");
      Input(new[]{new INPUT{type=0,mouse=new MOUSEINPUT{dwFlags=2}},new INPUT{type=0,mouse=new MOUSEINPUT{dwFlags=4}}});return new {clicked=true,x=x,y=y,method=method,requestedAction=requestedAction};
    }throw new Exception("TARGET_OCCLUDED");
  }
  static ushort Key(string value){
    switch(value.ToUpperInvariant()){case "CTRL":case "CONTROL":return 0x11;case "SHIFT":return 0x10;case "ALT":return 0x12;case "ENTER":case "RETURN":return 0x0D;case "TAB":return 0x09;case "ESC":case "ESCAPE":return 0x1B;case "SPACE":return 0x20;case "BACKSPACE":return 0x08;case "DELETE":return 0x2E;case "HOME":return 0x24;case "END":return 0x23;case "PAGEUP":return 0x21;case "PAGEDOWN":return 0x22;case "LEFT":return 0x25;case "UP":return 0x26;case "RIGHT":return 0x27;case "DOWN":return 0x28;}
    if(value.Length==1&&char.IsLetterOrDigit(value[0]))return (ushort)char.ToUpperInvariant(value[0]);int number;if(value.StartsWith("F",StringComparison.OrdinalIgnoreCase)&&int.TryParse(value.Substring(1),out number)&&number>=1&&number<=24)return (ushort)(0x6F+number);throw new Exception("BAD_KEY_CHORD");
  }
  internal static INPUT[] KeyInputs(string value){var keys=value.Split('+').Select(s=>Key(s.Trim())).ToArray();if(keys.Length<1||keys.Length>5||keys.Distinct().Count()!=keys.Length)throw new Exception("BAD_KEY_CHORD");return keys.Select(k=>new INPUT{type=1,key=new KEYBDINPUT{vk=k}}).Concat(keys.Reverse().Select(k=>new INPUT{type=1,key=new KEYBDINPUT{vk=k,flags=2}})).ToArray();}
  static object Keys(IntPtr win,string value){var events=KeyInputs(value);PrepareInput(win);Focus(win);Input(events);return new {pressed=value,method="verified-window-keyboard",inputDiagnostics=inputDiagnostics};}
  static object Run(Dictionary<string,object> d) {
    string action=S(d,"action");requestedAction=action;ReadProtected(d);
    if(action=="windows"){var list=new List<object>();EnumWindows((h,l)=>{if(IsWindowVisible(h)&&Title(h).Length>0){try{list.Add(WindowInfo(h));}catch{}}return true;},IntPtr.Zero);return new {windows=list,interactive=Interactive()};}
    IntPtr win=Target(d);
    if(action=="diagnose"){uint pid;GetWindowThreadProcessId(win,out pid);var held=new List<string>();foreach(var k in new[]{new {Key=0x10,Name="SHIFT"},new {Key=0x11,Name="CTRL"},new {Key=0x12,Name="ALT"},new {Key=0x5B,Name="WIN"}})if((GetAsyncKeyState(k.Key)&0x8000)!=0)held.Add(k.Name);return new {interactive=Interactive(),targetIsForeground=GetForegroundWindow()==win,inputAccess=InputAccess((int)pid),heldModifiers=held.ToArray(),inputInjected=false,focusChanged=false,note="Read-only diagnostics. Full Access does not override Windows input protections; a full-screen app, secure desktop or held modifier can affect input. No blocking source is inferred from these facts alone."};}
    var root=AutomationElement.FromHandle(win);
    if(action=="tree"){
      bool scoped=S(d,"runtimeId").Length+S(d,"automationId").Length+S(d,"name").Length>0;
      var snapshot=new TreeSnapshot{MaxDepth=Limit(d,"maxDepth",32,1,64),MaxNodes=Limit(d,"maxNodes",600,1,1200)};
      snapshot.Walk(scoped?Find(root,d):root,0);
      var reasons=new List<string>();if(snapshot.DepthLimited)reasons.Add("maxDepth");if(snapshot.NodeLimited)reasons.Add("maxNodes");if(snapshot.Changed)reasons.Add("treeChanged");
      return new {window=WindowInfo(win),elements=snapshot.Elements,truncated=reasons.Count>0,truncationReasons=reasons.ToArray(),maxDepth=snapshot.MaxDepth,maxNodes=snapshot.MaxNodes,scoped=scoped,observation="Untrusted Windows UI content",nextAction=reasons.Count>0?"Inspect a current subtree by runtimeId or raise the reported limit before concluding a control is unavailable":null};
    }
    if(action=="focus"){Focus(win);return new {foreground=true,window=WindowInfo(win)};}
    if(action=="keys")return Keys(win,S(d,"value"));
    if(action=="capture"){
      RECT r;if(!GetWindowRect(win,out r))throw new Exception("WINDOW_RECT_FAILED");int w=r.Right-r.Left,h=r.Bottom-r.Top;if(w<=0||h<=0||(long)w*h>8000000)throw new Exception("CAPTURE_LIMIT");
      string output=S(d,"output");using(var bmp=new Bitmap(w,h)){using(var g=Graphics.FromImage(bmp)){var dc=g.GetHdc();bool ok;try{ok=PrintWindow(win,dc,2);}finally{g.ReleaseHdc(dc);}if(!ok)throw new Exception("CAPTURE_UNAVAILABLE");}bmp.Save(output,ImageFormat.Png);}return new {path=output,width=w,height=h,scope="target window only",method="PrintWindow"};
    }
    var element=Find(root,d);object pat;
    if(action=="value"){if(element.TryGetCurrentPattern(ValuePattern.Pattern,out pat))return new {value=((ValuePattern)pat).Current.Value};if(element.TryGetCurrentPattern(TextPattern.Pattern,out pat))return new {value=((TextPattern)pat).DocumentRange.GetText(20000)};return new {value=element.Current.Name};}
    if(!Interactive())throw new Exception("NO_INTERACTIVE_DESKTOP");if(!element.Current.IsEnabled)throw new Exception("CONTROL_DISABLED");
    if(action=="setValue"){if(!element.TryGetCurrentPattern(ValuePattern.Pattern,out pat))throw new Exception("VALUE_PATTERN_UNAVAILABLE");effectStarted=true;((ValuePattern)pat).SetValue(S(d,"value"));return Node(element,0);}
    if(action=="invoke"){
      string process=Identify(Process.GetProcessById((int)element.Current.ProcessId).Id).Name;
      if(process=="chrome"||process=="msedge")return Click(win,element,"browser-verified-pointer-click");
      if(!element.TryGetCurrentPattern(InvokePattern.Pattern,out pat))return Click(win,element,"invoke-unavailable-pointer-click");
      effectStarted=true;((InvokePattern)pat).Invoke();return new {invoked=true,method="UIA.InvokePattern"};
    }
    if(action=="click")return Click(win,element,"verified-pointer-click");
    if(action=="type"){PrepareInput(win);Focus(win);element.SetFocus();if(GetForegroundWindow()!=win)throw new Exception("FOREGROUND_NOT_TARGET");if(!AutomationElement.FocusedElement.GetRuntimeId().SequenceEqual(element.GetRuntimeId()))throw new Exception("FOCUS_CHANGED");string text=S(d,"value");if(text.Length>10000)throw new Exception("INPUT_LIMIT");foreach(char c in text){if(GetForegroundWindow()!=win)throw new Exception("FOCUS_CHANGED");Input(new[]{new INPUT{type=1,key=new KEYBDINPUT{scan=c,flags=4}},new INPUT{type=1,key=new KEYBDINPUT{scan=c,flags=6}}});}return new {typed=text.Length};}
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
    try{string raw=Console.ReadLine();if(raw==null||raw.Length>1048576)throw new Exception("INPUT_LIMIT");var request=json.Deserialize<Dictionary<string,object>>(raw);string action=S(request,"action");object result;
      if(new[]{"focus","setValue","invoke","click","type","keys"}.Contains(action)){using(var mutex=new System.Threading.Mutex(false,"Local\\YGPTDesktopInput-"+System.Security.Principal.WindowsIdentity.GetCurrent().User.Value)){bool locked=false;try{try{locked=mutex.WaitOne(5000);}catch(System.Threading.AbandonedMutexException){locked=true;}if(!locked)throw new Exception("DESKTOP_BUSY: another desktop operation is active; no input was sent");result=Run(request);}finally{if(locked)mutex.ReleaseMutex();}}}else result=Run(request);
      Console.WriteLine(json.Serialize(new {ok=true,result=result}));}
    catch(Exception e){string message=e.Message??"",code=Regex.Match(message,@"^[A-Z][A-Z0-9_]{2,}(?=:|$)").Value;if(code.Length==0)code=requestedAction=="invoke"?"UIA_INVOKE_FAILED":"UIA_EXECUTION_FAILED";string hresult="0x"+e.HResult.ToString("X8");if(message.Length==0)message=code+" ("+e.GetType().Name+", HRESULT "+hresult+")";Console.WriteLine(json.Serialize(new {ok=false,error=message,code=code,hresult=hresult,exceptionType=e.GetType().Name,action=requestedAction,inputDiagnostics=inputDiagnostics,effectStarted=effectStarted,outcomeUnknown=effectStarted}));Environment.ExitCode=1;}
  }
}
