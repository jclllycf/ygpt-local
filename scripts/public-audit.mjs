import fs from 'node:fs';
import path from 'node:path';
const omit=new Set(['node_modules','.git','dist','build','.local','.test-work']),findings=[],files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(omit.has(e.name))continue;const p=path.join(dir,e.name);if(e.isSymbolicLink()){findings.push({path:p,reason:'linked source entry'});continue;}if(e.isDirectory())walk(p);else files.push(p);}}walk('.');
for(const f of files){const name=path.basename(f);if(/\.(?:dpapi|sealed|sqlite3?|db|pem|pfx|log)$/i.test(name)||name==='.env'||/^(?:credentials|cert|tunnel-token)\./i.test(name))findings.push({path:f,reason:'private runtime data filename'});if(fs.statSync(f).size>4*1024*1024){findings.push({path:f,reason:'large binary needs explicit artifact review'});continue;}
 const text=fs.readFileSync(f,'utf8');if(/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{25,}|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]{50,}-----END)/.test(text))findings.push({path:f,reason:'credential-like content'});
 if(/[CD]:[\\/]+Users[\\/]+(?!Public\b|Example\b|User\b|<)[^\\/\s"']+/i.test(text))findings.push({path:f,reason:'private user path'});
}
const licenses=JSON.parse(fs.readFileSync('docs/dependency-licenses.json'));const report={passed:findings.length===0,sourceFiles:files.length,dependencyPackages:licenses.packages.length,findings,scope:'Selected clean source tree only; binaries, third-party runtime inventories and publication history require separate checks.',at:new Date().toISOString()};fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/public-source-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(findings.length)process.exitCode=1;
