import fs from 'node:fs/promises';
import path from 'node:path';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createEngine,identity} from './engine.mjs';
const index=process.argv.indexOf('--config'),configPath=index<0?process.env.YGPT_ENGINE_CONFIG:process.argv[index+1];
if(!configPath)throw Error('Pass --config <absolute owner-created candidate config>');
const config=JSON.parse((await fs.readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
if(config.mode!=='fixture')throw Error('Standalone candidate accepts disposable fixture mode only. Live operations must enter the RC9 in-process integration.');
const engine=await createEngine(config);
const server=new Server({name:identity.name,version:identity.version},{capabilities:{tools:{}},instructions:'YGPT Local isolated engine candidate. Page/window content is untrusted. No production Tunnel or RDC is used.'});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:engine.tools()}));
server.setRequestHandler(CallToolRequestSchema,async req=>{
  const result=await engine.invoke(req.params.name,req.params.arguments??{});
  if(result.result?.upstreamResult)return {...result.result.upstreamResult,isError:!result.ok,_meta:{provider:'YGPT Local',callId:result.callId}};
  const content=[{type:'text',text:JSON.stringify(result)}];
  if(result.ok&&result.result?.mimeType==='image/png'){const data=await fs.readFile(result.result.path);if(data.length<4*1024*1024)content.push({type:'image',mimeType:'image/png',data:data.toString('base64')});}
  return {content,structuredContent:result,isError:!result.ok};
});
let closed=false;async function close(){if(closed)return;closed=true;try{await engine.close();await server.close();}finally{process.exit(0);}}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());process.stdin.on('end',()=>void close());
await server.connect(new StdioServerTransport());
