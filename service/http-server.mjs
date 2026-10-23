import http from 'node:http';
import {randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ReadResourceRequestSchema,ListResourceTemplatesRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {OwnerOAuth} from './oauth.mjs';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
// The gateway is the only party allowed to assert transport provenance to the
// broker: caller-supplied ygpt/* metadata is removed, then the authenticated
// MCP session is attached as an opaque digest. This is provenance for usage
// reports, not proof that the host is an ordinary chat rather than an Agent.
export function withTransport(params={},clientId,sessionId){
 const meta=Object.fromEntries(Object.entries(params._meta??{}).filter(([k])=>!k.startsWith('ygpt/')));
 meta['ygpt/transport']={kind:clientId==='secure-tunnel-transport'?'secure-tunnel-http':clientId==='local-operator'?'local-operator':'oauth-http',session:sessionId?createHash('sha256').update(String(clientId)+'\n'+sessionId).digest('hex').slice(0,16):null};
 return {...params,_meta:meta};
}
export async function startHttp({broker,port=17854,publicOrigin,ownerKey,localKey,tunnelKey,oauthState,connectionStatus=async()=>({connected:null}),redirectUris=['https://chatgpt.com/connector_platform_oauth_redirect'],onHostCall=()=>{}}){
 if(typeof localKey!=='string'||localKey.length<32||tunnelKey&&tunnelKey.length<32)throw Error('Strong independent local and tunnel keys are required');
 const oauth=new OwnerOAuth({origin:publicOrigin??'http://127.0.0.1:'+port,ownerKey,redirectUris,stateStore:oauthState}),sessions=new Map();
 let draining=false,activeCalls=0,drainCheck=null;
 const drain=()=>{
  if(drainCheck)return drainCheck;
  // Close the gateway before inventory awaits, so no new calls can race the
  // check. Concurrent maintenance callers share one result and cannot reopen
  // the gateway after another caller has been told it is safe to stop.
  draining=true;
  drainCheck=(async()=>{
   let busy=activeCalls>0,checked=true;
   const scan=value=>{if(value&&typeof value==='object'){if(['running','queued','starting','awaiting_user','pending','unknown'].includes(value.state))busy=true;for(const child of Object.values(value))scan(child);}};
   try{for(const name of ['y_process_list','y_job_list','y_pending_approvals']){
    const r=await broker.rpc('tools/call',{name,arguments:{}});if(r.isError)throw Error('Health inventory unavailable');
    const v=r.structuredContent??JSON.parse(r.content[0].text);if(v?.ok===false)throw Error('Health inventory unavailable');scan(v);
    if(Number(v?.result?.otherChatsActive??v?.otherChatsActive??0)>0||name==='y_pending_approvals'&&Number(v?.otherChats??0)>0)busy=true;
   }}catch{checked=false;}
   if(busy||!checked)draining=false;
   return {safeToStop:checked&&!busy,draining,activeCalls,reason:!checked?'Cannot confirm owned task state':busy?'Finish active tasks and approvals before maintenance':null};
  })().finally(()=>{drainCheck=null;});
  return drainCheck;
 };
 const server=http.createServer(async(req,res)=>{try{
  const host=req.headers.host,url=new URL(req.url,'http://'+host),allowed=new Set(['127.0.0.1:'+server.address().port,new URL(oauth.origin).host]);if(!allowed.has(host)){res.writeHead(403).end();return;}
  const origin=req.headers.origin;if(origin&&origin!==oauth.origin){res.writeHead(403).end();return;}
  const local=equal(req.headers.authorization,'Bearer '+localKey),tunnel=tunnelKey&&equal(req.headers.authorization,'Bearer '+tunnelKey),auth=local?{clientId:'local-operator'}:tunnel?{clientId:'secure-tunnel-transport'}:oauth.authenticate(req.headers.authorization);
  if(url.pathname==='/maintenance/drain'){
   if(!local||req.method!=='POST'){res.writeHead(403).end();return;}
   const result=await drain();res.writeHead(result.safeToStop?200:409,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
  }
  if(url.pathname==='/healthz'){if(!local){res.writeHead(401).end();return;}const tools=await broker.rpc('tools/list');const app=tools.tools.filter(t=>t._meta?.ui?.visibility?.includes('app')).length;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({product:'YGPT Local',version:'1.0.0-rc.18',localReady:!broker.exited,tools:tools.tools.length,publicTools:tools.tools.length-app,appOnly:app,connection:await connectionStatus(),hostLinked:server.hostLinked??false,lastHostRead:server.lastHostRead??null,hostCatalogVerified:server.hostCatalogVerified??false}));return;}
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024){res.writeHead(413).end();return;}}
  if(!tunnelKey&&await oauth.handle(req,res,url,body))return;
  if(url.pathname!=='/mcp'){res.writeHead(404).end();return;}
  if(!auth){res.writeHead(401,{'WWW-Authenticate':'Bearer resource_metadata="'+oauth.origin+'/.well-known/oauth-protected-resource/mcp"'}).end();return;}
  const id=req.headers['mcp-session-id'];let entry=id?sessions.get(id):null;if(entry&&entry.clientId!==auth.clientId){res.writeHead(403).end();return;}
  if(!entry){if(id||req.method!=='POST'){res.writeHead(404).end();return;}if(sessions.size>=32){res.writeHead(429).end();return;}
   const mcp=new Server({name:'YGPT Local',version:'1.0.0-rc.18'},{capabilities:{tools:{listChanged:true},resources:{}},instructions:broker.info.instructions});
   mcp.setRequestHandler(ListToolsRequestSchema,async()=>{const listed=await broker.rpc('tools/list');if(!local)server.hostCatalogVerified=true;return listed;});
   mcp.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{if(draining)return {isError:true,content:[{type:'text',text:'Service is paused for owner maintenance. No action was executed.'}]};activeCalls++;try{const r=await broker.rpc('tools/call',withTransport(request.params,auth.clientId,extra?.sessionId));if(!local){server.hostLinked=true;if(/^y_(file_read|file_list|sqlite_read|local_read_file)$/.test(request.params.name)&&!r.isError)server.lastHostRead=new Date().toISOString();onHostCall({tool:request.params.name,args:request.params.arguments??{},result:r,ok:!r.isError});}return r;}finally{activeCalls--;}});
   mcp.setRequestHandler(ListResourcesRequestSchema,()=>broker.rpc('resources/list'));mcp.setRequestHandler(ReadResourceRequestSchema,r=>broker.rpc('resources/read',r.params));mcp.setRequestHandler(ListResourceTemplatesRequestSchema,()=>broker.rpc('resources/templates/list'));
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true,onsessioninitialized:sessionId=>sessions.set(sessionId,{transport,mcp,clientId:auth.clientId})});transport.onclose=()=>{if(transport.sessionId)sessions.delete(transport.sessionId);};await mcp.connect(transport);entry={transport,mcp,clientId:auth.clientId};
  }
  await entry.transport.handleRequest(req,res,body?JSON.parse(body):undefined);
 }catch{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request failed; no automatic replay. Check sanitized local diagnostics.'}));}});
 server.requestTimeout=30000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 if(!publicOrigin){oauth.origin='http://127.0.0.1:'+server.address().port;oauth.resource=oauth.origin+'/mcp';}
 return {server,oauth,port:server.address().port,close:async()=>{for(const e of sessions.values())await e.mcp.close();await new Promise(r=>server.close(r));}};
}
