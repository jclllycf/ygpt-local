import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BrokerClient} from '../service/rpc.mjs';
import {makeConfig} from '../service/configuration.mjs';
export const root=fileURLToPath(new URL('..',import.meta.url));
export function fixture(){const base=path.join(path.dirname(root),'.ygpt-local-tests');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'case-')),project=path.join(dir,'project');fs.mkdirSync(project);const config=makeConfig({installDir:root,dataDir:path.join(dir,'data'),projectRoots:[project],python:process.env.YGPT_TEST_PYTHON??'py',pythonArgs:process.env.YGPT_TEST_PYTHON?['-B']:['-3.14','-B']});config.deployment='isolated';const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(config));return {dir,project,config,file,client:()=>new BrokerClient({entry:path.join(root,'runtime/bootstrap.mjs'),config:file,cwd:project})};}
export const unpack=r=>r.structuredContent??JSON.parse(r.content[0].text);
export async function until(fn,ms=30000){const begin=Date.now();while(Date.now()-begin<ms){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,200));}throw Error('Condition deadline');}
