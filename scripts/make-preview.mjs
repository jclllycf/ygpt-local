// Regenerates assets/brand/preview-classic.png: a faithful screenshot of the
// classic approval strip (runtime/approval-bar-legacy.html) with sample
// content, used as the style preview in the setup wizard and the updater.
// Run from the repo root: node scripts/make-preview.mjs (needs a Chromium;
// on Windows the repo's Playwright Edge channel works too).
import fs from 'node:fs';
import {chromium} from 'playwright';
const html=fs.readFileSync('runtime/approval-bar-legacy.html','utf8');
const exe=process.env.PREVIEW_CHROMIUM;
const browser=await chromium.launch(exe?{executablePath:exe,headless:true,args:['--no-sandbox']}:{channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:760,height:420},deviceScaleFactor:2});
await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:html}));
await page.goto('https://fixture.invalid/preview');
await page.waitForTimeout(600);
await page.evaluate(()=>{
  const t=document.getElementById('target'),i=document.getElementById('impact'),n=document.getElementById('note');
  if(t)t.textContent='D:\\Projects\\demo\\app.log';
  if(i)i.textContent='The file will be moved to the Recycle Bin. A snapshot keeps it restorable.';
  if(n)n.textContent='';
  for(const id of ['once','chat','deny']){const b=document.getElementById(id);if(b)b.removeAttribute('disabled');}
  const d=document.getElementById('details');if(d)d.style.display='none';
});
await page.waitForTimeout(150);
const main=page.locator('main');
await main.screenshot({path:'assets/brand/preview-classic.png'});
await browser.close();
console.log('preview written');
