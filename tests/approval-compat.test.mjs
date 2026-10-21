import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,unpack} from './helpers.mjs';
test('Cached pre-rename resource and App tools retain scoped approval, without advertising old names',async()=>{
 const f=fixture(),c=await f.client().start();
 try{
  const resources=(await c.rpc('resources/list')).resources;
  for(const suffix of ['compact-v11-3','strip-v3','card-v1','interactive-v11-2c','inspection-v1']){
   const uri='ui://yuki/approval/'+suffix+'.html';
   assert.ok(resources.some(r=>r.uri===uri),uri);
   const r=(await c.rpc('resources/read',{uri})).contents[0];
   assert.equal(r.uri,uri);assert.match(r.text,/<title>YGPT approval<\/title>/);
  }
  await assert.rejects(c.rpc('resources/read',{uri:'ui://yuki/approval/not-registered.html'}));
  const catalog=(await c.rpc('tools/list')).tools;
  assert.ok(catalog.every(t=>!t.name.startsWith('yuki_')));
  const pending=unpack(await c.call('yuki_process_run',{executable:process.execPath,args:['-e',"if(false){};console.log('Clear-Disk compatibility fixture')"],cwd:f.project}));
  assert.equal(pending.state,'suspended');
  const card=await c.call('yuki_show_approval',{requestId:pending.requestId,resultToken:pending.resultToken,contextToken:pending.contextToken});
  assert.equal(card._meta.yBar.enabled,true);assert.equal(card._meta.yBar.legacyBridge,true);
  assert.deepEqual(card._meta.yukiBar,card._meta.yBar);
  assert.ok(!JSON.stringify(card.content).includes(card._meta.yBar.uiToken));
  const missingContext=await c.call('yuki_review_approval',{requestId:pending.requestId});
  assert.equal(missingContext._meta.yukiBar.enabled,false);
  await assert.rejects(c.call('yuki_bar_decide',{requestId:pending.requestId,uiToken:'invalid',decision:'once'}),/CAPABILITY_INVALID/);
  const deny=unpack(await c.call('yuki_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yukiBar.uiToken,decision:'deny'}));
  assert.equal(deny.state,'denied');
  assert.equal(unpack(await c.call('y_call_status',{id:pending.requestId})).state,'denied');
 }finally{await c.close();}
});
