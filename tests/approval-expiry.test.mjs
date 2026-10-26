import test from 'node:test';import assert from 'node:assert/strict';import {DurableLedger,APPROVAL_TTL_MS} from '../runtime/durable.mjs';import {fixture} from './helpers.mjs';import path from 'node:path';
test('New approvals last six hours without changing a reused, explicitly shorter or expired request',()=>{
 const f=fixture(),ledger=new DurableLedger(path.join(f.dir,'expiry.sqlite3'),{owner:'expiry-fixture',vault:{seal:v=>'fixture:'+v,open:v=>v.slice(8)}});
 try{assert.equal(APPROVAL_TTL_MS,21600000);const ctx=ledger.context(),preview={contextHash:ctx.hash,presentation:{title:'Fixture'}};
 const first=ledger.create('fixture',{n:1},preview).operation;assert.equal(Date.parse(first.expiresAt)-Date.parse(first.createdAt),21600000);
 const reused=ledger.create('fixture',{n:1},preview);assert.equal(reused.reused,true);assert.equal(reused.operation.expiresAt,first.expiresAt);
 const short=ledger.create('fixture',{n:2},preview,{ttlMs:50}).operation;assert.equal(Date.parse(short.expiresAt)-Date.parse(short.createdAt),50);
 ledger.db.prepare('UPDATE operations SET expires=? WHERE id=?').run(Date.now()-1,short.id);assert.equal(ledger.get(short.id).state,'expired');assert.equal(ledger.decideLocal(short.id,'once','fixture').ok,false);
 assert.equal(ledger.fullAccess(ctx.hash),null,'Waiting six hours must not enable Full Access');
 }finally{ledger.close();}
});
