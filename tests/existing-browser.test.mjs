// Take-over mode integration test (runs where a Chromium is available; skips
// elsewhere): a real browser with a remote-debugging port, a pre-existing
// "user tab", then YExistingBrowser must (a) discover several instances and
// refuse to guess between them, (b) attach to the designated one, (c) open
// its work tab in its own marked group without touching the user tab, and
// (d) detach leaving the browser running.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

const CHROME=process.env.YGPT_TEST_CHROMIUM??'/opt/meta-chromium/chrome';
const available=fs.existsSync(CHROME);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-existing-'));
async function freePort(){return new Promise(res=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});}
async function waitEndpoint(port,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fetch('http://127.0.0.1:'+port+'/json/version');if(r.ok)return true;}catch{}await new Promise(r=>setTimeout(r,300));}return false;}
async function launchBrowser(port,dir){
  for(const headless of ['--headless=new','--headless']){
    const proc=spawn(CHROME,[headless,'--no-sandbox','--disable-gpu','--remote-debugging-port='+port,'--user-data-dir='+dir,'about:blank'],{stdio:'ignore'});
    if(await waitEndpoint(port,8000))return proc;
    try{proc.kill('SIGKILL');}catch{}
  }
  throw new Error('chromium did not expose a debugging endpoint');
}

test('Existing browser: discovery choice, group discipline, detach survival',{skip:!available&&'no chromium on this host',timeout:120000},async()=>{
  const {YExistingBrowser,discoverExistingBrowsers}=await import('../engine/src/browser-engine.mjs');
  const pageServer=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>fixture '+req.url+'</title><button id="b">ok</button>');});
  await new Promise(r=>pageServer.listen(0,'127.0.0.1',r));
  const pagePort=pageServer.address().port,pageUrl='http://127.0.0.1:'+pagePort+'/work';
  const portA=await freePort(),portB=await freePort();
  const procA=await launchBrowser(portA,tmp()),procB=await launchBrowser(portB,tmp());
  try{
    // A pre-existing user tab in browser A (created outside YGPT, foreground).
    await fetch('http://127.0.0.1:'+portA+'/json/new?'+encodeURIComponent('http://127.0.0.1:'+pagePort+'/user-tab'),{method:'PUT'});
    await new Promise(r=>setTimeout(r,800));
    // Discovery sees both instances and their live tab counts.
    const found=await discoverExistingBrowsers({ports:[portA,portB]});
    assert.equal(found.length,2);
    assert.ok(found.find(c=>c.port===portA).tabs>=2,'browser A has the default tab plus the user tab');
    // With two candidates and no designation, attach must not guess.
    const engine=new YExistingBrowser({stateDir:tmp(),port:portA});
    const choice=await engine.attach({});
    // (engine was constructed with portA as default, so discovery narrows to
    // configured ports only: expect a connect to A here, not a choice.)
    assert.equal(choice.attached,true);
    assert.equal(engine.identity.port,portA);
    // Group open: a new marked tab appears; the user tab is untouched.
    const opened=await engine.open(pageUrl);
    assert.equal(opened.background,true);assert.ok(opened.group?.id);
    const marker=await engine.page(opened.tabId).evaluate(()=>window.name);
    assert.ok(marker.startsWith('ygpt:'),'group tab carries the YGPT marker: '+marker);
    const listA=await (await fetch('http://127.0.0.1:'+portA+'/json/list')).json();
    const userTarget=listA.find(t=>t.type==='page'&&t.url.includes('/user-tab'));
    assert.ok(userTarget,'user tab still exists');
    const status=engine.status();assert.equal(status.group.tabs,1);
    // Needs-choice: a fresh engine with BOTH ports configured must ask.
    const engine2=new YExistingBrowser({stateDir:tmp(),port:portA,endpoints:[{port:portB}]});
    const choice2=await engine2.attach({});
    assert.equal(choice2.needsChoice,true);assert.equal(choice2.candidates.length,2);
    const designated=await engine2.attach({port:portB});
    assert.equal(designated.attached,true);assert.equal(engine2.identity.port,portB);
    await engine2.detach();
    // Detach leaves both browsers running.
    await engine.detach();
    assert.ok(await waitEndpoint(portA,3000),'browser A still running after detach');
    assert.ok(await waitEndpoint(portB,3000),'browser B still running after detach');
    // Re-attach adopts the marked group tab instead of opening a new one.
    const engine3=new YExistingBrowser({stateDir:tmp(),port:portA});
    const re=await engine3.attach({});
    assert.equal(re.adopted,1,'the marked group tab is adopted on re-attach');
    await engine3.detach();
  }finally{
    try{procA.kill('SIGKILL');}catch{} try{procB.kill('SIGKILL');}catch{} pageServer.close();
  }
});
