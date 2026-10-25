import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers.mjs';
import {createEngine} from '../engine/src/engine.mjs';
import {EngineError} from '../engine/src/file-engine.mjs';

test('Native input distinguishes zero, partial and Win32 errors and batches every modifier release',{skip:process.platform!=='win32'},()=>{
 const f=fixture(),framework=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319'),exe=path.join(f.dir,'InputRegression.exe');
 const refs=['System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll',...['UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll'].map(n=>path.join(framework,'WPF',n))];
 execFileSync(path.join(framework,'csc.exe'),['/nologo','/platform:x64','/main:DesktopInputRegression','/out:'+exe,...refs.map(p=>'/reference:'+p),path.resolve('engine/windows/YDesktop.cs'),path.resolve('tests/DesktopInputRegression.cs')],{windowsHide:true,stdio:'pipe'});
 try{assert.match(execFileSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:10000}),/DESKTOP_INPUT_REGRESSION_PASS/);}finally{fs.unlinkSync(exe);}
});

test('Input delivery diagnostics and unknown outcomes survive the typed tool response',async()=>{
 const f=fixture();fs.writeFileSync(path.join(f.project,'.ygpt-engine-fixture'),'YGPT disposable fixture\n');
 const engine=await createEngine({mode:'fixture',root:f.project,stateDir:path.join(f.dir,'engine')},{protectState:async()=>{}});
 try{
  const targetId=randomUUID();engine.desktop.verified=async()=>({hwnd:'1',pid:1,birth:'1'});
  for(const [inserted,code] of [[0,'INPUT_NOT_INSERTED'],[1,'INPUT_PARTIAL']]){
   const inputDiagnostics={sourceIntegrityRid:8192,targetIntegrityRid:8192,sourceUiAccess:false,requested:4,inserted,win32Error:0};
   engine.desktop.request=async()=>{throw Object.assign(new EngineError(code,'Native input delivery failure'),{action:'keys',inputDiagnostics,effectStarted:inserted>0,outcomeUnknown:inserted>0});};
   const value=await engine.invoke('y_desktop_action',{targetId,action:'keys',value:'CTRL+L'});assert.equal(value.ok,false);assert.equal(value.error.code,code);assert.deepEqual(value.error.inputDiagnostics,inputDiagnostics);assert.equal(value.error.outcomeUnknown===true,inserted>0);if(!inserted)assert.equal(value.error.effectStarted,false);
  }
 }finally{await engine.close();}
});
