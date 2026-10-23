import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {upgradeData} from '../service/upgrade.mjs';
import {YBrowserFacade} from '../engine/src/browser-engine.mjs';
import {YBrowserEngine} from '../engine/src/browser-engine.mjs';

test('Legacy data moves inside the chosen application, preserving keys, SQLite and internal junction targets',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-contained-'));
  try{
    const install=path.join(root,'chosen app'),data=path.join(root,'legacy-data'),dest=path.join(install,'data');
    fs.mkdirSync(path.join(install,'engine','build'),{recursive:true});fs.writeFileSync(path.join(install,'engine','build','YDesktop.exe'),'new fixture');
    const cache=path.join(data,'state','home','.bun','install','cache');fs.mkdirSync(path.join(cache,'package@1'),{recursive:true});
    fs.symlinkSync(path.join(cache,'package@1'),path.join(cache,'package-link'),'junction');
    fs.writeFileSync(path.join(data,'credentials.dpapi'),'opaque-secret');fs.writeFileSync(path.join(data,'state','operations-rc.sqlite3'),'opaque-ledger');
    fs.writeFileSync(path.join(data,'ygpt.config.json'),JSON.stringify({product:'YGPT Local',stateDir:path.join(data,'state'),ingressId:'stable-identity',desktopAllowedApps:[{path:path.join(install,'engine','build','YDesktop.exe'),sha256:'old'}]}));
    const result=upgradeData({install,data});assert.equal(result.data,dest);assert.equal(fs.existsSync(data),false);
    assert.equal(fs.readFileSync(path.join(dest,'credentials.dpapi'),'utf8'),'opaque-secret');assert.equal(fs.readFileSync(path.join(dest,'state','operations-rc.sqlite3'),'utf8'),'opaque-ledger');
    assert.equal(fs.realpathSync(path.join(dest,path.relative(data,cache),'package-link')),fs.realpathSync(path.join(dest,path.relative(data,cache),'package@1')));
    const cfg=JSON.parse(fs.readFileSync(path.join(dest,'ygpt.config.json')));assert.equal(cfg.ingressId,'stable-identity');assert.equal(cfg.stateDir,path.join(dest,'state'));assert.match(cfg.desktopAllowedApps[0].sha256,/^[a-f0-9]{64}$/);
    assert.equal(upgradeData({install,data:dest}).migrated,false,'a second update can use already-contained data');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('One-shot isolated call closes its browser before returning, including navigation failures',async()=>{
  const facade=new YBrowserFacade({stateDir:os.tmpdir(),extension:{port:0}});let closes=0;
  facade.isolated.open=async()=>({tabId:'temporary',aria:'fixture'});facade.isolated.closeContext=async()=>{closes++;return {closed:true};};
  assert.equal((await facade.open('https://fixture.invalid')).closedAfterCall,true);assert.equal(closes,1);
  facade.isolated.open=async()=>{throw Error('navigation failed');};await assert.rejects(facade.open('https://fixture.invalid'));assert.equal(closes,2);
  await facade.close();
});

test('Failed context creation cannot strand a launched isolated browser',async()=>{
  let closed=0;const engine=new YBrowserEngine({stateDir:os.tmpdir(),launch:async()=>({on(){},newContext:async()=>{throw Error('context failed');},close:async()=>{closed++;}})});
  await assert.rejects(engine.open('https://fixture.invalid'),/context failed/);assert.equal(engine.browser,null);assert.equal(closed,1);assert.equal(engine.contexts.size,0);
});
