import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const nativeWindowsExe=fileURLToPath(new URL('./NativeWindows.exe',import.meta.url));
export function nativeWindows(action,args={},timeout=45000){
 const r=spawnSync(nativeWindowsExe,[],{input:JSON.stringify({action,...args}),encoding:'utf8',windowsHide:true,timeout,maxBuffer:1024*1024});
 let value;try{value=JSON.parse(r.stdout);}catch{throw Error('Native Windows checks unavailable; repair bundled runtime');}
 if(r.error||r.status!==0||!value.ok)throw Object.assign(Error('Native Windows check failed: '+(value.code??'UNAVAILABLE')),{code:value.code??'WINDOWS_CHECK_UNAVAILABLE'});
 return value.result;
}
