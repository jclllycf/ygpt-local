import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {parse as parseToml} from 'smol-toml';
import {parse as parseJsonc} from 'jsonc-parser';
import {EngineError} from './file-engine.mjs';

const execFileP=promisify(execFile), digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const MAX_CONFIG=2*1024*1024;
export const sourceId=(kind,source,name)=>kind+'-'+digest(source+'\0'+name).slice(0,20);
export async function ownerFolders(){
  if(process.platform!=='win32'){const home=os.homedir();return {home,local:path.join(home,'.local','share'),roaming:path.join(home,'.config'),path:process.env.PATH??''};}
  // Read OS-known folders, not the broker's deliberately redirected HOME/TMP.
  const {stdout}=await execFileP('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@{home=[Environment]::GetFolderPath('UserProfile');local=[Environment]::GetFolderPath('LocalApplicationData');roaming=[Environment]::GetFolderPath('ApplicationData');path=([Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'))}|ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000,maxBuffer:65536});
  const value=JSON.parse(stdout);if(!path.isAbsolute(value.home))throw new EngineError('LOCAL_PROFILE_UNAVAILABLE','Windows did not identify the owner profile');return value;
}
async function readConfig(filename){
  const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>MAX_CONFIG)throw new Error('CONFIG_TOO_LARGE');
  const text=await fs.readFile(filename,'utf8');if(filename.endsWith('.toml'))return parseToml(text);
  const errors=[],value=parseJsonc(text,errors,{allowTrailingComma:true,disallowComments:false});if(errors.length)throw new Error('CONFIG_PARSE_FAILED');return value;
}
export function expand(value,env){return String(value).replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}|\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,(_,a,b)=>{const key=a??b;if(env[key]===undefined)throw new EngineError('LOCAL_ENV_MISSING','The configured environment variable '+key+' is unavailable; configure it for this service');return env[key];});}
const baseKeys=['PATH','Path','SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'];
export function profileEnvironment(folders,overrides={}){
  const env={};for(const k of baseKeys)if(process.env[k])env[k]=process.env[k];
  return {...env,PATH:folders.path||process.env.PATH||'',HOME:folders.home,USERPROFILE:folders.home,LOCALAPPDATA:folders.local,APPDATA:folders.roaming,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',GIT_TERMINAL_PROMPT:'0',...overrides};
}
export class LocalCatalog {
  constructor({root,stateDir,folders,configFiles,cliDirectories,extraProfiles=[]}={}){Object.assign(this,{root,stateDir,folderInput:folders,configFiles,cliDirectories,extraProfiles});this.entries=new Map();this.expires=0;}
  async refresh(force=false){
    if(!force&&Date.now()<this.expires)return this;
    if(this.scanning)return this.scanning;
    this.scanning=this.scan().finally(()=>{this.scanning=null;});return this.scanning;
  }
  async scan(){
    this.folders=this.folderInput??await ownerFolders();const f=this.folders;
    const files=this.configFiles?[...this.configFiles]:[
      path.join(f.home,'.codex','config.toml'),path.join(f.home,'.claude.json'),path.join(f.roaming,'Claude','claude_desktop_config.json'),
      path.join(f.roaming,'Code','User','mcp.json'),path.join(f.roaming,'Code - Insiders','User','mcp.json'),path.join(f.home,'.cursor','mcp.json'),
      path.join(f.home,'.codeium','windsurf','mcp_config.json'),path.join(f.home,'.gemini','settings.json'),path.join(f.home,'.gemini','antigravity','mcp_config.json'),
      path.join(this.root,'.mcp.json'),path.join(this.root,'.vscode','mcp.json'),path.join(this.root,'.codex','config.toml'),path.join(f.home,'.ygpt','local-tools.json')];
    // Explicit additional account homes are separate sources, never merged.
    for(const home of this.extraProfiles)files.push(path.join(home,'config.toml'));
    if(!this.configFiles){for(const parent of [path.join(f.roaming,'Code','User','profiles'),path.join(f.home,'.config','opencode')]){
      const dirs=await fs.readdir(parent,{withFileTypes:true}).catch(()=>[]);for(const d of dirs.slice(0,32))if(d.isDirectory()&&!d.isSymbolicLink())files.push(path.join(parent,d.name,'mcp.json'));
    }}
    this.preferences={sources:[],excluded:[]};if(this.stateDir){try{this.preferences=await readConfig(path.join(this.stateDir,'local-tool-sources.json'));}catch(e){if(e.code!=='ENOENT')throw new EngineError('LOCAL_SOURCES_INVALID','The YGPT source index is invalid; no default configuration was substituted');}}
    if(!Array.isArray(this.preferences.sources)||this.preferences.sources.length>64||this.preferences.sources.some(x=>typeof x!=='string'||!path.isAbsolute(x))||!Array.isArray(this.preferences.excluded)||this.preferences.excluded.length>4096)throw new EngineError('LOCAL_SOURCES_INVALID','The YGPT source index has invalid fields');
    files.push(...this.preferences.sources);
    const entries=new Map(),warnings=[],profiles=[];
    const put=e=>{e.id=sourceId(e.kind,e.source,e.name);e.fingerprint=digest(e);entries.set(e.id,e);};
    const pending=[...new Set(files)];for(let fileIndex=0;fileIndex<pending.length&&fileIndex<128;fileIndex++){
      const source=pending[fileIndex];
      let data;try{data=await readConfig(source);}catch(e){if(e.code!=='ENOENT')warnings.push({source,code:e.message==='CONFIG_TOO_LARGE'?'CONFIG_TOO_LARGE':'CONFIG_UNAVAILABLE'});continue;}
      if(!data||typeof data!=='object')continue;
      if(source.endsWith(path.join('.ygpt','local-tools.json')))for(const item of (Array.isArray(data.sources)?data.sources:[]).slice(0,64))if(typeof item==='string'&&path.isAbsolute(item)&&!pending.includes(item))pending.push(item);
      const projectConfig=path.resolve(source)===path.join(this.root,'.codex','config.toml')&&path.resolve(this.root)!==path.resolve(f.home);
      const accountHome=source.endsWith('config.toml')&&!projectConfig?path.dirname(source):null;
      if(accountHome)profiles.push({home:accountHome,source,model:typeof data.model==='string'?data.model:null,provider:typeof data.model_provider==='string'?data.model_provider:'configured default'});
      const servers=data.mcpServers??data.mcp_servers??data.servers??{};
      for(const [name,spec] of Object.entries(servers).slice(0,256)){
        if(!spec||typeof spec!=='object')continue;
        const command=spec.command,url=spec.url??spec.httpUrl??spec.serverUrl;
        if(typeof command!=='string'&&typeof url!=='string'){warnings.push({source,name,code:'MCP_TRANSPORT_UNSUPPORTED'});continue;}
        if(spec.args!==undefined&&(!Array.isArray(spec.args)||spec.args.some(a=>typeof a!=='string'))){warnings.push({source,name,code:'MCP_ARGS_INVALID'});continue;}
        put({kind:'mcp',name,source,accountHome,enabled:spec.enabled!==false&&spec.disabled!==true,transport:command?'stdio':spec.type==='sse'?'sse':'http',command,args:spec.args??[],url,cwd:spec.cwd?path.resolve(path.dirname(source),spec.cwd):projectConfig?this.root:path.dirname(source),env:spec.env??{},envVars:spec.env_vars??[],headers:spec.headers??spec.http_headers??{},envHeaders:spec.env_http_headers??{},bearerEnv:spec.bearer_token_env_var,description:typeof spec.description==='string'?spec.description.slice(0,1200):name});
      }
      for(const [name,spec] of Object.entries(data.agents??{}).slice(0,64))if(spec&&typeof spec.executable==='string')put({kind:'agent',name,source,executable:spec.executable,args:spec.args??[],adapter:spec.adapter??'stdin',accountHome:spec.accountHome??null,env:spec.env??{},description:spec.description??name,enabled:spec.enabled!==false});
      for(const [name,spec] of Object.entries(data.cli??{}).slice(0,256))if(spec&&typeof spec.executable==='string')put({kind:'cli',name,source,executable:spec.executable,args:spec.args??[],env:spec.env??{},description:spec.description??name,enabled:spec.enabled!==false});
    }
    const dirs=this.cliDirectories??[...(f.path??'').split(path.delimiter),path.join(f.home,'.local','bin'),path.join(f.roaming,'npm')];
    if(!this.cliDirectories){const parent=path.join(f.local,'OpenAI','Codex','bin');const versions=await fs.readdir(parent,{withFileTypes:true}).catch(()=>[]);for(const d of versions.slice(0,32))if(d.isDirectory()&&!d.isSymbolicLink())dirs.push(path.join(parent,d.name));}
    const bins=[];
    for(const directory of [...new Set(dirs.filter(x=>x&&path.isAbsolute(x)))].slice(0,128)){
      const list=await fs.readdir(directory,{withFileTypes:true}).catch(()=>[]);
      for(const e of list.slice(0,1024))if(e.isFile()&&(/\.(?:exe|com|cmd|bat|ps1)$/i.test(e.name)||process.platform!=='win32'&&!e.name.includes('.'))){
        const executable=path.join(directory,e.name),name=e.name.replace(/\.(exe|com|cmd|bat|ps1)$/i,'');bins.push({name,executable});
        put({kind:'cli',name,source:directory,executable,args:[],env:{},enabled:true,description:'Installed command-line program; no automatic execution or version probe'});
      }
    }
    for(const b of bins.filter(b=>/^codex$/i.test(b.name)&&!/\.(cmd|bat|ps1)$/i.test(b.executable))){
      const homes=profiles.length?profiles:[{home:path.join(f.home,'.codex'),source:path.join(f.home,'.codex','config.toml'),model:null,provider:'configured default'}];
      for(const p of homes)put({kind:'agent',name:'Codex · '+path.basename(p.home),source:p.source+'|'+b.executable,executable:b.executable,args:[],adapter:'codex',accountHome:p.home,env:{},enabled:true,model:p.model,provider:p.provider,description:'Local Codex CLI; uses this exact account home and its configured model/provider/MCP environment'});
    }
    for(const b of bins.filter(b=>/^(claude|gemini|opencode|aider|goose)$/i.test(b.name)))put({kind:'agent',name:b.name,source:b.executable,executable:b.executable,args:[],adapter:'custom',accountHome:null,env:{},enabled:true,description:'Installed Agent CLI. Supply its documented non-interactive argv and prompt stdin; provider/model/permissions are not overridden. Use y_cli --help first to inspect this installed version.'});
    for(const e of entries.values())if(this.preferences.excluded.includes(e.id)){e.enabled=false;e.excludedByYGPT=true;}
    this.entries=entries;this.warnings=warnings;this.expires=Date.now()+60000;return this;
  }
  public(e){return {id:e.id,kind:e.kind,name:e.name,description:e.description,source:e.source,enabled:e.enabled,...(e.kind==='mcp'?{transport:e.transport,configured:true,connected:false}:{executable:e.executable,adapter:e.adapter??null,accountHome:e.accountHome??null,model:e.model??null,provider:e.provider??null}),credentialsIncluded:false};}
  async list({kind='all',query='',offset=0,limit=40,refresh=false}={}){
    await this.refresh(refresh);const words=query.toLowerCase().split(/\s+/).filter(Boolean),all=[...this.entries.values()].filter(e=>(kind==='all'||e.kind===kind)&&words.every(w=>(e.name+' '+e.description+' '+e.source).toLowerCase().includes(w)));
    return {entries:all.slice(offset,offset+limit).map(e=>this.public(e)),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,warnings:this.warnings,scanScope:'Recognized MCP config files, explicit additional sources and bounded PATH inventory; no disk-wide scan and no service started',scannedAt:new Date(this.expires-60000).toISOString()};
  }
  async get(id,kind){await this.refresh();const e=this.entries.get(id);if(!e||kind&&e.kind!==kind)throw new EngineError('LOCAL_ENTRY_UNKNOWN','Discover the exact local capability ID first');if(!e.enabled)throw new EngineError('LOCAL_ENTRY_DISABLED','This source configuration explicitly disables the entry');return e;}
  manage(a){const op=(this.manageTail??Promise.resolve()).catch(()=>{}).then(()=>this.manageNow(a));this.manageTail=op;return op;}
  async manageNow({action,source,entryId}){
    if(!this.stateDir)throw new EngineError('LOCAL_SOURCES_UNAVAILABLE','Source management requires the installed private state');await this.refresh();
    if(action==='add_source'){
      if(!path.isAbsolute(source??'')||!/(?:\.jsonc?|\.toml)$/i.test(source))throw new EngineError('LOCAL_SOURCE_INVALID','Choose an absolute existing MCP/Agent JSON or TOML configuration file');
      const filename=await fs.realpath(source);await readConfig(filename);if(this.preferences.sources.length>=64)throw new EngineError('LOCAL_SOURCE_LIMIT','At most 64 additional source files');this.preferences.sources=[...new Set([...this.preferences.sources,filename])];
    }else if(action==='remove_source')this.preferences.sources=this.preferences.sources.filter(s=>s!==source);
    else if(action==='exclude'){if(!this.entries.has(entryId))throw new EngineError('LOCAL_ENTRY_UNKNOWN','Discover the exact ID first');this.preferences.excluded=[...new Set([...this.preferences.excluded,entryId])];}
    else if(action==='include')this.preferences.excluded=this.preferences.excluded.filter(s=>s!==entryId);
    else if(action!=='status')throw new EngineError('LOCAL_SOURCE_ACTION','Choose status, add_source, remove_source, include or exclude');
    if(action!=='status'){const filename=path.join(this.stateDir,'local-tool-sources.json'),tmp=filename+'.new';await fs.writeFile(tmp,JSON.stringify(this.preferences),{mode:0o600});await fs.rename(tmp,filename);this.expires=0;}
    return {...this.preferences,sourceConfigurationsModified:false,credentialsCopied:false,note:'include removes only a YGPT exclusion; an entry disabled in its original Agent configuration stays disabled. Add a separate YGPT configuration source to use an independent setup.'};
  }
  async environment(e,scratch){
    const env=profileEnvironment(this.folders,{TEMP:scratch,TMP:scratch});
    if(e.accountHome){if(e.kind==='mcp'||e.adapter==='codex')env.CODEX_HOME=e.accountHome;else throw new EngineError('LOCAL_PROFILE_AMBIGUOUS','accountHome is a Codex profile. Other Agents must use their documented account environment in this source env field.');}
    for(const k of e.envVars??[]){if(typeof k!=='string'||/^YGPT_/i.test(k))continue;if(process.env[k]!==undefined)env[k]=process.env[k];else throw new EngineError('LOCAL_ENV_MISSING','Configured variable '+k+' is not available to the service');}
    for(const [k,v] of Object.entries(e.env??{})){if(/^YGPT_/i.test(k))throw new EngineError('LOCAL_ENV_RESERVED','YGPT internal environment cannot be forwarded');if(typeof v!=='string')throw new EngineError('LOCAL_ENV_INVALID','Configured environment values must be strings');env[k]=expand(v,{...process.env,...env});}
    return env;
  }
  async executable(command,env,cwd){
    const expanded=expand(command,env),candidates=path.isAbsolute(expanded)?[expanded]:expanded.includes('/')||expanded.includes('\\')?[path.resolve(cwd,expanded)]:(env.PATH??'').split(path.delimiter).filter(Boolean).flatMap(d=>[expanded,...(process.platform==='win32'?['.exe','.com','.cmd','.bat'].map(x=>expanded+x):[])].map(n=>path.join(d,n)));
    for(const p of candidates){try{const real=await fs.realpath(p);if((await fs.stat(real)).isFile())return real;}catch{}}
    throw new EngineError('LOCAL_EXECUTABLE_MISSING','The configured program is not installed or is missing from the owner PATH');
  }
}
