// Regenerates the approval-strip previews shown in the setup wizard and the
// updater: preview-new-<i>.png is the REAL current strip (served by
// runtime/inline-approval.mjs for icon i, accents and all) and
// preview-classic.png is the real classic strip, both screenshotted with
// sample content via Chromium. Run from the repo root:
//   node scripts/make-preview.mjs
// On this Linux box set PREVIEW_CHROMIUM=/opt/meta-chromium/chrome; on
// Windows the repo's Playwright Edge channel is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const ICONS=['plugin-icon-256.png','ygpt-local-green-y-256.png','ygpt-local-sky-y-256.png','ygpt-local-green-256.png','ygpt-local-signature-256.png'];
function servedHtml(cfg){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-preview-'));
  const file=path.join(dir,'ygpt.config.json');fs.writeFileSync(file,JSON.stringify(cfg));
  const script="import('./runtime/inline-approval.mjs').then(m=>{process.stdout.write(m.barHtmlForTest());}).catch(e=>{console.error(e);process.exit(1)});";
  return execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,YGPT_CONFIG:file},encoding:'utf8',maxBuffer:8*1024*1024});
}
const exe=process.env.PREVIEW_CHROMIUM;
const browser=await chromium.launch(exe?{executablePath:exe,headless:true,args:['--no-sandbox']}:{channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:760,height:460},deviceScaleFactor:2});
async function shoot(html,fill,out){
  // Render the served CSP as-is; fixture content is filled only for the preview.
  await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:html}));
  await page.goto('https://fixture.invalid/preview');
  await page.waitForTimeout(600);
  await page.evaluate(fill);
  await page.waitForTimeout(150);
  await page.locator('main').screenshot({path:out});
  await page.unroute('https://fixture.invalid/**');
  console.log('wrote',out);
}
const fillNew=()=>{
  const o=id=>document.getElementById(id),main=document.querySelector('main');
  main.dataset.state='awaiting_user';
  o('title').textContent='Review local command';
  o('target').textContent='D:\\Projects\\demo';
  o('impact').textContent='Run the exact action in Details. It may change files, start programs or contact external services.';
  o('state').textContent='Awaiting approval';
  o('note').textContent='Choose Allow once or Deny. Details explains why this action cannot be remembered.';
  o('once').removeAttribute('disabled');o('deny').removeAttribute('disabled');o('chat').hidden=true;
};
for(let i=0;i<ICONS.length;i++){
  await shoot(servedHtml({brandIcon:ICONS[i],approvalStyle:'current'}),fillNew,'assets/brand/preview-new-'+i+'.png');
}
const fillClassic=()=>{
  const o=id=>document.getElementById(id);
  if(o('target'))o('target').textContent='D:\\Projects\\demo\\app.log';
  if(o('impact'))o('impact').textContent='The file will be moved to the Recycle Bin. A snapshot keeps it restorable.';
  if(o('note'))o('note').textContent='';
  for(const id of ['once','chat','deny']){const b=o(id);if(b)b.removeAttribute('disabled');}
  const d=o('details');if(d)d.style.display='none';
};
await shoot(fs.readFileSync('runtime/approval-bar-legacy.html','utf8'),fillClassic,'assets/brand/preview-classic.png');
await browser.close();
