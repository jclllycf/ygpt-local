import path from 'node:path';
import {nativeWindows} from './windows-native.mjs';
import {isReadOnlySshInvocation} from './ssh-read-policy.mjs';
const cache=new Map();
export const fileReadTools=new Set(['read_file','read_multiple_files','list_directory','get_file_info','start_search','y_verify_checksum','y_sqlite_read']);
export function isReadOnlyCommand(command){
 if(typeof command!=='string'||!command.trim()||command.length>12000)return false;
 if(cache.has(command))return cache.get(command);
 let safe=false;try{safe=nativeWindows('command-readonly',{command},6000)===true;}catch{}
 if(cache.size>=128)cache.clear();cache.set(command,safe);return safe;
}
export function isReadOnlyInvocation(args={}){
 if(isReadOnlySshInvocation(args))return true;
 const exe=path.win32.basename(String(args.executable??args.argv?.[0]??'')).toLowerCase(),argv=args.args??args.argv?.slice(1)??[];
 if(!['powershell.exe','pwsh.exe','powershell','pwsh'].includes(exe))return false;
 let i=0;for(;i<argv.length;i++){
  const flag=String(argv[i]).toLowerCase();
  if(['-noprofile','-noninteractive','-nologo'].includes(flag))continue;
  if(flag==='-command'&&i===argv.length-2)return isReadOnlyCommand(argv[i+1]);
  return false;
 }return false;
}
