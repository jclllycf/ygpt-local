import fs from 'node:fs';
import path from 'node:path';
try{await import('./enhanced-server.mjs');}
catch(e){
  // Tunnel only retained exit status in RC9. Persist a bounded, scrubbed reason
  // without echoing commands, tokens, private state or the environment.
  const clean=String(e.message??e).replace(/(?:Bearer\s+\S+|[a-zA-Z_]*(?:token|secret|password)["']?\s*[:=]\s*[^\s,;}]+)/gi,'[redacted]').slice(0,2000);
  const report={at:new Date().toISOString(),version:'1.0.0-rc.7',phase:'startup',code:e.code??'STARTUP_FAILED',message:clean,pid:process.pid};
  process.stderr.write(JSON.stringify(report)+'\n');
  try{const c=JSON.parse(fs.readFileSync(process.env.YGPT_CONFIG,'utf8'));if(c.startupDiagnostics){fs.mkdirSync(path.dirname(c.startupDiagnostics),{recursive:true});fs.writeFileSync(c.startupDiagnostics,JSON.stringify(report));}}catch{}
  process.exitCode=1;
}
