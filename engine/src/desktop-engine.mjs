import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {EngineError,sha256} from './file-engine.mjs';
export class YDesktopEngine {
  constructor({stateDir,allowedPids=[]}={}){this.stateDir=stateDir;this.allowedPids=new Set(allowedPids);this.targets=new Map();this.helper=fileURLToPath(new URL('../build/YDesktop.exe',import.meta.url));}
  async request(request){
    return new Promise((resolve,reject)=>{const child=spawn(this.helper,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new EngineError('UIA_TIMEOUT','Windows UI Automation timed out; refresh target state before retrying'));},12000);
      child.stdout.on('data',b=>{out+=b;if(out.length>2*1024*1024)child.kill();});child.stderr.on('data',b=>{err=(err+b).slice(0,500);});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',()=>{clearTimeout(timer);try{const r=JSON.parse(out.replace(/^\uFEFF/,''));if(!r.ok)throw new EngineError('DESKTOP_BLOCKED',r.error);resolve(r.result);}catch(e){reject(e);}});child.stdin.end(JSON.stringify(request)+'\n');});
  }
  async windows(){const got=await this.request({action:'windows'});return {...got,windows:got.windows.map(w=>({...w,enrolled:this.allowedPids.has(w.pid)}))};}
  async bind(hwnd){const got=await this.windows(),matches=got.windows.filter(w=>w.hwnd===String(hwnd));if(matches.length!==1)throw new EngineError('NO_WINDOW','Choose one current window from desktop_windows');const win=matches[0];
    if(!this.allowedPids.has(win.pid)||this.enrolledBirths?.has(win.pid)&&this.enrolledBirths.get(win.pid)!==win.birth)throw new EngineError('DESKTOP_NOT_ENROLLED','Window process must be enrolled by owner configuration or trusted outer RC9 broker');const targetId=crypto.randomUUID();this.targets.set(targetId,win);return {targetId,window:win};}
  target(id){const win=this.targets.get(id);if(!win)throw new EngineError('NO_TARGET','Bind a current enrolled window first');return win;}
  async act(id,action,{automationId,name,runtimeId,value}={}){const win=this.target(id),got=await this.request({...win,action,automationId,name,runtimeId,value});return {targetId:id,result:got};}
  async capture(id){const dir=path.join(this.stateDir,'artifacts');await fs.mkdir(dir,{recursive:true});const output=path.join(dir,`desktop-${crypto.randomUUID()}.png`);const result=await this.request({...this.target(id),action:'capture',output});return {...result,sha256:sha256(await fs.readFile(output)),mimeType:'image/png'};}
  // Only a trusted in-process broker may enroll a target. No MCP tool exposes enrollment.
  enrollFromBroker(pid,birth){if(!Number.isInteger(pid)||pid<1)throw new EngineError('BAD_PID','Invalid target PID');this.allowedPids.add(pid);if(birth){this.enrolledBirths??=new Map();this.enrolledBirths.set(pid,birth);}}
}
