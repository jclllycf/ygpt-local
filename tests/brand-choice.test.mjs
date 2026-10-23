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

function serveRaw(cfg){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-brand-'));
  const file=path.join(dir,'ygpt.config.json');fs.writeFileSync(file,JSON.stringify(cfg));
  const script=`import('./runtime/inline-approval.mjs').then(m=>{process.stdout.write(m.barHtmlForTest());}).catch(e=>{console.error(e);process.exit(1)});`;
  return execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:path.resolve('.'),env:{...process.env,YGPT_CONFIG:file},encoding:'utf8'});
}
function assertCspMatchesServed(text){
  const style=/<style>([\s\S]*?)<\/style>/.exec(text)[1];
  const declared=/style-src 'sha256-([^']+)'/.exec(text)[1];
  assert.equal(declared,crypto.createHash('sha256').update(style).digest('base64'));
}
test('green-family icon: the strip re-skins to fresh green and CSP still matches the served style',()=>{
  const text=serveRaw({brandIcon:'ygpt-local-green-y-256.png'});
  assert.ok(text.includes('--act1:#16a34a'),'primary button follows the green family');
  assert.ok(text.includes('--sky1:#4ade80'),'top edge follows the green family');
  assert.ok(!text.includes('--act1:#0284c7'),'no sky primary remains');
  assertCspMatchesServed(text);
});
test('sky-family icon: default Sky Air accents and CSP matches the served style',()=>{
  const text=serveRaw({brandIcon:'ygpt-local-sky-y-256.png'});
  assert.ok(text.includes('--act1:#0284c7'));
  assertCspMatchesServed(text);
});

test('README headers use the canonical board artwork and retired SVG candidates cannot ship',()=>{
  for(const file of ['README.md','README.zh-CN.md']){
    const header=fs.readFileSync(file,'utf8').split('\n')[0];assert.match(header,/src="assets\/brand\/plugin-icon-256\.png"/);
  }
  for(const file of ['assets/icon.svg','assets/brand/ygpt-local.svg','assets/brand/ygpt-local-light.svg','assets/brand/candidate-A.svg','assets/brand/candidate-B.svg','assets/brand/candidate-C.svg'])assert.equal(fs.existsSync(file),false,file);
});

test('Every current icon surface shares the board PNG; plugin icons meet the upload constraint',()=>{
  const canonical=fs.readFileSync('assets/brand/plugin-icon-256.png');
  for(const file of ['assets/brand/ygpt-local-256.png','assets/brand/ygpt-local-light-256.png','extension/icons/ygpt-256.png','plugin/assets/logo.png','assets/png/icon-256.png'])assert.deepEqual(fs.readFileSync(file),canonical,file);
  for(const name of ['plugin-icon-256.png','ygpt-local-green-y-256.png','ygpt-local-sky-y-256.png','ygpt-local-green-256.png','ygpt-local-signature-256.png']){
    const png=fs.readFileSync('assets/brand/'+name);assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);assert.ok(png.length<=10240,name);
  }
  // The active strip's actual image bytes, not merely their common PNG header.
  const html=serveRaw({}),data=html.match(/src="data:image\/png;base64,([^"]+)"/)[1];
  assert.deepEqual(Buffer.from(data,'base64'),canonical);
  const xaml=fs.readFileSync('runtime/approval-view.xaml','utf8');assert.match(xaml,/<Image Name="BrandIcon"/);assert.doesNotMatch(xaml,/<Path Data=/);
  assert.match(fs.readFileSync('runtime/approval-panel.ps1','utf8'),/plugin-icon-256\.png/);
});

test('Windows ICO frames retain the verified full-quality HD-master artwork at every shell size',()=>{
  const ico=fs.readFileSync('assets/brand/ygpt-local.ico');assert.deepEqual(ico,fs.readFileSync('assets/ygpt.ico'));
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  const expected=['3ed691f188ff68408f7a1e8eceada7d5c396cfe40c3231ecee4c14e9d167c69a','8fe08f2e00100259441b04adf73942500eedcc2d0c2b2dbe1eaf9e990ad8f336','2771632f4360f0ea735059250d848c182ae3dcf7bcf8a886c2554184fc8dbff6','77fa1c5265c364610df552e8fdfcf4cc8268f9e678235a71cbfcb4e30db3a0e5','8c77f09a118425fecb01ea0e998256474a4757c34d2f35cea42c6250a7b2a933','1e9df896ebf6cc39cc03be2a48ab5edf52ba0eb0fe2f3d6027b3a91bde5a5089','020c12e9ec4d53e96c85173258add01417f4258479219077545a3f6b9415e6e2'];
  for(const [i,size] of [16,24,32,48,64,128,256].entries()){
    const o=6+16*i;assert.equal(ico[o]||256,size);assert.equal(ico[o+1]||256,size);
    const n=ico.readUInt32LE(o+8),start=ico.readUInt32LE(o+12);assert.equal(crypto.createHash('sha256').update(ico.subarray(start,start+n)).digest('hex'),expected[i]);
  }
});
