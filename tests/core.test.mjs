import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture,unpack,until} from './helpers.mjs';
test('Renamed catalog, snapshots, conflict safety, approvals and continuation',async()=>{
 const f=fixture(),c=await f.client().start();try{
 const call=async(n,a={})=>{const r=await c.call(n,a);assert.ok(!r.isError,JSON.stringify(r));return unpack(r);};
 const tools=(await c.rpc('tools/list')).tools;assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);assert.ok(tools.every(t=>t.name.startsWith('y_')));assert.ok(tools.some(t=>t.name==='y_sqlite_read'));assert.equal(tools.filter(t=>t._meta?.ui?.visibility?.includes('app')).length,2);
 const file=path.join(f.project,'check.txt');fs.writeFileSync(file,'value=100');const before=await call('y_file_info',{path:file});
 const edited=await call('y_file_edit',{path:file,oldText:'100',newText:'999'});const backup=edited.result.snapshotId;assert.ok(backup,JSON.stringify(edited));
 await call('y_backup_diff',{id:backup});const restored=await call('y_backup_restore',{id:backup});assert.equal(fs.readFileSync(file,'utf8'),'value=100');assert.ok(restored.undoBackupId);
 await call('y_backup_restore',{id:restored.undoBackupId});assert.equal(fs.readFileSync(file,'utf8'),'value=999');
 const e1=await call('y_file_edit',{path:file,oldText:'999',newText:'200'});await call('y_file_edit',{path:file,oldText:'200',newText:'300'});const old=e1.result.snapshotId;
 const conflict=await c.call('y_backup_restore',{id:old}),v=unpack(conflict);assert.equal(conflict.isError,true);assert.equal(v.code,'CONFLICT');assert.equal(v.executed,false);assert.equal(v.filesRestored,0);assert.equal(fs.readFileSync(file,'utf8'),'value=300');
 const dbPath=path.join(f.project,'read.db'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE sample(n); INSERT INTO sample VALUES (42)');db.close();assert.equal(String((await call('y_sqlite_read',{path:dbPath,sql:'SELECT n FROM sample'})).rows[0].n),'42');
 fs.mkdirSync(path.join(f.project,'.codex'));fs.writeFileSync(path.join(f.project,'.codex','metadata.json'),'{}');assert.equal((await call('y_process_run',{executable:process.execPath,args:['-e',"console.log('ROOT_OK')"],cwd:f.project})).ok,true);
 const pending=await call('y_process_run',{executable:process.execPath,args:['-e',"if(false){};console.log('Clear-Disk fixture')"],cwd:f.project});assert.equal(pending.state,'suspended');const card=await c.call('y_review_approval',{requestId:pending.requestId,contextToken:pending.contextToken});await call('y_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yBar.uiToken,decision:'once'});await until(async()=>(await call('y_call_status',{id:pending.requestId})).state==='succeeded');assert.equal((await call('y_bar_decide',{requestId:pending.requestId,uiToken:card._meta.yBar.uiToken,decision:'once'})).reused,true);
 const out=await call('y_local_start_process',{command:'Write-Output COMPAT_OK',cwd:f.project,timeout_ms:5000});assert.ok(out.outputToken);await call('y_local_read_process_output',{pid:Number(out.sessionId),outputToken:out.outputToken});
 }finally{await c.close();}
});
