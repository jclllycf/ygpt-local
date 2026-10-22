// ChatGPT Desktop Agent / Codex boundary. YGPT serves ordinary chats and must
// never take over the Agent's processes, windows, browser, tasks or files.
// Pure policy helpers: inputs are already-canonical lower-case Windows paths
// or inventory records produced by the native adapter.
import path from 'node:path';
const w=path.win32;
const lower=p=>w.normalize(String(p)).replace(/\\+$/,'').toLowerCase();
// Executable/package locations of the ChatGPT desktop app and the Codex CLI.
// Matching is structural (path segments), not a display-name guess.
const AGENT_PATH_PATTERNS=[
 /\\windowsapps\\openai\.[^\\]*(?:\\|$)/,
 /\\appdata\\local\\packages\\openai\.[^\\]*(?:\\|$)/,
 /\\appdata\\local\\programs\\(?:chatgpt|codex)(?:\\|$)/,
 /\\appdata\\(?:local|roaming)\\(?:openai|chatgpt|codex)(?:\\|$)/,
 /\\\.codex(?:\\|$)/
];
// Shell text naming Agent program/state folders is refused. A bare .codex
// reference keeps the existing human-review signal instead (owner reads).
const COMMAND_PATH_PATTERNS=AGENT_PATH_PATTERNS.slice(0,4);
// Process image names that identify the Agent host itself. Used in addition to
// path/signer/process-tree identity, never as the only evidence of safety.
export const AGENT_PROCESS_NAMES=Object.freeze(['chatgpt','codex','openai']);
export function agentProtectedRoots(env=process.env,extra=[]){
 const roots=[];
 const add=(base,...rest)=>{if(base)roots.push(lower(w.join(base,...rest)));};
 add(env.LOCALAPPDATA,'Programs','ChatGPT');add(env.LOCALAPPDATA,'Programs','Codex');
 add(env.LOCALAPPDATA,'OpenAI');add(env.APPDATA,'OpenAI');add(env.LOCALAPPDATA,'ChatGPT');add(env.APPDATA,'ChatGPT');
 for(const p of extra)if(typeof p==='string'&&w.isAbsolute(p))roots.push(lower(p));
 return [...new Set(roots)];
}
// True when a canonical target is inside Agent-owned program or state folders.
export function agentPath(target,roots=agentProtectedRoots()){
 if(typeof target!=='string'||!target)return false;
 const t=lower(target);
 return roots.some(r=>t===r||t.startsWith(r+'\\'))||AGENT_PATH_PATTERNS.some(re=>re.test(t+'\\'));
}
// Command text that would stop, signal or rewrite the Agent. A text signal is
// not a sandbox; it is an explicit hard-deny for the obvious cases, and the
// security note states that arbitrary code cannot be proven isolated.
export function agentCommandSignal(text,roots=agentProtectedRoots()){
 const value=String(text??'');if(!value)return null;
 const names=AGENT_PROCESS_NAMES.join('|');
 if(new RegExp('\\b(?:stop-process|taskkill(?:\\.exe)?|kill|pskill|wmic\\b[^\\r\\n]{0,80}\\b(?:terminate|delete)|get-process\\b[^\\r\\n|]{0,80}\\|\\s*stop-process)\\b[^\\r\\n;]{0,160}\\b(?:'+names+')(?:\\.exe)?\\b','i').test(value))return 'Command targets the ChatGPT Desktop Agent/Codex process';
 if(new RegExp('\\b(?:get-process|ps)\\b[^\\r\\n;]{0,40}\\b(?:'+names+')\\b[^\\r\\n;]{0,80}\\|\\s*(?:stop-process|kill)\\b','i').test(value))return 'Command targets the ChatGPT Desktop Agent/Codex process';
 if(/--remote-debugging-(?:port|pipe)|connectovercdp|devtoolsactiveport/i.test(value)&&new RegExp('\\b(?:'+names+')\\b','i').test(value))return 'Command attaches to an Agent browser debugging channel';
 const normalized=value.replaceAll('/','\\').toLowerCase();
 if(roots.some(r=>normalized.includes(r))||COMMAND_PATH_PATTERNS.some(re=>re.test(normalized)))return 'Command references ChatGPT Desktop Agent/Codex program or state folders';
 return null;
}
// Tool-level boundary used by the broker policy. Owner reads keep their
// existing policy; writes, moves, downloads, working directories and command
// text that target Agent resources are refused. Returns a reason or null.
export function agentToolBoundary(name,a={},{canonical=p=>w.normalize(p).toLowerCase(),roots=agentProtectedRoots()}={}){
 const writes={write_file:[a.path],edit_block:[a.file_path],create_directory:[a.path],move_file:[a.source,a.destination],y_download_file:[a.destination],y_file_trash:a.paths}[name];
 for(const p of (Array.isArray(writes)?writes:[]).filter(v=>typeof v==='string'&&v))if(agentPath(canonical(p),roots))return 'TARGET_FOREIGN: ChatGPT Desktop Agent/Codex files are not YGPT targets';
 if(['job_submit','y_dev_task'].includes(name)){
  const cwd=a.cwd;if(cwd&&agentPath(canonical(cwd),roots))return 'TARGET_FOREIGN: Agent folders cannot be a YGPT working directory';
  const signal=agentCommandSignal(Array.isArray(a.argv)?a.argv.join(' '):'',roots);if(signal)return 'TARGET_FOREIGN: '+signal;
 }
 if(name==='interact_with_process'){const signal=agentCommandSignal(a.input,roots);if(signal)return 'TARGET_FOREIGN: '+signal;}
 return null;
}
// Applications the native adapter never controls (terminals, Windows security
// and credential UI, password managers). They are listed, not controllable;
// credential surfaces also have their titles withheld.
export const RESTRICTED_APPS=Object.freeze(['powershell','pwsh','cmd','windowsterminal','conhost','consent','credentialuibroker','logonui','lockapp','sechealthui','msmpeng','1password','keepass','bitwarden']);
const CREDENTIAL_APPS=new Set(['consent','credentialuibroker','logonui','lockapp','1password','keepass','bitwarden']);
export function restrictedApp(processName){
 const name=String(processName??'').toLowerCase().replace(/\.exe$/,'');
 return RESTRICTED_APPS.includes(name)?{restricted:true,hideTitle:CREDENTIAL_APPS.has(name)}:{restricted:false,hideTitle:false};
}
// Defense in depth over the native adapter's own decision. A window is foreign
// when its process, or any recorded ancestor/owner, is an Agent identity, or
// when its executable identity could not be established.
export function classifyWindow(win,roots=agentProtectedRoots()){
 if(!win||typeof win!=='object')return {protected:true,reason:'IDENTITY_UNVERIFIED'};
 if(win.protected===true)return {protected:true,reason:win.protectedReason||'AGENT_PROTECTED'};
 const chain=[{process:win.process,executablePath:win.executablePath,signer:win.signer},...(Array.isArray(win.ancestors)?win.ancestors:[])];
 for(const p of chain){
  const name=String(p?.process??'').toLowerCase().replace(/\.exe$/,'');
  if(AGENT_PROCESS_NAMES.includes(name))return {protected:true,reason:'AGENT_PROCESS'};
  if(p?.executablePath&&agentPath(p.executablePath,roots))return {protected:true,reason:'AGENT_EXECUTABLE'};
  if(/\bO=OpenAI\b/i.test(String(p?.signer??'')))return {protected:true,reason:'AGENT_SIGNER'};
 }
 if(!win.executablePath)return {protected:true,reason:'IDENTITY_UNVERIFIED'};
 return {protected:false,reason:null};
}
// Browser launch options must create a private Playwright instance. Any option
// that would attach to an existing browser, profile or debugging endpoint is refused.
export function assertIsolatedBrowserConfig(browser={}){
 const forbidden=['cdpUrl','wsEndpoint','endpointURL','userDataDir','executablePath','profile','connectOverCDP','remoteDebuggingPort'];
 const found=Object.keys(browser??{}).filter(k=>forbidden.includes(k));
 if(found.length)throw Object.assign(Error('TARGET_FOREIGN: browser configuration may not attach to an existing browser, profile or debugging endpoint ('+found.join(', ')+')'),{code:'TARGET_FOREIGN'});
 const args=Array.isArray(browser.args)?browser.args:[];
 if(args.some(a=>/--remote-debugging-port|--user-data-dir|--profile-directory/i.test(String(a))))throw Object.assign(Error('TARGET_FOREIGN: browser arguments may not open a debugging port or reuse a profile'),{code:'TARGET_FOREIGN'});
 return true;
}
