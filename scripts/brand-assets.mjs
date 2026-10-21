import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const dir='assets/brand';fs.mkdirSync(dir,{recursive:true});
const shapes={
 A:'<path d="M144 148 256 256 368 148M256 256v124" fill="none" stroke="{fg}" stroke-width="62" stroke-linecap="round" stroke-linejoin="round"/><circle cx="256" cy="256" r="17" fill="{point}"/>',
 B:'<path d="M106 122h76l74 102 74-102h76L290 288v102h-68V288Z" fill="{fg}"/><path d="m194 128 62 86 62-86" fill="none" stroke="{bg}" stroke-width="17" stroke-linecap="round"/>',
 C:'<path d="m150 150 106 105 106-105M256 255v110" fill="none" stroke="{fg}" stroke-width="44" stroke-linecap="round"/><g fill="{bg}" stroke="{fg}" stroke-width="24"><circle cx="144" cy="144" r="35"/><circle cx="368" cy="144" r="35"/><circle cx="256" cy="378" r="35"/></g>'
};
const svg=(kind,light=false)=>'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="YGPT Local"><rect width="512" height="512" rx="112" fill="'+(light?'#F7FAF8':'#153D34')+'"/>'+shapes[kind].replaceAll('{fg}',light?'#153D34':'#9BE8C4').replaceAll('{bg}',light?'#F7FAF8':'#153D34').replaceAll('{point}',light?'#328267':'#F7FAF8')+'</svg>';
for(const k of Object.keys(shapes))fs.writeFileSync(path.join(dir,'candidate-'+k+'.svg'),svg(k));
fs.writeFileSync(path.join(dir,'ygpt-local.svg'),svg('A'));fs.writeFileSync(path.join(dir,'ygpt-local-light.svg'),svg('A',true));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({deviceScaleFactor:1});
 for(const light of [false,true])for(const size of [16,24,32,48,64,128,256,512]){
  await page.setViewportSize({width:size,height:size});await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>'+svg('A',light));
  await page.screenshot({path:path.join(dir,'ygpt-local'+(light?'-light':'')+'-'+size+'.png'),omitBackground:true});
 }
 const sizes=[16,24,32,48,64,128,256],pngs=sizes.map(s=>fs.readFileSync(path.join(dir,'ygpt-local-'+s+'.png'))),head=Buffer.alloc(6+16*sizes.length);head.writeUInt16LE(1,2);head.writeUInt16LE(sizes.length,4);let offset=head.length;
 for(let i=0;i<sizes.length;i++){const n=6+i*16;head[n]=sizes[i]===256?0:sizes[i];head[n+1]=head[n];head.writeUInt16LE(1,n+4);head.writeUInt16LE(32,n+6);head.writeUInt32LE(pngs[i].length,n+8);head.writeUInt32LE(offset,n+12);offset+=pngs[i].length;}fs.writeFileSync(path.join(dir,'ygpt-local.ico'),Buffer.concat([head,...pngs]));
 await page.setViewportSize({width:960,height:400});await page.setContent('<style>body{margin:0;background:#F7FAF8;font:16px Segoe UI;color:#153D34;display:flex;gap:64px;padding:48px}.variant{display:grid;justify-items:center;gap:24px}svg{width:192px;height:192px}.small{width:16px;height:16px}</style>'+Object.entries(shapes).map(([k])=>'<div class="variant">'+svg(k)+'<span>Candidate '+k+'</span>'+svg(k).replace('<svg ','<svg class="small" ')+'</div>').join(''));await page.screenshot({path:path.join(dir,'candidates.png')});
}finally{await browser.close();}
const plugin=fs.statSync(path.join(dir,'ygpt-local-256.png'));if(plugin.size>10240)throw Error('Plugin icon exceeds the observed platform upload limit');
fs.writeFileSync(path.join(dir,'LICENSE.txt'),'Original Y / Connected artwork created for YGPT Local. Copyright 2026 YGPT Local contributors. Licensed under the project MIT license. No OpenAI or ChatGPT trademark artwork is incorporated.\n');
console.log(JSON.stringify({svg:true,icoSizes:[16,24,32,48,64,128,256],pluginPngBytes:plugin.size,selected:'A',reason:'Single clear Y route remains legible at small sizes; a pale junction marks the private connection.'}));
