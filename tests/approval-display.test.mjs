import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {launchFixtureBrowser} from './browser-fixture.mjs';

const script=fs.readFileSync('extension/approval-display.js','utf8');
const panel=(name='Review local action',brand='YGPT')=>`<section role="tabpanel" aria-label="${name}"><img alt="${brand}"><button aria-label="Close viewer">Close</button></section>`;
const html=extra=>`<!doctype html><body><article id="chat"><button id="allow">Allow Full Access</button><p id="private">Private fixture conversation</p></article>${extra}<script>window.actions=[];document.addEventListener('click',e=>{window.actions.push(e.target.getAttribute('aria-label')||e.target.id);if(e.target.getAttribute('aria-label')==='Close viewer')e.target.closest('section').remove()});</script></body>`;
async function pageWith(browser,extra,enabled=true,url='https://chatgpt.com/fixture'){
 const page=await browser.newPage();await page.addInitScript(enabled=>{window.changeListeners=[];window.chrome={storage:{local:{get:async()=>({inlineApprovalDisplay:enabled})},onChanged:{addListener:f=>window.changeListeners.push(f),removeListener:f=>window.changeListeners=window.changeListeners.filter(v=>v!==f)}}};},enabled);
 await page.route(url,route=>route.fulfill({contentType:'text/html',body:html(extra)}));await page.goto(url);await page.addScriptTag({content:script});return page;
}
test('Optional display helper closes only a positively identified YGPT viewer, even without a mounted card',async()=>{
 let browser;try{browser=await launchFixtureBrowser({channel:'msedge',headless:true});const page=await pageWith(browser,panel()+panel('Other app','Other app'));
 await page.getByRole('tabpanel',{name:'Review local action'}).waitFor({state:'detached'});assert.equal(await page.getByRole('tabpanel',{name:'Other app'}).count(),1);assert.deepEqual(await page.evaluate(()=>window.actions),['Close viewer']);assert.equal(await page.locator('#private').textContent(),'Private fixture conversation');assert.equal(await page.locator('#allow').isVisible(),true);
 }finally{await browser?.close();}
});
test('Generic titles, other plugins and ordinary approval controls are never treated as YGPT viewers',async()=>{
 let browser;try{browser=await launchFixtureBrowser({channel:'msedge',headless:true});const page=await pageWith(browser,panel('Review local action','Other app')+panel('Other app','YGPT'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));assert.deepEqual(await page.evaluate(()=>window.actions),[]);assert.equal(await page.getByRole('tabpanel').count(),2);
 }finally{await browser?.close();}
});
test('Display helper handles a viewer added later and stops immediately when disabled',async()=>{
 let browser;try{browser=await launchFixtureBrowser({channel:'msedge',headless:true});const page=await pageWith(browser,'');await page.evaluate(value=>document.body.insertAdjacentHTML('beforeend',value),panel());await page.getByRole('tabpanel').waitFor({state:'detached'});
 await page.evaluate(()=>window.changeListeners.slice().forEach(f=>f({inlineApprovalDisplay:{newValue:false}},'local')));await page.evaluate(value=>document.body.insertAdjacentHTML('beforeend',value),panel());assert.equal(await page.getByRole('tabpanel').count(),1);assert.deepEqual(await page.evaluate(()=>window.actions),['Close viewer']);
 }finally{await browser?.close();}
});
test('No consent or a different origin prevents the helper from inspecting or closing viewers',async()=>{
 let browser;try{browser=await launchFixtureBrowser({channel:'msedge',headless:true});for(const [enabled,url]of [[false,'https://chatgpt.com/fixture'],[true,'https://other-fixture.invalid/']]){const page=await pageWith(browser,panel(),enabled,url);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));assert.equal(await page.getByRole('tabpanel').count(),1);assert.deepEqual(await page.evaluate(()=>window.actions),[]);await page.close();}
 }finally{await browser?.close();}
});
test('ChatGPT scripting access is optional and requested only from the explicit popup button',()=>{
 const m=JSON.parse(fs.readFileSync('extension/manifest.json'));assert.ok(!m.permissions.includes('scripting'));assert.ok(!m.host_permissions.some(v=>v.includes('chatgpt.com')));assert.deepEqual(m.optional_permissions,['scripting']);assert.deepEqual(m.optional_host_permissions,['https://chatgpt.com/*']);assert.equal(m.content_scripts,undefined);
 const settings=fs.readFileSync('extension/approval-display-settings.js','utf8');assert.match(settings,/button\.addEventListener\('click'/);assert.match(settings,/chrome\.permissions\.request/);
});
