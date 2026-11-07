import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeWindows} from '../runtime/windows-native.mjs';
import {executionTemp} from '../runtime/execution-temp.mjs';
import {cleanEnvironment} from '../engine/src/environment.mjs';
import {fixture} from './helpers.mjs';

test('Vendor TEMP ACLs cannot block a fresh broker or become authorization state',{skip:process.platform!=='win32'},async()=>{
 const f=fixture(),state=f.config.stateDir;
 nativeWindows('state-prepare',{root:state});
 const temp=executionTemp(state);assert.equal(temp,path.resolve(state)+'.work-tmp');
 const java=path.join(temp,'hsperfdata_fixture');fs.mkdirSync(java);
 execFileSync('icacls.exe',[java,'/grant','*S-1-1-0:RX','*S-1-5-32-544:F'],{windowsHide:true,stdio:'pipe'});
 const env=await cleanEnvironment(state);assert.equal(env.TEMP,temp);assert.equal(env.TMP,temp);
 assert.equal(executionTemp(state),temp);assert.equal(nativeWindows('state-verify',{root:state}).descendantsChecked,true);
 const runtime=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {cleanEnv} from './runtime/config.mjs'; const e=cleanEnv(); console.log(JSON.stringify({temp:e.TEMP,tmp:e.TMP}));"],{cwd:path.resolve('.'),env:{...process.env,YGPT_CONFIG:f.file},windowsHide:true,encoding:'utf8'}));
 assert.deepEqual(runtime,{temp,tmp:temp});
 const c=await f.client().start();try{assert.ok((await c.rpc('tools/list')).tools.length>0);}finally{await c.close();}
 const protectedFile=path.join(state,'protected-control.json');fs.writeFileSync(protectedFile,'fixture only');
 execFileSync('icacls.exe',[protectedFile,'/grant','*S-1-1-0:R'],{windowsHide:true,stdio:'pipe'});
 assert.throws(()=>nativeWindows('state-verify',{root:state}),e=>e.code==='STATE_DESCENDANT_ACL_UNSAFE'&&e.path===protectedFile);
});

test('Work TEMP refuses a replaced or broadened boundary and remains unique per state',{skip:process.platform!=='win32'},()=>{
 const f=fixture(),state=f.config.stateDir;nativeWindows('state-prepare',{root:state});
 const temp=executionTemp(state),other=executionTemp(path.join(f.dir,'other-state'));
 assert.notEqual(temp,other);
 execFileSync('icacls.exe',[temp,'/grant','*S-1-1-0:R'],{windowsHide:true,stdio:'pipe'});
 assert.throws(()=>executionTemp(state),/EXECUTION_TEMP_BOUNDARY_UNSAFE/);
 execFileSync('icacls.exe',[temp,'/remove:g','*S-1-1-0'],{windowsHide:true,stdio:'pipe'});
 fs.rmdirSync(temp);fs.symlinkSync(other,temp,'junction');
 assert.throws(()=>executionTemp(state),/WINDOWS_CHECK_UNAVAILABLE/);
 assert.equal(fs.readdirSync(other).length,0);
});
