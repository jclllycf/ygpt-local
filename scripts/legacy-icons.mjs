// Lossless vector masters for the four existing geometric icon choices.
// Their config filenames stay compatible; UI surfaces use 512 px renders.
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const variants={
 'green-y':`<rect x="8" y="8" width="240" height="240" rx="58" fill="url(#green)"/><path d="M56 56H102L129 105 155 56H200L119 204H77L106 151Z" fill="#7cddb0"/><rect x="140" y="184" width="60" height="21" rx="5" fill="#7cddb0"/>`,
 'sky-y':`<rect x="8" y="8" width="240" height="240" rx="58" fill="url(#sky)"/><path d="M56 56H102L129 105 155 56H200L119 204H77L106 151Z" fill="white"/><rect x="140" y="184" width="60" height="21" rx="5" fill="white"/>`,
 'green':`<rect width="256" height="256" rx="53" fill="#103e34"/><path d="M52 61H101L129 107 156 61H205L151 138V225H107V138Z" fill="#99e9c7"/>`,
 'signature':`<rect x="8" y="8" width="240" height="240" rx="58" fill="url(#sky)"/><path d="M73 69L128 155M186 66L122 186Q100 225 70 209" fill="none" stroke="#fffdf4" stroke-width="27" stroke-linecap="round"/><circle cx="184" cy="178" r="18" fill="url(#sun)"/>`
};
const defs=`<defs><linearGradient id="green" x2="1" y2="1"><stop stop-color="#1a7561"/><stop offset="1" stop-color="#0e4739"/></linearGradient><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#2cbcec"/><stop offset="1" stop-color="#0088c2"/></linearGradient><radialGradient id="sun" cx=".3" cy=".3"><stop stop-color="#ffdc83"/><stop offset="1" stop-color="#ffad43"/></radialGradient></defs>`;
const browser=await chromium.launch({channel:'msedge'});
try{const page=await browser.newPage({deviceScaleFactor:1});
 for(const [name,body]of Object.entries(variants)){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">${defs}${body}</svg>`;
  await fs.mkdir('assets/brand/sources',{recursive:true});await fs.writeFile(`assets/brand/sources/${name}.svg`,svg);
  for(const size of [256,512,1024]){await page.setViewportSize({width:size,height:size});await page.setContent(`<style>html,body{margin:0}svg{width:100vw;height:100vh}</style>${svg}`);await page.screenshot({path:`assets/brand/ygpt-local-${name}-${size}.png`,omitBackground:true});}
 }
}finally{await browser.close();}
