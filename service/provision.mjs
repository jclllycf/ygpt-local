import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {makeConfig} from './configuration.mjs';
import {loadSecrets} from './secrets.mjs';
import {createCloudflare} from './cloudflare.mjs';
const install=fileURLToPath(new URL('..',import.meta.url));
let input='';for await(const b of process.stdin)input+=b;
try{
 const a=JSON.parse(input),data=path.resolve(a.dataDir),secrets=loadSecrets(data,install),port=Number(a.port);
 if(!path.isAbsolute(a.projectRoot)||!fs.statSync(a.projectRoot).isDirectory())throw Error('Choose an existing working folder');
 const cfg=makeConfig({installDir:install,dataDir:data,projectRoots:[a.projectRoot],python:path.join(install,'runtimes/python/python.exe'),pythonArgs:['-B'],port,headless:a.headless!==false});
 const priorConfig=path.join(data,'ygpt.config.json');if(fs.existsSync(priorConfig)){const old=JSON.parse(fs.readFileSync(priorConfig));if(old.product!=='YGPT Local')throw Error('State belongs to a different product; use optional migration into separate data');cfg.ingressId=old.ingressId;cfg.executables=old.executables??{};}
 let connection={mode:a.mode,...(a.mode.startsWith('cloudflare')?{publicOrigin:a.publicOrigin}:{}),tunnelId:a.tunnelId,autoStart:a.autoStart===true};
 if(a.mode==='cloudflare-create'){
  const created=await createCloudflare({apiToken:secrets.apiToken,accountId:a.accountId,zoneId:a.zoneId,hostname:a.hostname,port,confirmCreate:a.confirmCreate});secrets.tunnelToken=created.tunnelToken;delete secrets.apiToken;connection={...connection,...created};delete connection.tunnelToken;
  const sealed=execFileSync(cfg.python,['-B',path.join(install,'runtime/secure_store.py')],{input:JSON.stringify({action:'protect',value:JSON.stringify(secrets)}),encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(data,'credentials.dpapi'),sealed);
 }
 if(a.mode.startsWith('cloudflare')){const u=new URL(connection.publicOrigin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||!secrets.tunnelToken)throw Error('Cloudflare requires your stable HTTPS hostname and connector token');connection.publicOrigin=u.origin;if(!fs.existsSync(path.join(install,'runtimes/cloudflared.exe')))throw Error('Bundled cloudflared is missing');}
 else if(a.mode==='secure-tunnel'){if(!/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(a.tunnelId??'')||!secrets.runtimeKey)throw Error('Secure MCP Tunnel requires the complete dedicated tunnel ID and runtime key with Tunnels Read + Use');if(!fs.existsSync(path.join(install,'runtimes/tunnel-client.exe')))throw Error('Bundled official tunnel-client is missing. Repair the application using the full installer.');
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');const inventory=JSON.parse(execFileSync(ps,['-NoProfile','-NonInteractive','-File',path.join(install,'service/tunnel-conflict.ps1'),'-TunnelId',a.tunnelId],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PSModulePath:path.join(path.dirname(ps),'Modules')}}));if(inventory.conflict||!inventory.processInventoryAvailable)throw Error('Another tunnel-client already owns this tunnel, or its identity cannot be checked. Choose a dedicated tunnel; the existing process was not changed.');}
 else if(a.mode!=='local-only')throw Error('Unsupported connection type');
 fs.mkdirSync(data,{recursive:true});for(const name of ['ygpt.config.json','connection.json']){const p=path.join(data,name);if(fs.existsSync(p))fs.copyFileSync(p,p+'.before-'+Date.now());}
 fs.writeFileSync(path.join(data,'ygpt.config.json'),JSON.stringify(cfg,null,2));fs.writeFileSync(path.join(data,'connection.json'),JSON.stringify(connection,null,2));
 console.log(JSON.stringify({ok:true,localConfigured:true,connectionConfigured:a.mode!=='local-only',publicEndpoint:connection.publicOrigin?connection.publicOrigin+'/mcp':null,pluginCreated:false,message:'Configuration saved. Start the service and verify each connection stage. ChatGPT confirmation is still required.'}));
}catch(e){console.log(JSON.stringify({ok:false,code:e.code??'SETUP_FAILED',message:e.message}));process.exitCode=1;}
