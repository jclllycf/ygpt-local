import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import readline from 'node:readline';
import {AdministratorAccess,verifyAdminHelper,adminProcessChannel} from '../runtime/admin-access.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fixture,unpack,until} from './helpers.mjs';
import {chatAccessPresentation,desktopAccessPresentation} from '../runtime/chat-access.mjs';
import {BAR_URI,FULL_ACCESS_URI} from '../runtime/inline-approval.mjs';
import {createHash} from 'node:crypto';

test('Administrator helper must match the exact installed manifest hash',()=>{
 const f=fixture(),dir=path.join(f.dir,'install'),exe=path.join(dir,'runtime/YGPTAdmin.exe');fs.mkdirSync(path.dirname(exe),{recursive:true});const bytes=Buffer.from('native-helper-fixture');fs.writeFileSync(exe,bytes);fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({product:'YGPT Local',files:[{path:'runtime/YGPTAdmin.exe',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}));assert.equal(verifyAdminHelper(dir),exe);fs.writeFileSync(exe,'changed');assert.throws(()=>verifyAdminHelper(dir),{code:'ADMIN_HELPER_CHANGED'});
});

test('Administrator executor requires a live grant, stays private to one context and stops on revoke or expiry',async()=>{
 const grants=new Map([['a',{expires:Date.now()+60000}],['b',{expires:Date.now()+60000}]]),workers=[];
 const access=new AdministratorAccess({install:'fixture',getGrant:h=>grants.get(h),verify:()=> 'fixture',launch:()=>{const w={closed:false,initialization:Promise.resolve({elevated:true}),stop(){this.closed=true;},async request(){return {ok:true,elevated:true,state:'succeeded'};}};workers.push(w);return w;}});
 try{await assert.rejects(access.run('a',{}),{code:'ADMIN_NOT_ACTIVE'});await access.start('a');assert.equal(access.status('a').active,true);assert.equal(access.status('b').active,false);await assert.rejects(access.run('b',{}),{code:'ADMIN_NOT_ACTIVE'});assert.equal((await access.run('a',{})).elevated,true);
  grants.delete('a');assert.equal(access.status('a').active,false);assert.equal(workers[0].closed,true);await assert.rejects(access.run('a',{}),{code:'ADMIN_NOT_ACTIVE'});
  await access.start('b');access.stop('b');assert.equal(workers[1].closed,true);assert.equal(access.status('b').active,false);
 }finally{access.stopAll();}
});

test('Cancelled UAC never reports elevation; ordinary Full Access remains separate',async()=>{
 const access=new AdministratorAccess({install:'fixture',getGrant:()=>({expires:Date.now()+60000}),verify:()=> 'fixture',launch:()=>({closed:false,initialization:Promise.reject(Object.assign(Error('cancelled'),{code:'UAC_CANCELLED'})),stop(){this.closed=true;}})});
 const state=await access.start('a');assert.equal(state.active,false);assert.equal(state.state,'uac-cancelled');await assert.rejects(access.run('a',{}),{code:'ADMIN_NOT_ACTIVE'});access.stopAll();
});

test('A dispatched Administrator command becomes unknown on channel loss, never falsely not-executed',async()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>true;const channel=adminProcessChannel(child,{fixture:true});child.stdout.write(JSON.stringify({ok:true,elevated:true})+'\n');await channel.initialization;const request=channel.request({executable:'fixture',timeoutMs:100});channel.stop();await assert.rejects(request,e=>e.effectStarted===true&&e.outcomeUnknown===true);child.stdout.end();
});

test('A superseded Administrator activation cannot stop its replacement',async()=>{
 let firstReject,n=0;const workers=[];const access=new AdministratorAccess({install:'fixture',getGrant:()=>({expires:Date.now()+60000}),verify:()=> 'fixture',launch:()=>{const first=n++===0,w={closed:false,initialization:first?new Promise((_,reject)=>firstReject=reject):Promise.resolve({elevated:true}),stop(){this.closed=true;if(first)firstReject(Object.assign(Error('superseded'),{code:'ADMIN_CHANNEL_CLOSED'}));}};workers.push(w);return w;}});
 const a=access.start('chat'),b=access.start('chat');assert.equal((await a).state,'superseded');assert.equal((await b).active,true);assert.equal(workers[1].closed,false);assert.equal(access.status('chat').active,true);access.stopAll();
});

