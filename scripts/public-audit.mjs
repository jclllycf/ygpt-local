import fs from 'node:fs';
import path from 'node:path';
const omit=new Set(['node_modules','.git','dist','build','.local','.test-work','NEXT_RELEASE_RC3_20261021']),findings=[],files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(omit.has(e.name))continue;const p=path.join(dir,e.name);if(e.isSymbolicLink()){findings.push({path:p,reason:'linked source entry'});continue;}if(e.isDirectory())walk(p);else files.push(p);}}walk('.');
for(const f of files){const name=path.basename(f);if(/\.(?:dpapi|sealed|sqlite3?|db|pem|pfx|log)$/i.test(name)||name==='.env'||/^(?:credentials|cert|tunnel-token)\./i.test(name))findings.push({path:f,reason:'private runtime data filename'});if(fs.statSync(f).size>4*1024*1024){findings.push({path:f,reason:'large binary needs explicit artifact review'});continue;}
 const text=fs.readFileSync(f,'utf8');if(/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{25,}|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]{50,}-----END)/.test(text))findings.push({path:f,reason:'credential-like content'});
 if(/[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Example\b|User\b|<)[^\\/\s"']+/i.test(text))findings.push({path:f,reason:'private user path'});
 for(const m of text.matchAll(/\btunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\b/g))if(!/0{32}$/.test(m[0]))findings.push({path:f,reason:'private Tunnel identity'});
}
const licenses=JSON.parse(fs.readFileSync('docs/dependency-licenses.json'));const report={passed:findings.length===0,sourceFiles:files.length,dependencyPackages:licenses.packages.length,findings,scope:'Selected clean source tree only; binaries, third-party runtime inventories and publication history require separate checks.',at:new Date().toISOString()};console.log(JSON.stringify(report));fs.mkdirSync('evidence',{recursive:true});const out='evidence/public-source-audit.json',tmp=out+'.new';fs.writeFileSync(tmp,JSON.stringify(report,null,2));fs.renameSync(tmp,out);if(findings.length)process.exitCode=1;
