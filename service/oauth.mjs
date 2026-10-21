import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const random=()=>randomBytes(32).toString('base64url'),hash=s=>createHash('sha256').update(String(s)).digest('base64url');
const equal=(a,b)=>{const x=Buffer.from(hash(a)),y=Buffer.from(hash(b));return timingSafeEqual(x,y);};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class OwnerOAuth{
 constructor({origin,ownerKey,redirectUris,stateStore}){const u=new URL(origin);if(u.protocol!=='https:'&&u.hostname!=='127.0.0.1')throw Error('Remote OAuth requires HTTPS');if(typeof ownerKey!=='string'||ownerKey.length<32)throw Error('A strong owner pairing key is required');this.origin=u.origin;this.resource=u.origin+'/mcp';this.ownerKey=ownerKey;this.redirects=new Set(redirectUris);this.clients=new Map();this.flows=new Map();this.codes=new Map();this.tokens=new Map();this.refresh=new Map();this.attempts=new Map();this.stateStore=stateStore;
  const s=stateStore?.load();if(s&&s.version===1&&s.origin===this.origin&&s.ownerBinding===hash(ownerKey)){this.clients=new Map(s.clients);this.tokens=new Map(s.tokens);this.refresh=new Map(s.refresh);this.prune();}
 }
 persist(){this.stateStore?.save({version:1,origin:this.origin,ownerBinding:hash(this.ownerKey),clients:[...this.clients],tokens:[...this.tokens],refresh:[...this.refresh]});}
 prune(){const now=Date.now();for(const table of [this.flows,this.codes,this.tokens,this.refresh])for(const [k,v] of table)if(v.expires<now)table.delete(k);for(const [k,v] of this.attempts)if(v.expires<now)this.attempts.delete(k);}
 issue(clientId,family=random()){const access=random(),refresh=random();this.tokens.set(hash(access),{clientId,family,expires:Date.now()+3600000});this.refresh.set(hash(refresh),{clientId,family,used:false,expires:Date.now()+30*86400000});this.persist();return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'local:owner'};}
 revokeFamily(family){for(const table of [this.tokens,this.refresh])for(const [k,v] of table)if(v.family===family)table.delete(k);this.persist();}
 metadata(){return {issuer:this.origin,authorization_endpoint:this.origin+'/oauth/authorize',token_endpoint:this.origin+'/oauth/token',registration_endpoint:this.origin+'/oauth/register',revocation_endpoint:this.origin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],authorization_response_iss_parameter_supported:true,scopes_supported:['local:owner']};}
 resourceMetadata(){return {resource:this.resource,authorization_servers:[this.origin],scopes_supported:['local:owner'],bearer_methods_supported:['header']};}
 authenticate(header){this.prune();const value=/^Bearer ([A-Za-z0-9_-]+)$/.exec(header??'')?.[1],t=value?this.tokens.get(hash(value)):null;return t&&t.expires>Date.now()?{clientId:t.clientId,owner:true,resource:this.resource}:null;}
 async handle(req,res,url,body){this.prune();const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname.startsWith('/.well-known/oauth-protected-resource')){json(200,this.resourceMetadata());return true;}
  if(url.pathname==='/.well-known/oauth-authorization-server'){json(200,this.metadata());return true;}
  if(url.pathname==='/oauth/register'&&req.method==='POST'){
   if(this.clients.size>=100){json(429,{error:'registration_limit'});return true;}const v=JSON.parse(body);if(!Array.isArray(v.redirect_uris)||v.redirect_uris.length!==1||!this.redirects.has(v.redirect_uris[0])||v.token_endpoint_auth_method&&v.token_endpoint_auth_method!=='none'){json(400,{error:'invalid_client_metadata'});return true;}
   const id=random();this.clients.set(id,{redirectUri:v.redirect_uris[0]});this.persist();json(201,{client_id:id,redirect_uris:v.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});return true;
  }
  if(url.pathname==='/oauth/authorize'&&req.method==='GET'){
   const q=url.searchParams,client=this.clients.get(q.get('client_id'));if(!client||client.redirectUri!==q.get('redirect_uri')||q.get('response_type')!=='code'||q.get('code_challenge_method')!=='S256'||! /^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge')??'')||q.get('resource')!==this.resource||this.flows.size>=100){json(400,{error:'invalid_request'});return true;}
   const id=random(),csrf=random();this.flows.set(hash(id),{clientId:q.get('client_id'),redirectUri:client.redirectUri,challenge:q.get('code_challenge'),state:q.get('state')??'',csrf,expires:Date.now()+5*60*1000});
   const secure=this.origin.startsWith('https:')?'; Secure':'';res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Set-Cookie':'ygpt_oauth='+id+'; HttpOnly; SameSite=Strict; Path=/oauth'+secure});
   res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Connect YGPT Local</title><style>body{font:16px Segoe UI;background:#f5f7f8;color:#172e35;margin:60px auto;max-width:480px;padding:24px}main{background:white;padding:32px;border:1px solid #d8e2e4;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:14px;font:inherit}button{background:#176954;color:white;border:0;border-radius:8px}</style><main><h1>Connect your PC</h1><p>This grants this MCP client access to your local tools under your YGPT Local policy. Only connect a client you trust.</p><p>Copy the owner pairing key from the YGPT Local Windows setup window. Never share it in chat.</p><form method="post"><input type="hidden" name="csrf" value="'+escape(csrf)+'"><label>Owner pairing key<input name="ownerKey" type="password" required autocomplete="off"></label><button>Approve this connection</button></form></main></html>');return true;
  }
  if(url.pathname==='/oauth/authorize'&&req.method==='POST'){
   const cookie=/\bygpt_oauth=([A-Za-z0-9_-]+)/.exec(req.headers.cookie??'')?.[1],key=hash(cookie??''),flow=this.flows.get(key),v=new URLSearchParams(body),ip=req.socket.remoteAddress??'unknown',attempt=this.attempts.get(ip)??{count:0,expires:Date.now()+60000};this.attempts.set(ip,attempt);attempt.count++;
   if(attempt.count>10){json(429,{error:'too_many_attempts'});return true;}
   if(!flow||!equal(v.get('csrf'),flow.csrf)||!equal(v.get('ownerKey'),this.ownerKey)||req.headers.origin!==this.origin){json(403,{error:'owner_consent_required'});return true;}
   this.flows.delete(key);const code=random();this.codes.set(hash(code),{...flow,expires:Date.now()+60000});const redirect=new URL(flow.redirectUri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',flow.state);redirect.searchParams.set('iss',this.origin);res.writeHead(302,{Location:redirect.href,'Cache-Control':'no-store','Set-Cookie':'ygpt_oauth=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/oauth'});res.end();return true;
  }
  if(url.pathname==='/oauth/token'&&req.method==='POST'){
   const v=new URLSearchParams(body),key=hash(v.get('code')??''),code=this.codes.get(key),verifier=v.get('code_verifier')??'';
   if(v.get('grant_type')==='refresh_token'){
    const r=this.refresh.get(hash(v.get('refresh_token')??''));if(!r||r.clientId!==v.get('client_id')||v.get('resource')!==this.resource){json(400,{error:'invalid_grant'});return true;}
    if(r.used){this.revokeFamily(r.family);json(400,{error:'invalid_grant'});return true;}r.used=true;json(200,this.issue(r.clientId,r.family));return true;
   }
   if(v.get('grant_type')!=='authorization_code'||!code||code.clientId!==v.get('client_id')||code.redirectUri!==v.get('redirect_uri')||v.get('resource')!==this.resource||! /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||!equal(hash(verifier),code.challenge)){json(400,{error:'invalid_grant'});return true;}
   this.codes.delete(key);json(200,this.issue(code.clientId));return true;
  }
  if(url.pathname==='/oauth/revoke'&&req.method==='POST'){const v=new URLSearchParams(body),key=hash(v.get('token')??''),t=this.tokens.get(key)??this.refresh.get(key);if(t)this.revokeFamily(t.family);json(200,{});return true;}
  return false;
 }
}
