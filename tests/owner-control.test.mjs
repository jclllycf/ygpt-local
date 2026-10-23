import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {startOwnerControl} from '../runtime/owner-control.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture,unpack} from './helpers.mjs';
import {validateFirstUseProof} from '../service/first-use.mjs';
test('Owner pipe authenticates, exposes no tool execution and drains at most once per message',async()=>{
 const key=randomBytes(32).toString('hex'),pipe='\\\\.\\pipe\\YGPT-test-'+randomBytes(12).toString('hex');let drained=0;
 const server=startOwnerControl({pipe,key,status:()=>({localReady:true}),drain:()=>({safeToStop:++drained===1})});await once(server,'listening');
 const request=q=>new Promise((resolve,reject)=>{const c=net.connect(pipe);let s='';c.on('connect',()=>c.write(JSON.stringify(q)+'\n'));c.on('data',b=>s+=b);c.on('error',reject);c.on('end',()=>resolve(JSON.parse(s)));});
 try{assert.equal((await request({key:'wrong',action:'drain'})).code,'UNAUTHORIZED');assert.equal(drained,0);assert.equal((await request({key,action:'status'})).localReady,true);assert.equal((await request({key,action:'tools/call',name:'y_file_delete'})).code,'UNSUPPORTED');assert.equal(drained,0);assert.equal((await request({key,action:'drain'})).safeToStop,true);assert.equal(drained,1);}finally{await new Promise(r=>server.close(r));}
});
test('Actual broker preserves pending approvals during drain and records marker result; controlled transport fixture is NOT ChatGPT',async()=>{
 const f=fixture(),key=randomBytes(32).toString('hex'),proofKey=randomBytes(32).toString('hex'),pipe='\\\\.\\pipe\\YGPT-integration-'+randomBytes(12).toString('hex'),data=path.dirname(f.config.stateDir);fs.mkdirSync(data,{recursive:true});
 const marker=path.join(f.project,'first.txt');fs.writeFileSync(marker,'YGPT_CONTROLLED_TRANSPORT_FIXTURE');fs.writeFileSync(path.join(data,'first-use-challenge.json'),JSON.stringify({generation:'TEST_ONLY',path:marker,sha256:createHash('sha256').update(fs.readFileSync(marker)).digest('hex')}));
 const env={YGPT_SETUP_DATA_DIR:data,YGPT_CONTROL_PIPE:pipe,YGPT_LOCAL_CONTROL_KEY:key,YGPT_FIRST_USE_KEY:proofKey,YGPT_TRANSPORT_SOURCE:'official-secure-tunnel'},prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);let c;
 const request=action=>new Promise((resolve,reject)=>{const s=net.connect(pipe);let text='';s.on('connect',()=>s.write(JSON.stringify({key,action})+'\n'));s.on('data',b=>text+=b);s.on('error',reject);s.on('end',()=>resolve(JSON.parse(text)));});
 try{c=await f.client().start();const status=await request('status');assert.equal(status.localReady,true);assert.equal(status.publicTools,(await c.rpc('tools/list')).tools.filter(t=>!t._meta?.ui?.visibility?.includes('app')).length);assert.equal(status.appOnly,2);
  assert.ok(!(await c.call('y_file_read',{path:marker})).isError);assert.equal(validateFirstUseProof(JSON.parse(fs.readFileSync(path.join(data,'first-use-proof.json'))),proofKey,'TEST_ONLY'),true);
  const pending=unpack(await c.call('y_process_run',{executable:process.execPath,args:['-e',"if(false){};console.log('Clear-Disk fixture')"],cwd:f.project}));assert.equal(pending.state,'suspended');assert.equal((await request('drain')).safeToStop,false);
  const card=await c.call('y_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,contextToken:pending.contextToken});await c.call('y_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yBar.uiToken,decision:'deny'});
  fs.writeFileSync(path.join(data,'maintenance-request'),'Controlled fixture barrier');assert.equal(unpack(await c.call('y_file_read',{path:marker})).executed,false);fs.unlinkSync(path.join(data,'maintenance-request'));
  assert.equal((await request('drain')).safeToStop,true);assert.equal((await request('status')).draining,true);assert.equal(unpack(await c.call('y_file_read',{path:marker})).executed,false);
 }finally{await c?.close();for(const [k,v]of Object.entries(prior))v===undefined?delete process.env[k]:process.env[k]=v;}
});
