import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {startConnectionHost} from '../service/connection-host.mjs';
import {ConnectionRouter} from '../service/connection-router.mjs';
import {readConnectionProfiles,connectionRoot} from '../service/connections.mjs';
import {fixture,unpack,until} from './helpers.mjs';

const second='a'.repeat(32),third='b'.repeat(32),key='fixture-key-'+ 'k'.repeat(40);
const metadata=id=>({'ygpt/connection-id':id});
function request(pipe,connectionId,message,{secret=key}={}){
 return new Promise((resolve,reject)=>{const socket=net.connect(pipe);let body='';socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify({key:secret,connectionId,request:message})+'\n'));socket.on('data',b=>{body+=b;if(body.includes('\n')){socket.end();resolve(JSON.parse(body.split('\n')[0]));}});});
}
test('Connection configuration preserves the legacy default and refuses duplicate tunnels and linked paths',()=>{
 const f=fixture(),data=path.join(f.dir,'profiles');fs.mkdirSync(data);const primary={mode:'secure-tunnel',tunnelId:'tunnel_'+'1'.repeat(32)};fs.writeFileSync(path.join(data,'connection.json'),JSON.stringify(primary));
 assert.equal(readConnectionProfiles(data)[0].id,'primary');assert.equal(connectionRoot(data,'primary'),data);assert.throws(()=>connectionRoot(data,'../escape'));
 const document={product:'YGPT Local',connections:[{id:second,label:'Second account',mode:'secure-tunnel',enabled:true,tunnelId:'tunnel_'+'2'.repeat(32)}]};fs.writeFileSync(path.join(data,'connections.json'),JSON.stringify(document));assert.equal(readConnectionProfiles(data).length,2);
 document.connections[0].tunnelId=primary.tunnelId;fs.writeFileSync(path.join(data,'connections.json'),JSON.stringify(document));assert.throws(()=>readConnectionProfiles(data),/distinct/);
});
test('Authenticated connection router isolates overlapping JSON-RPC IDs and replaces forged account metadata',async()=>{
 const pipe='\\\\.\\pipe\\YGPT-connections-fixture-'+randomBytes(10).toString('hex'),seen=[];
 const profiles=new Map([['primary',{id:'primary',enabled:true,bridgeKey:key}],[second,{id:second,enabled:true,bridgeKey:key}]]);
 const broker={rpc:async(method,params)=>{seen.push({method,params});await new Promise(r=>setTimeout(r,method==='tools/list'?20:1));return {connection:params._meta['ygpt/connection-id']};}};
 const router=await new ConnectionRouter({pipe,broker,profile:id=>profiles.get(id)}).start();
 try{
  const [a,b]=await Promise.all([request(pipe,'primary',{jsonrpc:'2.0',id:1,method:'tools/list'}),request(pipe,second,{jsonrpc:'2.0',id:1,method:'ping',params:{_meta:metadata('primary')}})]);
  assert.equal(a.result.connection,'primary');assert.equal(b.result.connection,second);assert.equal(a.id,b.id);
  const count=seen.length;assert.ok((await request(pipe,second,{jsonrpc:'2.0',id:2,method:'tools/call'},{secret:'wrong'})).error);assert.equal(seen.length,count);
  assert.ok((await request(pipe,second,{jsonrpc:'2.0',id:3,method:'ygpt/idle'})).error);assert.equal(seen.length,count);
  profiles.get(second).enabled=false;assert.ok((await request(pipe,second,{jsonrpc:'2.0',id:4,method:'tools/list'})).error);assert.equal(seen.length,count);
 }finally{await router.close();}
});
test('Two accounts share one actual broker while contexts, Full Access, approvals and result tokens stay isolated',async()=>{
 const f=fixture(),c=f.client();c.trustConnectionMeta=true;await c.start();
 const call=(account,name,args={})=>c.rpc('tools/call',{name,arguments:args,_meta:metadata(account)});
 try{
  const file=path.join(f.project,'read.txt');fs.writeFileSync(file,'CONNECTION_FIXTURE');
  const primary=unpack(await call('primary','y_chat_access',{action:'status',label:'Primary fixture'}));
  const secondary=unpack(await call(second,'y_chat_access',{action:'status',label:'Second fixture'}));
  const a=primary.ygptContext?.contextToken??primary.contextToken,b=secondary.ygptContext?.contextToken??secondary.contextToken;
  // Context capabilities are returned in the regular structured envelope.
  const tokens=r=>r.structuredContent?.ygptContext?.contextToken??r._meta?.ygptContext?.contextToken;
  const sa=await call('primary','y_browser_tabs',{}),sb=await call(second,'y_browser_tabs',{});
  const ta=tokens(sa)??a,tb=tokens(sb)??b;assert.ok(ta);assert.ok(tb);assert.notEqual(ta,tb);
  const foreign=unpack(await call(second,'y_chat_access',{action:'status',contextToken:ta}));assert.equal(foreign.code,'CONNECTION_FOREIGN');
  const grant=unpack(await call(second,'y_chat_access',{action:'request_full',contextToken:tb,durationMinutes:5}));assert.ok(grant.requestId);
  assert.equal(unpack(await call('primary','y_call_status',{id:grant.requestId})).code,'CONNECTION_FOREIGN');
  assert.equal(unpack(await call('primary','y_show_approval',{requestId:grant.requestId,resultToken:grant.resultToken,contextToken:ta})).code,'CONNECTION_FOREIGN');
  const card=await call(second,'y_show_approval',{requestId:grant.requestId,resultToken:grant.resultToken,contextToken:tb});assert.ok(card._meta.yBar.uiToken);
  assert.equal(unpack(await call('primary','y_bar_decide',{requestId:grant.requestId,uiToken:card._meta.yBar.uiToken,decision:'once'})).code,'CONNECTION_FOREIGN');
  await call(second,'y_bar_decide',{requestId:grant.requestId,uiToken:card._meta.yBar.uiToken,decision:'once'});
  await until(async()=>unpack(await call(second,'y_call_status',{id:grant.requestId})).state==='succeeded');
  assert.equal(unpack(await call(second,'y_chat_access',{action:'status',contextToken:tb})).mode,'full');assert.equal(unpack(await call('primary','y_chat_access',{action:'status',contextToken:ta})).mode,'standard');
  const reads=await Promise.all(Array.from({length:24},(_,i)=>call(i%2?second:'primary','y_file_read',{path:file,contextToken:i%2?tb:ta})));
  assert.ok(reads.every(r=>!r.isError));const result=reads[1].structuredContent.ygpt;
  assert.equal(unpack(await call('primary','y_call_result',{id:result.callId,resultToken:result.resultToken})).code,'CONNECTION_FOREIGN');
  assert.ok(! (await call(second,'y_call_result',{id:result.callId,resultToken:result.resultToken})).isError);
  const recentA=unpack(await call('primary','y_recent_calls')).calls,recentB=unpack(await call(second,'y_recent_calls')).calls;
  assert.ok(recentB.every(row=>!recentA.some(other=>other.id===row.id)));
  await call(second,'y_chat_access',{action:'revoke',contextToken:tb});
 }finally{await c.close();}
});

