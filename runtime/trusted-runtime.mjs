import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const entries=new Set(['runtimes/node/node.exe','runtimes/node/npm.cmd','runtimes/node/npx.cmd','runtimes/python/python.exe']);
// Trust an exact shipped executable and its current manifest hash, never a
// whole directory or an executable basename supplied by the model.
export function trustedRuntimeExecutable(executable,install){
 return verifiedFile(executable,install,entries);
}
function verifiedFile(executable,install,allowed){
 try{
  const root=fs.realpathSync.native(install),full=path.resolve(executable),relative=path.relative(root,full).replaceAll('\\','/');
  if(!allowed.has(relative.toLowerCase()))return false;
  const key=p=>process.platform==='win32'?p.toLowerCase():p;
  for(let p=full;key(p)!==key(root);p=path.dirname(p)){if(p===path.dirname(p)||fs.lstatSync(p).isSymbolicLink())return false;}
  const manifestPath=path.join(root,'manifest.json');if(fs.lstatSync(manifestPath).isSymbolicLink())return false;
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(manifest.product!=='YGPT Local'||!Array.isArray(manifest.files))return false;
  const entry=manifest.files.find(f=>String(f.path).toLowerCase()===relative.toLowerCase()),stat=fs.statSync(full);
  return !!entry&&stat.isFile()&&entry.bytes===stat.size&&/^[a-f0-9]{64}$/i.test(entry.sha256)&&createHash('sha256').update(fs.readFileSync(full)).digest('hex')===entry.sha256;
 }catch{return false;}
}

// Windows does not execute .cmd files directly with shell:false. Only the
// shipped npm/npx shims have a known equivalent argv; never infer an entry
// point for an arbitrary script or introduce shell command-line parsing.
export function trustedRuntimeLaunch(spec,install,{platform=process.platform}={}){
 if(platform!=='win32'||!['npm.cmd','npx.cmd'].includes(path.basename(spec.executable).toLowerCase())||!trustedRuntimeExecutable(spec.executable,install))return spec;
 const node=path.join(install,'runtimes/node/node.exe'),name=path.basename(spec.executable).toLowerCase().slice(0,-4),cli=path.join(install,'runtimes/node/node_modules/npm/bin',name+'-cli.js');
 const cliEntries=new Set(['runtimes/node/node_modules/npm/bin/npm-cli.js','runtimes/node/node_modules/npm/bin/npx-cli.js']);
 if(!trustedRuntimeExecutable(node,install)||!verifiedFile(cli,install,cliEntries))throw Object.assign(Error('Bundled npm/npx launch dependencies changed; repair the installation before execution'),{code:'EXECUTION_TARGET_CHANGED',effectStarted:false});
 return {...spec,executable:node,args:[cli,...spec.args]};
}
