import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function loadSecrets(root,install){
 const p=path.join(root,'credentials.dpapi');if(fs.lstatSync(p).isSymbolicLink())throw Error('Linked credential store refused');
 const python=path.join(install,'runtimes/python/python.exe');
 const value=execFileSync(python,['-B',path.join(install,'runtime/secure_store.py')],{input:JSON.stringify({action:'unprotect',value:fs.readFileSync(p,'utf8')}),encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 return JSON.parse(value);
}
export function encryptedState(root,install,name,{python=path.join(install,'runtimes/python/python.exe')}={}){
 if(!/^[a-z][a-z-]+\.dpapi$/.test(name))throw Error('Invalid encrypted state name');
 const target=path.join(root,name);
 const crypt=(action,value)=>execFileSync(python,['-B',path.join(install,'runtime/secure_store.py')],{input:JSON.stringify({action,value}),encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 const rejectLinks=p=>{if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Linked state store refused');};
 return {load(){rejectLinks(target);return fs.existsSync(target)?JSON.parse(crypt('unprotect',fs.readFileSync(target,'utf8'))):null;},save(value){rejectLinks(target);const temp=target+'.new';rejectLinks(temp);fs.writeFileSync(temp,crypt('protect',JSON.stringify(value)),{flag:'w',mode:0o600});fs.renameSync(temp,target);}};
}