test('Connection lifecycle contains a failing account and defers reconfiguration without restarting the shared broker',async()=>{
 const f=fixture(),data=path.join(f.dir,'connections-lifecycle');fs.mkdirSync(data);fs.mkdirSync(path.join(data,'connections',second),{recursive:true});
 fs.writeFileSync(path.join(data,'credentials.dpapi'),'FIXTURE-SEALED-PRIMARY');fs.writeFileSync(path.join(data,'connections',second,'credentials.dpapi'),'FIXTURE-SEALED-SECOND');
 const profiles=[{id:'primary',label:'Default',mode:'secure-tunnel',enabled:true,tunnelId:'tunnel_'+'1'.repeat(32)},{id:second,label:'Second',mode:'secure-tunnel',enabled:true,tunnelId:'tunnel_'+'2'.repeat(32)}];
 const children=[];let idle=true,brokerCloses=0;
 const broker={child:new EventEmitter(),rpc:async method=>{assert.equal(method,'ygpt/idle');return {safeToStop:idle};},close:async()=>{brokerCloses++;}};
 const host=await startConnectionHost({install:f.dir,data,pipe:'\\\\.\\pipe\\YGPT-host-fixture-'+randomBytes(10).toString('hex'),broker,readProfiles:()=>profiles,readSecrets:root=>({runtimeKey:root===data?'FIXTURE_PRIMARY_KEY':'FIXTURE_SECOND_KEY',bridgeKey:key}),checkTunnel:()=>({processInventoryAvailable:true,conflict:false}),probeReady:e=>!!e.child,intervalMs:600000,spawnTunnel:(executable,args,opts)=>{
  assert.ok(args.includes('env:YGPT_TUNNEL_RUNTIME_KEY'));assert.ok(!args.join(' ').includes('FIXTURE_'));assert.equal(opts.windowsHide,true);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.kill=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));return true;};children.push(child);return child;
 }});
 try{
  assert.equal(children.length,2);const first=host.entries.get('primary').child,secondChild=host.entries.get(second).child;
  secondChild.stderr.write('invalid_api_key 401 FIXTURE_SECRET_NEVER_LOGGED');secondChild.kill();await new Promise(r=>setImmediate(r));await host.tick();
  assert.equal(host.entries.get('primary').child,first);assert.equal(host.entries.get(second).blocked,true);assert.equal(children.length,2);
  assert.ok(!fs.readFileSync(path.join(data,'connections-health.json'),'utf8').includes('FIXTURE_SECRET'));
  fs.appendFileSync(path.join(data,'connections',second,'credentials.dpapi'),'ROTATED');await host.tick();assert.equal(children.length,3);assert.equal(host.entries.get('primary').child,first);
  idle=false;profiles[1]={...profiles[1],enabled:false};await host.tick();assert.equal(host.entries.get(second).changePending,true);assert.ok(host.entries.get(second).child);
  idle=true;await host.tick();assert.equal(host.entries.get(second).child,undefined);assert.equal(host.entries.get(second).enabled,false);assert.equal(host.entries.get('primary').child,first);assert.equal(brokerCloses,0);
 }finally{await host.close();assert.equal(brokerCloses,1);}
});
