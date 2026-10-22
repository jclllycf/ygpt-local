import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]??'');
if(!root.includes('.ygpt-local-tests')) throw Error('Isolated test directory required');
const install=path.join(root,'application'),data=path.join(root,'data');
const conn=JSON.parse(fs.readFileSync(path.join(data,'connection.json'),'utf8'));
if(conn.mode!=='secure-tunnel'||!/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(conn.tunnelId))throw Error('Not an isolated secure tunnel');
const {loadSecrets}=await import(pathToFileURL(path.join(install,'service','secrets.mjs')).href);
const secret=loadSecrets(data,install);
if(!secret.runtimeKey)throw Error('No encrypted runtime credential found');
const runtime=path.join(install,'runtimes'),node=path.join(runtime,'node','node.exe');
// Official tunnel-client parses --mcp.command through a POSIX-style tokenizer; raw Windows backslashes are swallowed.
const cmd='"'+node.replaceAll('\\','/')+'" "'+path.join(install,'runtime','bootstrap.mjs').replaceAll('\\','/')+'"';
const args=['run','--control-plane.tunnel-id',conn.tunnelId,'--control-plane.api-key','env:YGPT_TUNNEL_RUNTIME_KEY','--mcp.command','command='+cmd,'--mcp.stdio-send-initialized-notification','--health.listen-addr','127.0.0.1:0','--health.url-file',path.join(data,'direct-diagnostic-health.url')];
const env={...process.env,YGPT_TUNNEL_RUNTIME_KEY:secret.runtimeKey,YGPT_TRANSPORT_SOURCE:'official-secure-tunnel',YGPT_CONFIG:path.join(data,'ygpt.config.json'),YGPT_SETUP_DATA_DIR:data,YGPT_FIRST_USE_KEY:secret.verificationKey,YGPT_LOCAL_CONTROL_KEY:secret.localKey,YGPT_CONTROL_PIPE:'\\\\.\\pipe\\'+('not-used-without-remote-handshake'),PYTHONDONTWRITEBYTECODE:'1',NO_PROXY:'localhost,127.0.0.1,::1'};
env.PATH=path.join(runtime,'node')+';'+env.PATH;
let logs=[],exitCode=null,signal=null,closed=false;
function sanitized(s){
 return s.replaceAll(secret.runtimeKey,'[KEY]').replaceAll(conn.tunnelId,'[TUNNEL]').replace(/sk-[A-Za-z0-9_-]{15,}/g,'[KEY]').replace(/tunnel_[a-z0-9_]+/g,'[TUNNEL]').replace(/https?:\/\/[^\s"',]+/g,'[URL]').replace(/[A-Za-z0-9_=-]{85,}/g,'[REDACTED]').replace(/[A-Za-z]:\\[^"'\s]+/g,'[LOCAL_PATH]').slice(0,330);
}
function ingest(d,stream){for(const row of d.toString('utf8').split(/\r?\n/)){if(!row.trim())continue;const line=sanitized(row);if(/(err|warn|failed|connect|auth|timeout|retry|rate|tls|401|403|429|lookup|refused)/i.test(row)&&logs.length<28)logs.push({stream,line});}}
const child=spawn(path.join(runtime,'tunnel-client.exe'),args,{cwd:install,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',d=>ingest(d,'out'));child.stderr.on('data',d=>ingest(d,'err'));
child.on('error',e=>{logs.push({stream:'spawn',line:e.code||e.name});closed=true;});
child.on('close',(c,s)=>{closed=true;exitCode=c;signal=s;});
await new Promise(resolve=>setTimeout(resolve,23000));
if(!closed){child.kill();await new Promise(resolve=>setTimeout(resolve,1000));}
let ready=false;
try{const u=new URL(fs.readFileSync(path.join(data,'direct-diagnostic-health.url'),'utf8').trim());if(u.protocol==='http:'&&u.hostname==='127.0.0.1'){u.pathname='/readyz';const resp=await fetch(u,{signal:AbortSignal.timeout(1500)});ready=resp.ok;await resp.body?.cancel();}}catch{}
const summary={test:'isolated direct official tunnel-client',ready,closed,exitCode,signal,diagnostics:logs};
console.log(JSON.stringify(summary));