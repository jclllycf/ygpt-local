// Desktop UI Automation consent policy. UIA stays available; what it may do
// without a person is limited to reading the window list (nothing shielded —
// the owner blacklist model lists every window as it is) and reading a
// window this chat was approved to bind. App-control authorization lives
// here, inside the desktop operations: the bind approval names the exact
// application and window. The broker asks once for temporary, chat-scoped
// Full Access before control; individual inputs do not request further clicks.
// An owner enrollment list (path + SHA-256) is NOT consent for an operation.
import {DESKTOP_FULL_ACCESS_MINUTES} from './access-defaults.mjs';
export const UIA_ACTION_GRANT_MS=DESKTOP_FULL_ACCESS_MINUTES*60000;
const allow=reason=>({decision:'allow',reason}),approve=reason=>({decision:'approve',kind:'desktop',reason});
export function uiaDecision(tool){
 if(tool==='y_desktop_windows')return allow('Read-only window inventory; every window listed with its real title and identity');
 if(tool==='y_desktop_bind')return approve('Desktop control requires temporary Full Access for this chat, enabled by one human decision');
 if(['y_desktop_inspect','y_desktop_value','y_desktop_screenshot'].includes(tool))return allow('Reads the exact window a human approved for this chat; identity re-verified before each read');
 if(tool==='y_desktop_action')return approve('Enable temporary Full Access once for this chat before desktop input');
 return null;
}
// The window identity a human approves. Execution is refused when any part changed.
export function windowIdentity(win){
 if(!win)return null;
 return {hwnd:String(win.hwnd),pid:win.pid,birth:String(win.birth??''),executablePath:win.executablePath??null,executableSha256:win.executableSha256??null};
}
const clip=(v,n=160)=>{const s=String(v??'');return s.length>n?s.slice(0,n-1)+'…':s;};
const control=a=>[a.automationId&&('automationId '+clip(a.automationId,80)),a.name&&('name "'+clip(a.name,80)+'"'),a.runtimeId&&('runtimeId '+clip(a.runtimeId,40))].filter(Boolean).join(', ')||'the window itself';
const verbs={focus:'bring the window to the foreground',click:'click',invoke:'invoke (press)',type:'type text into',setValue:'set the value of',keys:'send a keyboard chord to'};
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
// Narrow remembered-action grants are replaced by the explicit desktop Full Access card.
export function uiaChatScope(tool,args={},win=null){
 return {eligible:false,key:null,explanation:`One confirmation enables Full Access for this chat for ${DESKTOP_FULL_ACCESS_MINUTES} minutes, covering all desktop actions, windows, files and commands. Revoke with y_chat_access action=revoke.`};
}
