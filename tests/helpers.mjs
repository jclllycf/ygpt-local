import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BrokerClient} from '../service/rpc.mjs';
import {makeConfig} from '../service/configuration.mjs';
export const root=fileURLToPath(new URL('..',import.meta.url));
export function fixture(){const base=path.join(path.dirname(root),'.ygpt-local-tests');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'case-')),project=path.join(dir,'project');fs.mkdirSync(project);const config=makeConfig({installDir:root,dataDir:path.join(dir,'data'),projectRoots:[project],python:process.env.YGPT_TEST_PYTHON??'py',pythonArgs:process.env.YGPT_TEST_PYTHON?['-B']:['-3.14','-B']});config.deployment='isolated';config.startupDiagnostics=path.join(dir,'startup-error.json');const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(config));return {dir,project,config,file,client:()=>{const c=new BrokerClient({entry:path.join(root,'runtime/bootstrap.mjs'),config:file,cwd:project}),start=c.start.bind(c);c.start=async()=>{try{return await start();}catch(e){if(fs.existsSync(config.startupDiagnostics)){const report=JSON.parse(fs.readFileSync(config.startupDiagnostics));throw Error('Isolated fixture startup: '+report.code+' '+report.message.replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+/gi,'<USER>'));}throw e;}};return c;}};}
export const unpack=r=>r.structuredContent??JSON.parse(r.content[0].text);
export async function until(fn,ms=30000){const begin=Date.now();while(Date.now()-begin<ms){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,200));}throw Error('Condition deadline');}
// Fixture stand-in for the in-chat card: render the card for this exact
// request, then click with its widget-only capability. NOT human-host attestation.
export async function decide(c,pending,decision='once',contextToken=pending.contextToken){
 const card=await c.call('y_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,contextToken});
 const r=await c.call('y_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yBar.uiToken,decision});if(r.isError)throw Error('Decision rejected: '+JSON.stringify(r));
 if(decision==='deny')return unpack(r);
 await until(async()=>!['awaiting_user','approved','running'].includes(unpack(await c.call('y_call_status',{id:pending.requestId})).state));
 return unpack(await c.call('y_call_result',{id:pending.requestId,resultToken:pending.resultToken}));
}
