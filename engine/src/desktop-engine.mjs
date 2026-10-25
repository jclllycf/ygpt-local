import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {EngineError,sha256} from './file-engine.mjs';
import {agentProtectedRoots} from './agent-protection.mjs';
// Windows UI Automation through the YDesktop helper. Targets belong to the chat
// context that bound them; the helper re-verifies window/process identity
// before every read or action, and this engine re-verifies
// the executable's SHA-256 that the human approved.
async function fileDigest(p){return sha256(await fs.readFile(p));}
export class YDesktopEngine {
  constructor({stateDir,allowedPids=[],protectedPaths=[],currentOwner=()=>'local',helper,hashFile=fileDigest}={}){this.stateDir=stateDir;this.allowedPids=new Set(allowedPids);this.targets=new Map();this.owner=()=>currentOwner()??'local';this.protectedRoots=agentProtectedRoots(process.env,protectedPaths);this.helper=helper??fileURLToPath(new URL('../build/YDesktop.exe',import.meta.url));this.hashFile=hashFile;this.digests=new Map();}
  // Executable hash, re-read whenever its size or modification time changes.
  async executableDigest(p){
    if(!p)throw new EngineError('IDENTITY_UNVERIFIED','Window executable identity is unavailable');
    let stamp='';try{const s=await fs.stat(p);stamp=s.size+':'+s.mtimeMs;}catch{}
    const cached=this.digests.get(p);if(cached&&stamp&&cached.stamp===stamp)return cached.sha256;
    const value=await this.hashFile(p);if(this.digests.size>256)this.digests.clear();if(stamp)this.digests.set(p,{stamp,sha256:value});return value;
  }
  async request(request){
    return new Promise((resolve,reject)=>{const child=spawn(this.helper,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new EngineError('UIA_TIMEOUT','Windows UI Automation timed out; refresh target state before retrying'));},12000);
      child.stdout.on('data',b=>{out+=b;if(out.length>2*1024*1024)child.kill();});child.stderr.on('data',b=>{err=(err+b).slice(0,500);});child.once('error',e=>{clearTimeout(timer);reject(Object.assign(new EngineError('DESKTOP_HELPER_UNAVAILABLE','The Windows desktop adapter could not start: '+e.code),{effectStarted:false}));});child.once('close',()=>{clearTimeout(timer);try{const r=JSON.parse(out.replace(/^\uFEFF/,''));if(!r.ok){const code=/^[A-Z][A-Z0-9_]{2,}$/.test(r.code??'')?r.code:'DESKTOP_EXECUTION_FAILED',message=typeof r.error==='string'&&r.error.trim()?r.error:code+' during '+request.action+(r.hresult?' (HRESULT '+r.hresult+')':'');throw Object.assign(new EngineError(code,message),{hresult:r.hresult,action:r.action??request.action,inputDiagnostics:r.inputDiagnostics,effectStarted:r.effectStarted,outcomeUnknown:r.outcomeUnknown===true});}resolve(r.result);}catch(e){reject(e.code?e:Object.assign(new EngineError('DESKTOP_RESPONSE_INVALID','The desktop adapter did not return a complete result; inspect the window before retrying'),{outcomeUnknown:!['windows','tree','value','capture'].includes(request.action)}));}});child.stdin.end(JSON.stringify({...request,protectedPaths:this.protectedRoots})+'\n');});
  }
  // Read-only inventory: every window with its real title and identity.
  async windows(){const got=await this.request({action:'windows'});return {...got,windows:got.windows.map(w=>({...w,protected:false,protectedReason:null,controllable:true,enrolled:this.allowedPids.has(w.pid)}))};}
  async window(hwnd){const got=await this.windows(),matches=got.windows.filter(w=>w.hwnd===String(hwnd));if(matches.length!==1)throw new EngineError('NO_WINDOW','Choose one current window from y_desktop_windows');return matches[0];}
  async bind(hwnd,{executableSha256}={}){const win=await this.window(hwnd);
    if(!this.allowedPids.has(win.pid)||this.enrolledBirths?.has(win.pid)&&this.enrolledBirths.get(win.pid)!==win.birth)throw new EngineError('DESKTOP_NOT_ENROLLED','Window process must be approved by the trusted broker before binding');
    const current=win.executablePath?await this.executableDigest(win.executablePath).catch(()=>null):null;
    if(executableSha256!==undefined&&executableSha256!==null&&current!==null&&executableSha256!==current)throw new EngineError('PROCESS_IDENTITY_CHANGED','The window executable changed after approval; review the window again');
    const bound={...win,executableSha256:current},targetId=crypto.randomUUID();this.targets.set(targetId,{win:bound,owner:this.owner(),boundAt:new Date().toISOString()});return {targetId,window:bound};}
  target(id){const t=this.targets.get(id);if(!t)throw new EngineError('NO_TARGET','Bind a current window first');if(t.owner!==this.owner())throw new EngineError('SESSION_FOREIGN','SESSION_FOREIGN: this UIA target belongs to another chat context');return t.win;}
  // Owner check plus executable re-verification before every read or action.
  // A changed executable ends the binding: the human approved a different program.
  async verified(id){const win=this.target(id);
    const now=win.executablePath?await this.executableDigest(win.executablePath).catch(()=>null):null;
    if(win.executableSha256&&now&&now!==win.executableSha256){this.targets.delete(id);throw new EngineError('PROCESS_IDENTITY_CHANGED','The bound window executable changed; bind the window again');}
    if(!win.executableSha256&&now)win.executableSha256=now;
    return win;}
  async act(id,action,{automationId,name,runtimeId,value,maxDepth,maxNodes}={}){const win=await this.verified(id),got=await this.request({hwnd:win.hwnd,pid:win.pid,birth:win.birth,executablePath:win.executablePath,action,automationId,name,runtimeId,value,maxDepth,maxNodes});return {targetId:id,result:got};}
  async capture(id){const win=await this.verified(id),dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`desktop-${crypto.randomUUID()}.png`);try{const result=await this.request({hwnd:win.hwnd,pid:win.pid,birth:win.birth,executablePath:win.executablePath,action:'capture',output});return {...result,sha256:sha256(await fs.readFile(output)),mimeType:'image/png'};}catch(error){await fs.unlink(output).catch(()=>{});throw error;}}
  owned(owner=this.owner()){return [...this.targets].filter(([,t])=>t.owner===owner).map(([targetId,t])=>({targetId,pid:t.win.pid,process:t.win.process,title:t.win.title,boundAt:t.boundAt}));}
  foreignCount(owner=this.owner()){return [...this.targets.values()].filter(t=>t.owner!==owner).length;}
  release(owner){for(const [id,t] of this.targets)if(t.owner===owner)this.targets.delete(id);}
  // Only a trusted in-process broker may enroll a target. No MCP tool exposes enrollment.
  enrollFromBroker(pid,birth){if(!Number.isInteger(pid)||pid<1)throw new EngineError('BAD_PID','Invalid target PID');this.allowedPids.add(pid);if(birth){this.enrolledBirths??=new Map();this.enrolledBirths.set(pid,birth);}}
}
