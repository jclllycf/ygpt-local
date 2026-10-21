import fs from 'node:fs';
import {createHash} from 'node:crypto';
const p='runtime/approval-bar.html',s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const script=/<script>([\s\S]*?)<\/script>/.exec(s)?.[1],style=/<style>([\s\S]*?)<\/style>/.exec(s)?.[1];if(!script||!style)throw Error('Expected self-contained approval bundle');
const hash=v=>createHash('sha256').update(v).digest('base64');
const out=s.replace(/script-src 'sha256-[^']+'/,"script-src 'sha256-"+hash(script)+"'").replace(/style-src 'sha256-[^']+'/,"style-src 'sha256-"+hash(style)+"'");fs.writeFileSync(p,out);console.log('Approval CSP hashes match the branded inline bundle.');
