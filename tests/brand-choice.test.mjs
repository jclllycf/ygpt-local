import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

// The approval strip is served by runtime/inline-approval.mjs, which reads the
// owner's brand choice from ygpt.config.json (via runtime/config.mjs). Each
// case runs in a child process so the config module loads fresh.
function serveWith(cfg){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-brand-'));
  const file=path.join(dir,'ygpt.config.json');
  fs.writeFileSync(file,JSON.stringify(cfg));
  const script=`import('./runtime/inline-approval.mjs').then(async m=>{
    const {createHash}=await import('node:crypto');
    const text=m.barHtmlForTest();
    const img=text.match(/src="(data:image\\/png;base64,[^"]+)"/)?.[1]??null;
    console.log(JSON.stringify({sha256:createHash('sha256').update(text).digest('hex'),imgPrefix:img?img.slice(0,64):null,imgBytes:img?Buffer.from(img.split(',')[1],'base64').length:0,token:text.includes('__YGPT_BRAND_ICON__')}));
  }).catch(e=>{console.error(e);process.exit(1)});`;
  const out=execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:path.resolve('.'),env:{...process.env,YGPT_CONFIG:file},encoding:'utf8'});
  return JSON.parse(out.trim());
}
const iconB64Prefix=name=>'data:image/png;base64,'+fs.readFileSync(path.join('assets','brand',name)).toString('base64').slice(0,42);
const sha256File=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('default: current strip carries the current HD sprout icon, inlined',()=>{
  const r=serveWith({});
  assert.equal(r.token,false);
  assert.ok(r.imgPrefix?.startsWith(iconB64Prefix('plugin-icon-256.png')),r.imgPrefix);
  assert.ok(r.imgBytes>9000&&r.imgBytes<10240);
});
test('chosen icon: the strip follows the owner pick (sky y_)',()=>{
  const r=serveWith({brandIcon:'ygpt-local-sky-y-256.png'});
  assert.ok(r.imgPrefix?.startsWith(iconB64Prefix('ygpt-local-sky-y-256.png')),r.imgPrefix);
});
test('unknown icon name falls back to the current sprout',()=>{
  const r=serveWith({brandIcon:'nope.png'});
  assert.ok(r.imgPrefix?.startsWith(iconB64Prefix('plugin-icon-256.png')),r.imgPrefix);
});
test('legacy style: the original strip is served byte for byte',()=>{
  const r=serveWith({approvalStyle:'legacy',brandIcon:'ygpt-local-sky-y-256.png'});
  assert.equal(r.sha256,sha256File('runtime/approval-bar-legacy.html'));
  assert.equal(r.imgPrefix,null);
});
