import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {OwnerOAuth} from '../service/oauth.mjs';
// Owner approval page failure states: same status codes as before, but readable HTML for the person at the browser. No state store, so no DPAPI is needed.
test('Owner approval page explains a wrong key, a foreign or expired request and rate limiting without leaking the key',async()=>{
 const ownerKey=randomBytes(32).toString('base64url'),redirect='https://chatgpt.com/connector_platform_oauth_redirect';let oauth;
 const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;if(!await oauth.handle(req,res,new URL(req.url,'http://'+req.headers.host),body))res.writeHead(404).end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;oauth=new OwnerOAuth({origin:base,ownerKey,redirectUris:[redirect]});
 const post=(p,b,h={})=>fetch(base+p,{method:'POST',body:b,headers:h,redirect:'manual'});
 try{
  const reg=await (await post('/oauth/register',JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'none'}),{'Content-Type':'application/json'})).json();
  const q=new URLSearchParams({client_id:reg.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update('v'.repeat(48)).digest('base64url'),resource:base+'/mcp',state:'fixture'});
  const consent=await fetch(base+'/oauth/authorize?'+q),cookie=consent.headers.get('set-cookie').split(';')[0],csrf=/name="csrf" value="([^"]+)"/.exec(await consent.text())[1];
  const wrong=await post('/oauth/authorize',new URLSearchParams({csrf,ownerKey:'wrong'}),{cookie,origin:base}),wrongHtml=await wrong.text();
  assert.equal(wrong.status,403);assert.match(wrong.headers.get('content-security-policy'),/default-src 'none'/);assert.match(wrongHtml,/didn&#39;t match/);assert.equal(/name="csrf" value="([^"]+)"/.exec(wrongHtml)[1],csrf);assert.ok(!wrongHtml.includes(ownerKey));
  const foreign=await post('/oauth/authorize',new URLSearchParams({csrf,ownerKey}),{cookie,origin:'https://attacker.invalid'}),foreignHtml=await foreign.text();
  assert.equal(foreign.status,403);assert.match(foreignHtml,/Start the connection again from ChatGPT/);assert.ok(!foreignHtml.includes('name="csrf"'));
  assert.equal((await post('/oauth/authorize',new URLSearchParams({csrf,ownerKey}),{cookie,origin:base})).status,302);
  let last;for(let i=0;i<10;i++)last=await post('/oauth/authorize',new URLSearchParams({csrf:'x',ownerKey:'y'}),{origin:base});
  assert.equal(last.status,429);assert.match(await last.text(),/Too many attempts/);
 }finally{server.close();}
});
