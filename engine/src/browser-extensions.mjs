import path from 'node:path';import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {EngineError} from './file-engine.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const execFileP=promisify(execFile);
async function localAppData(){const {stdout}=await execFileP('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetFolderPath('LocalApplicationData')"],{windowsHide:true,timeout:10000});const dir=stdout.trim();if(!path.isAbsolute(dir))throw new EngineError('CHROME_PROFILE_UNAVAILABLE','Windows did not identify the current user browser directory');return dir;}
const bin=fileURLToPath(new URL('../../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js',import.meta.url));
const tools={list:'list_extensions',install:'install_extension',reload:'reload_extension',trigger:'trigger_extension_action',uninstall:'uninstall_extension'};
// One client/session per chat. No public debugging port, personal profile copy,
// direct chrome:// automation, management toggles, or desktop input fallback.
export class BrowserExtensions {
 constructor({stateDir,root,currentOwner=()=>'local',connect}={}){this.stateDir=stateDir;this.root=root;this.owner=currentOwner;this.connect=connect;this.sessions=new Map();}
 async session(target='existing'){
  const owner=this.owner();if(!owner)throw new EngineError('CONTEXT_REQUIRED','Retain this chat context before managing extensions');
  const key=owner+':'+target;let entry=this.sessions.get(key);if(entry)return entry.ready;
  entry={tail:Promise.resolve(),target};this.sessions.set(key,entry);
  entry.ready=(async()=>{
   const args=['--categoryExtensions','--no-usage-statistics','--no-performance-crux','--no-performance','--filesystemRoot',this.root];
   if(target==='developer'){const dir=path.join(this.stateDir,'developer-browsers',createHash('sha256').update(owner).digest('hex').slice(0,24));await fs.mkdir(dir,{recursive:true});args.push('--headless','--userDataDir',dir);}else {args.push('--autoConnect');if(!this.connect&&process.platform==='win32')args.push('--userDataDir',path.join(await localAppData(),'Google','Chrome','User Data'));}
   if(this.connect){entry.client=await this.connect(args);return entry;}
   const env={};for(const k of ['PATH','SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','USERPROFILE','HOME','LOCALAPPDATA','APPDATA','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
   const client=new Client({name:'YGPT Local browser extensions',version:'1.0.17'},{capabilities:{}}),transport=new StdioClientTransport({command:process.execPath,args:[bin,...args],cwd:this.root,stderr:'pipe',env:{...env,CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:'1',CHROME_DEVTOOLS_MCP_NO_PERFORMANCE_CRUX:'1'}});
   entry.client=client;entry.transport=transport;transport.stderr?.on('data',()=>{});await client.connect(transport,{timeout:15000});return entry;
  })().catch(async e=>{if(this.sessions.get(key)===entry)this.sessions.delete(key);await entry.client?.close().catch(()=>{});throw e;});return entry.ready;
 }
 async run({action='status',target='existing',id,extensionPath}={}){
  if(target!=='existing'&&target!=='developer')throw new EngineError('BROWSER_DEBUG_TARGET_INVALID','Choose existing (Chrome confirms debugging) or developer (separate private browser)');
  if(!['status','list','install','reload','trigger','uninstall','close'].includes(action))throw new EngineError('EXTENSION_ACTION_INVALID','Unsupported extension action');
  if(action==='close'){await this.closeContext(this.owner(),target);return {closed:true,target,personalBrowserClosed:false};}
  const entry=await this.session(target),job=entry.tail.catch(()=>{}).then(async()=>{
   if(action==='status'){const catalog=await entry.client.listTools();return {target,adapter:'Chrome DevTools MCP 1.12.0',tools:catalog.tools.filter(t=>Object.values(tools).includes(t.name)).map(t=>t.name),browserConnectionVerified:false,requiresChromeConfirmation:target==='existing',setupUrl:target==='existing'?'chrome://inspect/#remote-debugging':null,desktopInputUsed:false,personalProfilesCopied:false};}
   let args={};if(['reload','trigger','uninstall'].includes(action)){if(!/^[a-p]{32}$/.test(id??''))throw new EngineError('EXTENSION_ID_REQUIRED','Use the exact 32-letter extension ID returned by list');args.id=id;}
   if(action==='install'){if(!path.isAbsolute(extensionPath??''))throw new EngineError('EXTENSION_PATH_REQUIRED','Provide an absolute unpacked extension directory');const dir=await fs.realpath(extensionPath),manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));if(![2,3].includes(manifest.manifest_version)||typeof manifest.name!=='string')throw new EngineError('EXTENSION_MANIFEST_INVALID','This directory has no recognized extension manifest');args.path=dir;}
   let response;try{response=await entry.client.callTool({name:tools[action],arguments:args},undefined,{timeout:60000});}catch(e){const mutating=action!=='list';throw Object.assign(new EngineError('EXTENSION_TRANSPORT_INTERRUPTED',mutating?'The browser operation may have started. List the existing extension state before taking another action; do not replay it.':'The browser inventory was interrupted; this read can be checked again.'),{effectStarted:mutating,outcomeUnknown:mutating});}
   if(response.isError){const details=response.content?.filter(c=>c.type==='text').map(c=>c.text.slice(0,3000)).join('\n')??'Extension operation failed';
    const unstarted=/could not connect|DevToolsActivePort|remote debugging.*enabled|not found|not authorized|invalid.*(?:id|path)|access denied/i.test(details);
    if(action!=='list'&&!unstarted)throw Object.assign(new EngineError('EXTENSION_OUTCOME_UNKNOWN','Extension operation did not complete normally. Inspect current extension state; do not replay the operation. '+details.slice(0,500)),{outcomeUnknown:true,effectStarted:true});
    return {target,action,ok:false,state:action==='list'?'unavailable':'failed',setupRequired:target==='existing',code:target==='existing'?'CHROME_DEBUG_CONNECTION_REQUIRED':'EXTENSION_OPERATION_FAILED',details,...(target==='existing'?{nextAction:'In the intended Chrome profile, enable remote debugging at chrome://inspect/#remote-debugging and personally confirm Chrome’s connection prompt. Then repeat this read-only list before a mutation. Do not use desktop input or change another profile.'}:{}),noDesktopFallback:true};}
   return {target,action,ok:true,state:'succeeded',result:response.structuredContent??response.content,desktopInputUsed:false};
  });entry.tail=job;return job;
 }
 async closeContext(owner,target=null){for(const [key,e] of this.sessions)if(key.startsWith(owner+':')&&(!target||e.target===target)){this.sessions.delete(key);await e.ready.catch(()=>{});await e.client?.close().catch(()=>{});}}
 async close(){for(const owner of [...new Set([...this.sessions.keys()].map(k=>k.split(':')[0]))])await this.closeContext(owner);}
}
