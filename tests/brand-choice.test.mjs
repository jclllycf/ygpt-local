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
  assert.ok(r.imgPrefix?.startsWith(iconB64Prefix('ygpt-local-512.png')),r.imgPrefix);
  assert.ok(r.imgBytes>10240);
});
test('chosen icon: the strip follows the owner pick (sky y_)',()=>{
  const r=serveWith({brandIcon:'ygpt-local-sky-y-256.png'});
  assert.ok(r.imgPrefix?.startsWith(iconB64Prefix('ygpt-local-sky-y-512.png')),r.imgPrefix);
});
test('unknown icon name falls back to the current sprout',()=>{
  const r=serveWith({brandIcon:'nope.png'});
  assert.ok(r.imgPrefix?.startsWith(iconB64Prefix('ygpt-local-512.png')),r.imgPrefix);
});
test('legacy style: the original strip is served byte for byte',()=>{
  const r=serveWith({approvalStyle:'legacy',brandIcon:'ygpt-local-sky-y-256.png'});
  assert.equal(r.sha256,crypto.createHash('sha256').update(fs.readFileSync('runtime/approval-bar-legacy.html','utf8').replace("img-src 'none'","img-src data:")).digest('hex'));
  assert.equal(r.imgPrefix,null);
});

function serveRaw(cfg){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-brand-'));
  const file=path.join(dir,'ygpt.config.json');fs.writeFileSync(file,JSON.stringify(cfg));
  const script=`import('./runtime/inline-approval.mjs').then(m=>{process.stdout.write(m.barHtmlForTest());}).catch(e=>{console.error(e);process.exit(1)});`;
  return execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:path.resolve('.'),env:{...process.env,YGPT_CONFIG:file},encoding:'utf8'});
}
function assertCspMatchesServed(text){
  const style=/<style>([\s\S]*?)<\/style>/.exec(text)[1];
  const declared=/style-src 'sha256-([^']+)'/.exec(text)[1];
  assert.equal(declared,crypto.createHash('sha256').update(style.replace(/\r\n?/g,'\n')).digest('base64'));
}
test('green-family icon: the strip re-skins to fresh green and CSP still matches the served style',()=>{
  const text=serveRaw({brandIcon:'ygpt-local-green-y-256.png'});
  assert.ok(text.includes('--act1:#d5f5e0'),'primary button follows the green family');
  assert.ok(text.includes('--sky1:#4ade80'),'top edge follows the green family');
  assert.ok(!text.includes('--act1:#d5f0ff'),'no sky primary remains');
  assertCspMatchesServed(text);
});
test('sky-family icon: default Sky Air accents and CSP matches the served style',()=>{
  const text=serveRaw({brandIcon:'ygpt-local-sky-y-256.png'});
  assert.ok(text.includes('--act1:#d5f0ff'));
  assertCspMatchesServed(text);
});

test('README headers use the canonical board artwork and retired SVG candidates cannot ship',()=>{
  for(const file of ['README.md','README.zh-CN.md']){
    const header=fs.readFileSync(file,'utf8').split('\n')[0];assert.match(header,/src="assets\/brand\/ygpt-local-512\.png"/);
  }
  for(const file of ['assets/icon.svg','assets/brand/ygpt-local.svg','assets/brand/ygpt-local-light.svg','assets/brand/candidate-A.svg','assets/brand/candidate-B.svg','assets/brand/candidate-C.svg'])assert.equal(fs.existsSync(file),false,file);
});

test('Application PNGs keep full resolution; only the plugin upload icon has the 10 KB constraint',()=>{
  for(const size of [256,512,1024]){const png=fs.readFileSync('assets/brand/ygpt-local-'+size+'.png');assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.ok(png.length>10240);}
  const plugin=fs.readFileSync('assets/brand/plugin-icon-256.png');assert.equal(plugin.readUInt32BE(16),256);assert.ok(plugin.length<10240);
  const html=serveRaw({}),data=html.match(/src="data:image\/png;base64,([^"]+)"/)[1];assert.deepEqual(Buffer.from(data,'base64'),fs.readFileSync('assets/brand/ygpt-local-512.png'));assert.match(html,/img-src data:/);
});

test('Windows ICO has full-color PNG frames at every shell size',()=>{
  const ico=fs.readFileSync('assets/brand/ygpt-local.ico');assert.deepEqual(ico,fs.readFileSync('assets/ygpt.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  for(const [i,size] of [16,24,32,48,64,128,256].entries()){const o=6+16*i;assert.equal(ico[o]||256,size);assert.equal(ico[o+1]||256,size);assert.equal(ico.readUInt16LE(o+6),32);const n=ico.readUInt32LE(o+8),start=ico.readUInt32LE(o+12),png=ico.subarray(start,start+n);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.ok(start+n<=ico.length);}
});
