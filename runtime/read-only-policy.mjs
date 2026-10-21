import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cache=new Map();
export const fileReadTools=new Set(['read_file','read_multiple_files','list_directory','get_file_info','start_search','verify_checksum','y_sqlite_read']);
export function isReadOnlyCommand(command){
 if(typeof command!=='string'||!command.trim()||command.length>12000)return false;
 if(cache.has(command))return cache.get(command);
 const exe=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const r=spawnSync(exe,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./read-only-command.ps1',import.meta.url))],{input:command,encoding:'utf8',windowsHide:true,timeout:6000,maxBuffer:1024});
 const safe=r.status===0&&r.stdout.trim()==='true';
 if(cache.size>=128)cache.clear();cache.set(command,safe);return safe;
}
export function isReadOnlyInvocation(args={}){
 const exe=path.win32.basename(String(args.executable??args.argv?.[0]??'')).toLowerCase(),argv=args.args??args.argv?.slice(1)??[];
 if(!['powershell.exe','pwsh.exe','powershell','pwsh'].includes(exe))return false;
 let i=0;for(;i<argv.length;i++){
  const flag=String(argv[i]).toLowerCase();
  if(['-noprofile','-noninteractive','-nologo'].includes(flag))continue;
  if(flag==='-command'&&i===argv.length-2)return isReadOnlyCommand(argv[i+1]);
  return false;
 }return false;
}
