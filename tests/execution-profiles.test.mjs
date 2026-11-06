import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {nativeWindows} from '../runtime/windows-native.mjs';
import {executionHome} from '../runtime/execution-temp.mjs';
import {cleanEnvironment} from '../engine/src/environment.mjs';
import {migrateExecutionProfiles} from '../service/execution-profiles.mjs';
import {fixture} from './helpers.mjs';
const grant=(p,sid)=>execFileSync('icacls.exe',[p,'/grant','*'+sid+':F'],{windowsHide:true,stdio:'pipe'});
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('Move legacy application profiles byte-for-byte and preserve old absolute paths; vendor ACLs no longer stop the broker',{skip:process.platform!=='win32'},async()=>{
 const f=fixture(),state=f.config.stateDir,prepared=nativeWindows('state-prepare',{root:state});
 const source=path.join(state,'home'),app=path.join(source,'AppData','Roaming','fixture-app'),token=path.join(app,'.owner-token');
 fs.mkdirSync(app,{recursive:true});fs.writeFileSync(token,'opaque application fixture');
 const engineHome=path.join(state,'engine-home');fs.mkdirSync(engineHome);fs.writeFileSync(path.join(engineHome,'settings.json'),'KEEP SETTINGS');
 const control=path.join(state,'controller.json');fs.writeFileSync(control,'KEEP CONTROL');
 execFileSync('icacls.exe',[state,'/setowner','*'+prepared.ownerSid,'/T','/Q'],{windowsHide:true,stdio:'pipe'});
 grant(token,'S-1-5-32-544');const before=hash(token),controlHash=hash(control);
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_DESCENDANT_ACL_UNSAFE');
 const result=migrateExecutionProfiles(state);assert.deepEqual(result.migrated,['home','engine-home']);
 const home=executionHome(state,'home');assert.ok(!home.startsWith(state+path.sep));assert.equal(fs.realpathSync(source),fs.realpathSync(home));
 assert.equal(hash(token),before);assert.equal(hash(control),controlHash);assert.equal(fs.readFileSync(path.join(engineHome,'settings.json'),'utf8'),'KEEP SETTINGS');
 assert.deepEqual(migrateExecutionProfiles(state).migrated,[]);
 assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 grant(token,'S-1-1-0');assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true,'Application data is not controller authority');
 const env=await cleanEnvironment(state);assert.equal(env.HOME,home);assert.equal(env.APPDATA,path.join(home,'AppData','Roaming'));
 const c=await f.client().start();try{assert.ok((await c.rpc('tools/list')).tools.length);}finally{await c.close();}
 grant(control,'S-1-1-0');assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_DESCENDANT_ACL_UNSAFE'&&e.path===control);
});

test('Profile migration refuses nonempty targets and foreign aliases without merging or deleting either side',{skip:process.platform!=='win32'},()=>{
 const f=fixture(),state=f.config.stateDir,prepared=nativeWindows('state-prepare',{root:state});
 const source=path.join(state,'home');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'legacy.txt'),'ORIGINAL');
 execFileSync('icacls.exe',[source,'/setowner','*'+prepared.ownerSid,'/T','/Q'],{windowsHide:true,stdio:'pipe'});
 const target=executionHome(state,'home');fs.writeFileSync(path.join(target,'existing.txt'),'DESTINATION');
 assert.throws(()=>migrateExecutionProfiles(state),/DESTINATION_NOT_EMPTY/);
 assert.equal(fs.readFileSync(path.join(source,'legacy.txt'),'utf8'),'ORIGINAL');assert.equal(fs.readFileSync(path.join(target,'existing.txt'),'utf8'),'DESTINATION');
 fs.renameSync(source,path.join(state,'saved-home'));const outside=path.join(f.dir,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,source,'junction');
 assert.throws(()=>migrateExecutionProfiles(state),/LINK_REFUSED/);
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_LINK_REFUSED');assert.deepEqual(fs.readdirSync(outside),[]);
});

test('A broadened execution-profile outer boundary invalidates its exact legacy alias',{skip:process.platform!=='win32'},()=>{
 const f=fixture(),state=f.config.stateDir;nativeWindows('state-prepare',{root:state});
 const target=executionHome(state,'home');fs.symlinkSync(target,path.join(state,'home'),'junction');
 assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 grant(path.dirname(target),'S-1-1-0');
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_LINK_REFUSED');
 assert.throws(()=>executionHome(state,'home'),/EXECUTION_HOME_BOUNDARY_UNSAFE/);
});

test('A mid-migration junction failure restores both original profiles without replay or data loss',{skip:process.platform!=='win32'},t=>{
 const f=fixture(),state=f.config.stateDir,prepared=nativeWindows('state-prepare',{root:state});
 for(const kind of ['home','engine-home']){const source=path.join(state,kind);fs.mkdirSync(source);fs.writeFileSync(path.join(source,'keep.txt'),kind);}
 execFileSync('icacls.exe',[state,'/setowner','*'+prepared.ownerSid,'/T','/Q'],{windowsHide:true,stdio:'pipe'});
 const original=fs.symlinkSync;
 t.mock.method(fs,'symlinkSync',(target,link,type)=>{if(path.basename(link)==='engine-home')throw Error('fixture junction failure');return original(target,link,type);});
 assert.throws(()=>migrateExecutionProfiles(state),/fixture junction failure/);
 for(const kind of ['home','engine-home']){const source=path.join(state,kind);assert.equal(fs.lstatSync(source).isSymbolicLink(),false);assert.equal(fs.readFileSync(path.join(source,'keep.txt'),'utf8'),kind);}
 assert.equal(fs.existsSync(path.join(state,'execution-profiles-migration.json')),false);
});

test('Native canonical spelling of the same source is accepted',{skip:process.platform!=='win32'},t=>{
 const f=fixture(),state=f.config.stateDir,prepared=nativeWindows('state-prepare',{root:state});
 const source=path.join(state,'home');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'keep.txt'),'KEEP');
 execFileSync('icacls.exe',[source,'/setowner','*'+prepared.ownerSid,'/T','/Q'],{windowsHide:true,stdio:'pipe'});
 const original=childProcess.spawnSync;
 t.mock.method(childProcess,'spawnSync',(exe,args,options)=>{
  const result=original(exe,args,options),request=JSON.parse(options.input);
  if(request.action==='execution-home-source'&&result.status===0){const value=JSON.parse(result.stdout);value.result.path=value.result.path.toUpperCase();return {...result,stdout:JSON.stringify(value)};}
  return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.deepEqual(migrateExecutionProfiles(state).migrated,['home']);assert.equal(fs.readFileSync(path.join(source,'keep.txt'),'utf8'),'KEEP');
});
