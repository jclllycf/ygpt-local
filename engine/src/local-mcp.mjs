import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv2019 from 'ajv/dist/2019.js';
import {EngineError} from './file-engine.mjs';
import {expand} from './local-catalog.mjs';
import {terminateProcessTree} from '../vendor/desktop-commander/process-tree.js';

// Pinned SDK 1.32.1 keeps the spawned ChildProcess in _process. Preserve its
// identity/exit events so Windows cleanup can end its tree before SDK close
// kills only a command-shim parent and loses the descendant relationship.
class ManagedStdioTransport extends StdioClientTransport {
  async close(){
    const child=this._process;this.treeClosed=true;
    if(child&&child.exitCode===null&&child.signalCode===null){
      child.stdin?.end();await Promise.race([new Promise(r=>child.once('close',r)),new Promise(r=>setTimeout(r,500))]);
      if(child.exitCode===null&&child.signalCode===null)this.treeClosed=await terminateProcessTree(child);
    }
    await super.close();
  }
}

const hash=x=>createHash('sha256').update(x).digest('hex').slice(0,24);
export async function toolScratch(catalog,owner){
  await catalog.refresh();const root=path.join(catalog.folders.local,'YGPT Local','ToolScratch'),dir=path.join(root,hash(owner)+'-'+randomUUID());
  await fs.mkdir(dir,{recursive:true});return {root,dir};
}
export async function removeScratch(scratch){
  if(!scratch)return;const rel=path.relative(scratch.root,scratch.dir);
  if(!/^[a-f0-9]{24}-[a-f0-9-]{36}$/.test(rel)||path.dirname(scratch.dir)!==scratch.root)throw new EngineError('SCRATCH_SCOPE_INVALID','Invalid tool scratch path');
  // fs.rm unlinks reparse points instead of traversing their targets.
  await fs.rm(scratch.dir,{recursive:true,force:true,maxRetries:2}).catch(()=>{});
}
export class LocalMcp {
  constructor({catalog,currentOwner,connect,idleMs=300000}){Object.assign(this,{catalog,owner:currentOwner,connect,idleMs});this.sessions=new Map();const options={strict:false,allErrors:true,validateFormats:false};this.validators={legacy:new Ajv(options),'2020':new Ajv2020(options),'2019':new Ajv2019(options)};this.closing=false;}
  async spec(id){const e=await this.catalog.get(id,'mcp');if(/ygptlocal\.exe|(?:runtime[\\/]enhanced-server|service[\\/]supervisor)\.mjs/i.test([e.command,...e.args].join(' '))||/^ygpt(?:[- _]local)?$/i.test(e.name))throw new EngineError('MCP_RECURSION','YGPT cannot route back into itself');return e;}
  async session(id){
    if(this.closing)throw new EngineError('ENGINE_CLOSED','Local MCP client is closing');const owner=this.owner();if(!owner)throw new EngineError('CONTEXT_REQUIRED','Use this chat context');
    const spec=await this.spec(id),key=owner+':'+id;let entry=this.sessions.get(key);
    if(entry&&entry.fingerprint!==spec.fingerprint){if(entry.active)throw new EngineError('MCP_CONFIG_CHANGED','Configuration changed during an active call; wait for it to finish');await this.dispose(key,entry);entry=null;}
    if(!entry){
      if(this.sessions.size>=16||[...this.sessions.values()].filter(e=>e.owner===owner).length>=4)throw new EngineError('CONCURRENCY_LIMIT','Local MCP client capacity reached; close an unused server first. Nothing was started.');
      entry={owner,id,fingerprint:spec.fingerprint,enabledTools:spec.enabledTools,disabledTools:spec.disabledTools??[],active:0,tools:null,tail:Promise.resolve(),state:'connecting'};this.sessions.set(key,entry);
      entry.ready=(async()=>{
        entry.scratch=await toolScratch(this.catalog,owner);const env=await this.catalog.environment(spec,entry.scratch.dir);
        let transport;
        if(this.connect){entry.client=await this.connect(spec,env);}
        else{
          if(spec.transport==='stdio'){
            const command=await this.catalog.executable(spec.command,env,spec.cwd),args=spec.args.map(a=>expand(a,env));
            transport=new ManagedStdioTransport({command,args,cwd:spec.cwd,env,stderr:'pipe',maxBufferSize:8*1024*1024});transport.stderr?.on('data',()=>{});
          }else{
            const url=new URL(expand(spec.url,env));if(url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new EngineError('MCP_URL_INVALID','Configured MCP endpoints must use HTTPS or local loopback HTTP, without URL credentials');
            const headers={};for(const [k,v] of Object.entries(spec.headers))headers[k]=expand(v,{...process.env,...env});
            for(const [k,v] of Object.entries(spec.envHeaders)){if(!process.env[v])throw new EngineError('LOCAL_ENV_MISSING','A configured HTTP credential is unavailable');headers[k]=process.env[v];}
            if(spec.bearerEnv){if(!process.env[spec.bearerEnv])throw new EngineError('LOCAL_ENV_MISSING','The configured bearer environment variable is unavailable');headers.Authorization='Bearer '+process.env[spec.bearerEnv];}
            const fetch=async(input,init={})=>{const target=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(target.origin!==url.origin)throw new EngineError('MCP_ORIGIN_CHANGED','MCP transport attempted to change origin');return globalThis.fetch(input,{...init,redirect:'error'});};
            transport=spec.transport==='sse'?new SSEClientTransport(url,{requestInit:{headers},fetch}):new StreamableHTTPClientTransport(url,{requestInit:{headers},fetch,reconnectionOptions:{maxRetries:0}});
          }
          entry.transport=transport;entry.client=new Client({name:'YGPT Local tool router',version:'1.0.18'},{capabilities:{}});
          await entry.client.connect(transport,{timeout:20000});
        }
        if(entry.client.getServerVersion?.()?.name==='YGPT Local')throw new EngineError('MCP_RECURSION','The configured endpoint routes back to YGPT Local');
        entry.state='connected';this.touch(key,entry);return entry;
      })().catch(async error=>{await this.dispose(key,entry);throw new EngineError(error.code??'MCP_CONNECT_FAILED','Local MCP connection failed ('+(error.code??error.name??'error')+'). Check the named source configuration and server installation; no tool call was sent.');});
    }
    await entry.ready;this.touch(key,entry);return entry;
  }
  touch(key,e){clearTimeout(e.timer);e.timer=setTimeout(()=>{if(e.active)this.touch(key,e);else void this.dispose(key,e);},this.idleMs);e.timer.unref?.();}
  async dispose(key,e){if(this.sessions.get(key)===e)this.sessions.delete(key);clearTimeout(e.timer);await e.client?.close().catch(()=>{});e.cleanupDeferred=e.transport?.treeClosed===false;if(!e.cleanupDeferred)await removeScratch(e.scratch);e.state=e.cleanupDeferred?'cleanup_deferred':'closed';}
  async pages(e,method,field){
    const result=[],seen=new Set();let cursor;
    for(let i=0;i<32;i++){
      const page=await e.client[method](cursor?{cursor}:{},{timeout:15000});if(!Array.isArray(page[field]))throw new EngineError('MCP_CATALOG_INVALID','The server returned an invalid capability catalog');
      for(const item of page[field]){if(result.length>=2048)throw new EngineError('MCP_CATALOG_LIMIT','The server catalog exceeds 2048 entries; configure a smaller source');result.push(item);}
      cursor=page.nextCursor;if(!cursor)return result;if(seen.has(cursor))throw new EngineError('MCP_CURSOR_REPEATED','The server returned a repeated pagination cursor');seen.add(cursor);
    }
    throw new EngineError('MCP_CATALOG_LIMIT','Too many catalog pages');
  }
  async tools(e){if(!e.tools){const tools=await this.pages(e,'listTools','tools'),map=new Map(),seen=new Set();for(const t of tools){if(typeof t.name!=='string'||seen.has(t.name)||Buffer.byteLength(JSON.stringify(t))>1048576)throw new EngineError('MCP_CATALOG_INVALID','Duplicate, oversized or invalid tool descriptor');seen.add(t.name);if((e.enabledTools===undefined||e.enabledTools.includes(t.name))&&!e.disabledTools.includes(t.name))map.set(t.name,t);}e.tools=map;}return e.tools;}
  async review(a){
    const spec=await this.spec(a.serverId);const e=this.sessions.get(this.owner()+':'+a.serverId),t=e?.tools?.get(a.name);
    if(a.action==='call'&&!t)throw new EngineError('MCP_SCHEMA_REQUIRED','First request action=tools for this exact server in this chat; inspect its tool schema before invoking it');
    const files=[];if(spec.transport==='stdio'){
      const env=await this.catalog.environment(spec,path.join(this.catalog.folders.local,'YGPT Local','ToolScratch')),command=await this.catalog.executable(spec.command,env,spec.cwd);
      for(const filename of [command,...spec.args.map(a=>expand(a,env)).filter(a=>/\.(?:mjs|cjs|js|py|ps1|cmd|bat)$/i.test(a)).map(a=>path.resolve(spec.cwd,a))]){try{files.push({path:filename,digest:hash(await fs.readFile(filename))});}catch{throw new EngineError('MCP_PROGRAM_UNAVAILABLE','A configured MCP executable or script is missing');}}
    }
    return {riskText:JSON.stringify({name:spec.name,command:spec.command,args:spec.args,tool:a.name,arguments:a.arguments}),destructive:a.action==='call'&&t?.annotations?.destructiveHint===true,binding:{id:spec.id,fingerprint:spec.fingerprint,tool:t?hash(JSON.stringify(t)):null,files}};
  }
  async run({action='tools',serverId,name,arguments:args={},uri,query='',offset=0,limit=40,includeSchema=false,timeoutMs=60000}={}){
    if(action==='status')return {connections:[...this.sessions.values()].filter(e=>e.owner===this.owner()).map(e=>({serverId:e.id,state:e.state,active:e.active})),otherChats:[...this.sessions.values()].filter(e=>e.owner!==this.owner()).length};
    if(action==='close'){const key=this.owner()+':'+serverId,e=this.sessions.get(key);if(e?.active)throw new EngineError('MCP_BUSY','A tool is still running; wait before closing its server');if(e)await this.dispose(key,e);return {closed:!e?.cleanupDeferred,cleanupDeferred:e?.cleanupDeferred??false,serverId};}
    const e=await this.session(serverId);if(e.active>=8)throw new EngineError('CONCURRENCY_LIMIT','Eight operations are already queued for this chat/server; wait for one to complete. Nothing was sent.');e.active++;
    // Serialize each stateful server within a chat; distinct chats/servers run concurrently.
    const run=e.tail.catch(()=>{}).then(async()=>{
      if(action==='tools'){const all=[...(await this.tools(e)).values()].filter(t=>name?t.name===name:(t.name+' '+(t.description??'')).toLowerCase().includes(query.toLowerCase()));return this.bounded({serverId,tools:all.slice(offset,offset+limit).map(t=>({name:t.name,description:(t.description??'').slice(0,name?4000:1200),...(includeSchema||name?{inputSchema:t.inputSchema}:{parameters:Object.keys(t.inputSchema?.properties??{}),required:t.inputSchema?.required??[],inputSchemaOmitted:true}),annotations:t.annotations})),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,nextAction:name?null:'Request action=tools with the exact name to read its full input schema before calling it'});}
      if(action==='resources'||action==='prompts'){const field=action==='resources'?'resources':'prompts',all=await this.pages(e,action==='resources'?'listResources':'listPrompts',field);return {serverId,[field]:all.slice(offset,offset+limit),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null};}
      if(action==='read'){const response=await e.client.readResource({uri},{timeout:timeoutMs});return this.bounded({serverId,result:response});}
      if(action==='prompt'){const response=await e.client.getPrompt({name,arguments:args},{timeout:timeoutMs});return this.bounded({serverId,result:response});}
      if(action!=='call')throw new EngineError('MCP_ACTION_INVALID','Choose tools, call, resources, read, prompts, prompt, status or close');
      const tool=(await this.tools(e)).get(name);if(!tool)throw new EngineError('MCP_TOOL_UNKNOWN','Use the exact name returned by this server tools catalog');
      const schema=tool.inputSchema,validator=this.validators[/draft-0[467]/.test(schema?.$schema??'')?'legacy':/2019-09/.test(schema?.$schema??'')?'2019':'2020'];
      let valid;try{valid=schema&&validator.validate(schema,args);}catch{throw new EngineError('MCP_SCHEMA_UNSUPPORTED','The selected server input schema could not be compiled; no tool was called');}
      if(!valid)throw new EngineError('MCP_ARGUMENTS_INVALID','Arguments do not match the selected tool input schema');
      let response;try{response=await e.client.callTool({name,arguments:args},undefined,{timeout:timeoutMs,maxTotalTimeout:timeoutMs});}
      catch{throw Object.assign(new EngineError('MCP_OUTCOME_UNKNOWN','The tool call was interrupted and may have taken effect. Inspect its existing state; do not replay the call.'),{effectStarted:true,outcomeUnknown:true});}
      return this.bounded({serverId,tool:name,ok:response.isError!==true,result:{content:response.content,structuredContent:response.structuredContent,isError:response.isError===true}});
    });e.tail=run;try{return await run;}finally{e.active--;this.touch(this.owner()+':'+serverId,e);}
  }
  bounded(value){if(Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw Object.assign(new EngineError('MCP_RESULT_TOO_LARGE','The server result exceeded 8 MiB; the operation was not replayed. Inspect existing state or request a bounded result.'),{effectStarted:true,outcomeUnknown:true});return {...value,transientObservation:true};}
  async closeContext(owner){for(const [key,e] of this.sessions)if(e.owner===owner){await e.ready.catch(()=>{});await this.dispose(key,e);}}
  async close(){this.closing=true;for(const [key,e] of [...this.sessions]){await e.ready.catch(()=>{});await this.dispose(key,e);}}
}
