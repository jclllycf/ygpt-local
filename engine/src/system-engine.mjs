import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {EngineError} from './file-engine.mjs';
const commands={
  processes:'Get-Process | Select-Object -First 250 Id,ProcessName,SessionId,CPU,WorkingSet64',
  services:'Get-Service | Select-Object -First 350 Name,DisplayName,@{n="Status";e={$_.Status.ToString()}}',
  disks:'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,FileSystem,Size,FreeSpace,VolumeName',
  autostarts:'Get-CimInstance Win32_StartupCommand | Select-Object -First 150 Name,Location,User',
  events:"Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddDays(-3)} -MaxEvents 20 -ErrorAction Stop | Select-Object TimeCreated,Id,LevelDisplayName,ProviderName",
};
import {statfs} from 'node:fs/promises';
export class YSystemEngine {
  // physicalDisks: optional read-only disk/partition inventory supplied by the
  // broker's native helper (never formats or writes); fixtures leave it unset.
  constructor({stateDir,physicalDisks}={}){this.stateDir=stateDir;this.physicalDisks=physicalDisks;}
  async inspect(kind){
    if(kind==='health'){let freeDisk=null;try{const d=await statfs(path.parse(path.resolve(this.stateDir??'.')).root);freeDisk=d.bavail*d.bsize;}catch{}
      return {product:'YGPT Local',platform:process.platform,node:process.version,pid:process.pid,osRelease:os.release(),uptimeSeconds:os.uptime(),cpuThreads:os.cpus().length,totalMemory:os.totalmem(),freeMemory:os.freemem(),freeDisk,readOnly:true};}
    if(kind==='physical-disks'){if(typeof this.physicalDisks!=='function')throw new EngineError('DIAGNOSTIC_UNAVAILABLE','Physical disk inventory needs the Windows native helper');return {kind,readOnly:true,observedAt:new Date().toISOString(),data:await this.physicalDisks()};}
    const source=commands[kind];if(!source)throw new EngineError('BAD_DIAGNOSTIC','Choose health, processes, services, disks, events or autostarts');
    const exe=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);@("+source+") | ConvertTo-Json -Depth 4 -Compress";
    return new Promise((resolve,reject)=>{const child=spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,PSModulePath:path.join(path.dirname(exe),'Modules')},windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new EngineError('DIAGNOSTIC_TIMEOUT','Windows diagnostic timed out'));},15000);
      child.stdout.on('data',b=>{out+=b;if(out.length>1048576)child.kill();});child.stderr.on('data',b=>{err=(err+b).slice(0,700);});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);if(code)return reject(new EngineError('DIAGNOSTIC_UNAVAILABLE',err));try{resolve({kind,readOnly:true,observedAt:new Date().toISOString(),data:JSON.parse(out||'[]')});}catch(e){reject(e);}});});
  }
}
