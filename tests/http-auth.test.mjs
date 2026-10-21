import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startHttp} from '../service/http-server.mjs';
import {fixture} from './helpers.mjs';
test('Real authenticated HTTP: OAuth PKCE, consent, catalog, tool call and revocation',async()=>{
 const f=fixture(),broker=await f.client().start(),ownerKey=randomBytes(32).toString('base64url'),localKey=randomBytes(32).toString('base64url'),redirect='https://chatgpt.com/connector_platform_oauth_redirect';
 const gateway=await startHttp({broker,port:0,ownerKey,localKey,redirectUris:[redirect]}),base='http://127.0.0.1:'+gateway.port;let client;
 const post=(p,b,headers={})=>fetch(base+p,{method:'POST',body:b,headers,redirect:'manual'});
 try{
  const unauth=await fetch(base+'/mcp');assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate'),/resource_metadata/);
  assert.equal((await fetch(base+'/mcp?access_token='+localKey)).status,401);
  assert.equal(await new Promise((resolve,reject)=>{const r=http.get(base+'/mcp',{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);}),403);
  assert.equal((await post('/oauth/register',JSON.stringify({redirect_uris:['https://attacker.invalid/callback']}),{'Content-Type':'application/json'})).status,400);
  const reg=await (await post('/oauth/register',JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'none'}),{'Content-Type':'application/json'})).json();
  const verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),q=new URLSearchParams({client_id:reg.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:challenge,resource:base+'/mcp',state:'fixture'});
  const consent=await fetch(base+'/oauth/authorize?'+q),cookie=consent.headers.get('set-cookie').split(';')[0],html=await consent.text(),csrf=/name="csrf" value="([^"]+)"/.exec(html)[1];assert.match(html,/Approve this connection/);assert.ok(!html.includes(ownerKey));
  const denied=await post('/oauth/authorize',new URLSearchParams({csrf,ownerKey:'wrong'}),{cookie,origin:base});assert.equal(denied.status,403);
  const allowed=await post('/oauth/authorize',new URLSearchParams({csrf,ownerKey}),{cookie,origin:base});assert.equal(allowed.status,302);const code=new URL(allowed.headers.get('location')).searchParams.get('code');
  const params={grant_type:'authorization_code',client_id:reg.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:base+'/mcp'};
  assert.equal((await post('/oauth/token',new URLSearchParams({...params,resource:'https://attacker.invalid/mcp'}))).status,400);
  const token=await (await post('/oauth/token',new URLSearchParams(params))).json();assert.ok(token.access_token);assert.ok(token.refresh_token);assert.equal((await post('/oauth/token',new URLSearchParams(params))).status,400);
  client=new Client({name:'isolated-http-fixture-not-ChatGPT',version:'1'},{capabilities:{}});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
  const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='y_sqlite_read'));const read=await client.callTool({name:'y_file_list',arguments:{path:f.project}});assert.equal(read.isError,false);
  const health=await (await fetch(base+'/healthz',{headers:{Authorization:'Bearer '+localKey}})).json();assert.equal(health.hostLinked,true);assert.ok(health.lastHostRead);assert.equal(health.appOnly,2);
  const started=await client.callTool({name:'y_process_start',arguments:{executable:process.execPath,args:['-e','setTimeout(()=>{},20000)'],cwd:f.project}}),owned=started.structuredContent??JSON.parse(started.content[0].text);assert.equal(owned.ok,true,JSON.stringify(owned));
  assert.equal((await post('/maintenance/drain','',{Authorization:'Bearer '+localKey})).status,409);
  const stopped=await client.callTool({name:'y_process_cancel',arguments:{sessionId:owned.result.sessionId,outputToken:owned.result.outputToken??owned.outputToken}});assert.equal(stopped.isError,false,JSON.stringify(stopped));
  const drained=await post('/maintenance/drain','',{Authorization:'Bearer '+localKey});assert.equal(drained.status,200,await drained.clone().text());assert.equal((await drained.json()).safeToStop,true);
  const blocked=await client.callTool({name:'y_file_list',arguments:{path:f.project}});assert.equal(blocked.isError,true);assert.match(blocked.content[0].text,/maintenance/);
  await post('/oauth/revoke',new URLSearchParams({token:token.access_token}));assert.equal((await fetch(base+'/mcp',{headers:{Authorization:'Bearer '+token.access_token}})).status,401);
 }finally{await client?.close().catch(()=>{});await gateway.close();await broker.close();}
});
test('Twelve concurrent real MCP HTTP handshakes share one ready broker',async()=>{
 const f=fixture(),broker=await f.client().start(),localKey=randomBytes(32).toString('base64url'),gateway=await startHttp({broker,port:0,ownerKey:randomBytes(32).toString('base64url'),localKey}),clients=[];
 try{await Promise.all(Array.from({length:12},async(_,i)=>{const c=new Client({name:'isolated-concurrent-'+i,version:'1'},{capabilities:{}});clients.push(c);await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+gateway.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+localKey}}}));const r=await c.callTool({name:'y_service_health',arguments:{}});assert.ok(!r.isError);const h=r.structuredContent??JSON.parse(r.content[0].text);assert.equal(h.engineReady,true);}));}finally{await Promise.allSettled(clients.map(c=>c.close()));await gateway.close();await broker.close();}
});
