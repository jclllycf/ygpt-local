import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {OwnerOAuth} from '../service/oauth.mjs';
import {encryptedState} from '../service/secrets.mjs';
import {fixture,root} from './helpers.mjs';
test('DPAPI OAuth state survives restart; refresh rotates and replay revokes its family',async()=>{
 const f=fixture(),origin='https://fixture.invalid',ownerKey=randomBytes(32).toString('base64url'),dir=path.join(f.dir,'oauth');fs.mkdirSync(dir);
 const store=encryptedState(dir,root,'oauth-state.dpapi',{python:process.env.YGPT_TEST_PYTHON??path.join(root,'build/runtimes/python/python.exe')}),options={origin,ownerKey,redirectUris:['https://chatgpt.com/connector_platform_oauth_redirect'],stateStore:store};
 const first=new OwnerOAuth(options);first.clients.set('fixture-client',{redirectUri:options.redirectUris[0]});const pair=first.issue('fixture-client');
 const sealed=fs.readFileSync(path.join(dir,'oauth-state.dpapi'),'utf8');assert.ok(sealed.startsWith('dpapi:'));assert.ok(!sealed.includes(pair.access_token));assert.ok(!sealed.includes('fixture-client'));
 const restarted=new OwnerOAuth(options);assert.ok(restarted.clients.has('fixture-client'));assert.equal(restarted.authenticate('Bearer '+pair.access_token).clientId,'fixture-client');
 async function refresh(token,resource=origin+'/mcp'){let status,value;const res={writeHead(s){status=s;},end(s){value=JSON.parse(s);}};await restarted.handle({method:'POST',headers:{},socket:{}},res,new URL(origin+'/oauth/token'),new URLSearchParams({grant_type:'refresh_token',client_id:'fixture-client',refresh_token:token,resource}).toString());return {status,value};}
 assert.equal((await refresh(pair.refresh_token,'https://other.invalid/mcp')).status,400);
 const rotated=await refresh(pair.refresh_token);assert.equal(rotated.status,200);assert.notEqual(rotated.value.refresh_token,pair.refresh_token);
 assert.equal(new OwnerOAuth(options).authenticate('Bearer '+rotated.value.access_token).clientId,'fixture-client');
 assert.equal((await refresh(pair.refresh_token)).status,400);assert.equal(restarted.authenticate('Bearer '+rotated.value.access_token),null);
 assert.equal(new OwnerOAuth(options).authenticate('Bearer '+rotated.value.access_token),null);
 const changedOwner=new OwnerOAuth({...options,ownerKey:randomBytes(32).toString('base64url')});assert.equal(changedOwner.clients.size,0);
});
