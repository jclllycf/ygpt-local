import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const version='1.0.18';
const clean=value=>String(value??'').replace(/(?:Bearer\s+\S+|[a-zA-Z_]*(?:token|secret|password)["']?\s*[:=]\s*[^\s,;}]+)/gi,'[redacted]').slice(0,2000);
function save(file,value){
  const temp=file+'.'+randomUUID()+'.tmp';
  try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);}
  finally{try{fs.rmSync(temp,{force:true});}catch{}}
}
function locations(){
  const configFile=process.env.YGPT_CONFIG;let config={};
  try{config=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));}catch{}
  const data=process.env.YGPT_SETUP_DATA_DIR||(configFile?path.dirname(configFile):null);
  return {diagnostic:config.startupDiagnostics,health:data?path.join(data,'service-health.json'):null};
}
export function recordStartupFailure(error){
  const report={at:new Date().toISOString(),version,phase:'startup',code:/^[A-Z][A-Z0-9_]*$/.test(error.code??'')?error.code:'STARTUP_FAILED',message:clean(error.message??error),pid:process.pid,
    ...(typeof error.path==='string'?{path:clean(error.path)}:{}),...(typeof error.target==='string'?{target:clean(error.target)}:{})};
  const files=locations();
  if(files.diagnostic)try{save(files.diagnostic,report);}catch{}
  if(files.health)try{save(files.health,{product:'YGPT Local',version,pid:process.pid,localReady:false,phase:'startup-failed',lastError:report.code,startupFailure:report,at:report.at});}catch{}
  process.stderr.write(JSON.stringify(report)+'\n');
  return report;
}
export function clearStartupFailure(){
  const file=locations().health;if(!file)return;
  try{const health=JSON.parse(fs.readFileSync(file,'utf8'));if(health.startupFailure)save(file,{...health,pid:process.pid,localReady:true,phase:'local-ready',lastError:'',startupFailure:null,at:new Date().toISOString()});}catch{}
}