test('Full Access alone never asks Windows UAC; ordinary approvals are inline and only explicit access cards may float',async()=>{
 const f=fixture(),c=await f.client().start();try{const catalog=(await c.rpc('tools/list')).tools;assert.equal(catalog.find(t=>t.name==='y_chat_access')._meta.ui.resourceUri,FULL_ACCESS_URI);assert.ok(catalog.some(t=>t.name==='y_admin_run'));
  const normal=(await c.rpc('resources/read',{uri:BAR_URI})).contents[0],full=(await c.rpc('resources/read',{uri:FULL_ACCESS_URI})).contents[0];assert.deepEqual(normal._meta['openai/ui'].availableDisplayModes,['inline']);assert.deepEqual(full._meta['openai/ui'].availableDisplayModes,['inline','pip']);
  assert.equal(chatAccessPresentation().displayMode,'pip');assert.equal(desktopAccessPresentation().displayMode,'inline');assert.match(chatAccessPresentation({administrator:true}).administrator,/Windows UAC/);
  const initial=unpack(await c.call('y_chat_access'));assert.equal(initial.administrator.active,false);const refused=unpack(await c.call('y_admin_run',{executable:process.execPath,cwd:f.project}));assert.equal(refused.code,'ADMIN_NOT_ACTIVE');
  const card=await c.call('y_chat_access',{action:'request_full',durationMinutes:10}),pending=unpack(card),ctx={contextToken:pending.contextToken};await c.call('y_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yBar.uiToken,decision:'once'});await until(async()=>unpack(await c.call('y_chat_access',ctx)).mode==='full');const active=unpack(await c.call('y_chat_access',ctx));assert.equal(active.windowsElevation,false);assert.equal(active.administrator.active,false);await c.call('y_chat_access',{action:'revoke',...ctx});
 }finally{await c.close();}
});

test('Native administrator transport fixture checks PID binding, literal arguments and process-tree expiry without UAC',{skip:process.platform!=='win32'},async()=>{
 const exe=path.resolve('runtime/YGPTAdmin.exe');if(!fs.existsSync(exe))throw Error('Build the native administrator helper first');
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),birth=spawnSync(ps,['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+process.pid+').StartTime.ToUniversalTime().Ticks'],{encoding:'utf8',windowsHide:true}).stdout.trim();
 const child=spawn(exe,['--fixture'],{windowsHide:true,stdio:['pipe','pipe','ignore']}),messages=[],lines=readline.createInterface({input:child.stdout});lines.on('line',s=>messages.push(JSON.parse(s)));let exited=false;child.on('exit',()=>{exited=true;});
 try{child.stdin.write(JSON.stringify({parentPid:process.pid,parentBirth:birth,expiresAt:new Date(Date.now()+15000).toISOString()})+'\n');await until(()=>messages.length,8000);assert.equal(messages[0].ready,true,JSON.stringify(messages[0]));
  child.stdin.write(JSON.stringify({id:1,executable:process.execPath,args:['-e','console.log(JSON.stringify(process.argv.slice(1)))','space and "quote"','C:\\tail\\','$(literal)'],cwd:process.cwd(),timeoutMs:5000})+'\n');await until(()=>messages.length>1,8000);assert.equal(messages[1].ok,true,JSON.stringify(messages[1]));assert.deepEqual(JSON.parse(messages[1].stdout),['space and "quote"','C:\\tail\\','$(literal)']);
  const f=fixture(),pidfile=path.join(f.dir,'descendant-pid.txt'),script='const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("node:fs").writeFileSync(process.argv[1],String(c.pid));setTimeout(()=>{},10000)';
  child.stdin.write(JSON.stringify({id:2,executable:process.execPath,args:['-e',script,pidfile],cwd:process.cwd(),timeoutMs:1000})+'\n');await until(()=>messages.length>2,5000);assert.equal(messages[2].code,'ADMIN_COMMAND_TIMEOUT');assert.equal(messages[2].outcomeUnknown,true);await until(()=>exited,5000);const descendant=Number(fs.readFileSync(pidfile,'utf8'));await until(()=>{try{process.kill(descendant,0);return false;}catch(e){return e.code==='ESRCH';}},5000);
 }finally{child.stdin.end();child.kill();lines.close();}
});

test('Native launcher refuses a recycled parent identity without launching a worker',{skip:process.platform!=='win32'},()=>{
 const exe=path.resolve('runtime/YGPTAdmin.exe'),r=spawnSync(exe,['--fixture'],{input:JSON.stringify({parentPid:process.pid,parentBirth:'1',expiresAt:new Date(Date.now()+60000).toISOString()})+'\n',encoding:'utf8',windowsHide:true,timeout:5000});assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).code,'ADMIN_PARENT_GONE');
});
