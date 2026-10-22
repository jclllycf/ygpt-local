// Desktop UI Automation consent policy. UIA stays available; what it may do
// without a person is limited to reading the window list (Agent and credential
// windows shielded) and reading a window this chat was approved to bind.
// An owner enrollment list (path + SHA-256) is NOT consent for an operation.
import crypto from 'node:crypto';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const UIA_ACTION_GRANT_MS=10*60000;
const allow=reason=>({decision:'allow',reason}),approve=reason=>({decision:'approve',kind:'desktop',reason});
export function uiaDecision(tool){
 if(tool==='y_desktop_windows')return allow('Read-only window inventory; Agent windows shielded, credential titles withheld');
 if(tool==='y_desktop_bind')return approve('Binding a window for UI Automation requires a human Allow once for that exact window');
 if(['y_desktop_inspect','y_desktop_value','y_desktop_screenshot'].includes(tool))return allow('Reads the exact window a human approved for this chat; identity re-verified before each read');
 if(tool==='y_desktop_action')return approve('Focus, click, invoke, type and setValue each require a human decision');
 return null;
}
// The window identity a human approves. Execution is refused when any part changed.
export function windowIdentity(win){
 if(!win)return null;
 return {hwnd:String(win.hwnd),pid:win.pid,birth:String(win.birth??''),executablePath:win.executablePath??null,executableSha256:win.executableSha256??null};
}
const clip=(v,n=160)=>{const s=String(v??'');return s.length>n?s.slice(0,n-1)+'…':s;};
const control=a=>[a.automationId&&('automationId '+clip(a.automationId,80)),a.name&&('name "'+clip(a.name,80)+'"'),a.runtimeId&&('runtimeId '+clip(a.runtimeId,40))].filter(Boolean).join(', ')||'the window itself';
const verbs={focus:'bring the window to the foreground',click:'click',invoke:'invoke (press)',type:'type text into',setValue:'set the value of'};
// What the approval card shows: application, window, action, control, input summary, risk and scope.
export function uiaPresentation(tool,args={},win=null){
 const app=win?`${win.process??'unknown app'} (PID ${win.pid})`:'Window '+clip(args.hwnd??args.targetId,40);
 const windowText=win?clip(win.title||'[untitled window]',120):'';
 const exe=win?.executablePath?`\nExecutable: ${win.executablePath}`+(win.executableSha256?`\nSHA-256: ${win.executableSha256}`:''):'';
 if(tool==='y_desktop_bind')return {title:'Allow desktop control of this window',purpose:'Let this chat read and, with separate approval per action, operate this window through Windows UI Automation.',
  target:`${app} — "${windowText}"`,impact:'After binding, this chat may read the window tree, control values and take screenshots of this window only. Clicks, typing, focus and value changes each ask again.',
  denied:'The window is not bound. Nothing is read or changed.',risk:'Window content may include private information.',reversible:'Reading changes nothing. The binding ends when this chat context or the window closes.',administrator:'Current user; no elevation.',
  technical:`Tool: y_desktop_bind\nhwnd: ${clip(args.hwnd,40)}${exe}`};
 const action=args.action??'action',value=typeof args.value==='string'?args.value:null;
 const input=value===null?'No text input.':`Input (${value.length} characters): "${clip(value,120)}"`;
 return {title:'Allow this desktop action',purpose:`${verbs[action]??action} ${control(args)} in ${app}.`,
  target:`${app} — "${windowText}"`,impact:`${input} The application will react as if you did it yourself; effects inside the application may not be reversible.`,
  denied:'No input, click or focus change happens.',risk:action==='type'||action==='setValue'?'Enters data into another application':'Operates another application',
  reversible:'YGPT cannot undo what the application does in response.',administrator:'Current user; no elevation.',
  technical:`Tool: y_desktop_action\naction: ${action}\ncontrol: ${control(args)}\ntargetId: ${clip(args.targetId,40)}${exe}`};
}
// Optional narrow conversation grant: same chat, same bound window identity,
// same action type, for ten minutes. Binding itself is always Allow once.
export function uiaChatScope(tool,args={},win=null){
 if(tool!=='y_desktop_action'||!win)return {eligible:false,key:null,explanation:'Desktop binding requires Allow once for the exact window.'};
 return {eligible:true,ttlMs:UIA_ACTION_GRANT_MS,key:digest(['y_desktop_action',String(args.targetId),args.action,windowIdentity(win)]),
  explanation:`Allow this chat to repeat "${args.action}" on this same window (any control, any text) for 10 minutes. Other actions, windows or chats still ask.`};
}
