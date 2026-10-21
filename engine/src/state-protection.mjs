import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const run=promisify(execFile);
export async function protectState(stateDir,{verifyOnly=false}={}){
  const exe=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./workers/secure-state.ps1',import.meta.url)),'-StateDir',stateDir];
  if(verifyOnly)args.push('-VerifyOnly');
  const env={...process.env,PSModulePath:path.join(path.dirname(exe),'Modules')};
  const {stdout}=await run(exe,args,{env,windowsHide:true,timeout:20000,maxBuffer:65536});return JSON.parse(stdout.trim());
}
