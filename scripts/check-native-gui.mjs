import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const install=path.resolve('build/YGPTLocal.exe'),helper=path.resolve('engine/build/YDesktop.exe');
const proc=spawn(install,['--data-dir',path.resolve('.local/gui-data'),'--install-dir','D:\\YGPT-Demo\\App'],{windowsHide:false,stdio:'ignore'});
const call=a=>{const r=JSON.parse(execFileSync(helper,[],{input:JSON.stringify(a)+'\n',encoding:'utf8',windowsHide:true}));if(!r.ok)throw Error(r.error);return r.result;};
try{
 let window;for(let i=0;i<40;i++){window=call({action:'windows'}).windows.find(w=>w.pid===proc.pid);if(window)break;await new Promise(r=>setTimeout(r,200));}if(!window)throw Error('Setup window did not appear');
 call({...window,action:'setValue',automationId:'folder',value:'D:\\YGPT-Demo\\Workspace'});
 const tree=call({...window,action:'tree'});if(!tree.elements.some(e=>e.name==='YGPT Local'))throw Error('Brand missing');
 fs.mkdirSync('docs/images',{recursive:true});call({...window,action:'capture',output:path.resolve('docs/images/setup-welcome.png')});
 call({...window,action:'invoke',automationId:'next'});const negative=call({...window,action:'tree'});if(!negative.elements.some(e=>(e.name??'').includes('Please review and confirm')))throw Error('Consent gate did not block installation');
 fs.writeFileSync('evidence/native-gui-check.json',JSON.stringify({passed:true,source:'actual Windows WPF window and native UIA, not an HTML mock',brandVisible:true,consentGateVerified:true,screenshot:'docs/images/setup-welcome.png',installationPerformed:false,at:new Date().toISOString()},null,2));console.log('Native GUI rendered; UIA controls and consent gate passed.');
}finally{proc.kill();}
