import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright';
test('Branded approval bundle executes with its real browser CSP; not a ChatGPT host test',async()=>{
 const html=fs.readFileSync('runtime/approval-bar.html','utf8'),server=http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),violations=[];page.on('console',m=>{if(/content security policy|refused to execute|refused to apply/i.test(m.text()))violations.push(m.text());});await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#note').filter({hasText:'Open this component inside the YGPT app in ChatGPT.'}).waitFor({timeout:5000});assert.equal(await page.getByRole('button',{name:'Allow once',exact:true}).isDisabled(),true);assert.deepEqual(violations,[]);}
 finally{await browser?.close();await new Promise(r=>server.close(r));}
});
