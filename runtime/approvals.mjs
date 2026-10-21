import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {config,RUNTIME} from './config.mjs';
import {prepareState,protectForWindows,verifyState,acquireLease} from './secure-state.mjs';
import {DurableLedger} from './durable.mjs';
import {describeOperation} from './operation-description.mjs';
export const acl=prepareState();
export const releaseLease=acquireLease();
export const ledger=new DurableLedger(path.join(config.stateDir,'operations-rc.sqlite3'),{owner:config.ingressId});
const apiKey=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
let base='unavailable',popup=null,lastPopup=0;
const authFile=path.join(config.stateDir,'local-panel.dpapi');
export const portal=()=>base;
export const closePanel=()=>{try{popup?.kill();}catch{}};
export const pending=()=>ledger.pending();
export function notifyLocal(force=false){
  if((config.approvalSurface==='chat'&&!force)||config.popup==='0'||base==='unavailable'||popup||(!force&&Date.now()-lastPopup<10000))return;
  lastPopup=Date.now();
  // Only a static script path and protected file path appear in the process
  // command line. The bearer credential is read and unsealed inside Windows.
  const args=['-NoProfile','-STA','-WindowStyle','Hidden','-File',path.join(RUNTIME,'approval-panel.ps1'),'-StateDir',config.stateDir];if(process.env.YGPT_PANEL_FOCUS==='1')args.push('-FocusOnOpen');
  popup=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  popup.stderr.on('data',chunk=>{try{fs.writeFileSync(path.join(config.stateDir,'panel-diagnostic.dpapi'),protectForWindows(String(chunk)));}catch{}});
  popup.once('error',()=>{popup=null;process.stderr.write('[local panel] Launch failed; run open-approvals locally\n');});
  popup.once('exit',()=>{popup=null;});popup.unref();
}
export function lookup(name,args,preview,options){const r=ledger.create(name,args,{...preview,presentation:describeOperation(name,args,preview)},options);if(!r.reused)notifyLocal();return r;}
export async function launchPortal(onApproved){
  const server=http.createServer((req,res)=>{
    const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"};
    const reply=(code,body)=>{res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    if(req.headers.host!==new URL(base).host)return reply(403,{error:'Invalid Host'});
    if(req.headers.origin&&req.headers.origin!==base)return reply(403,{error:'Invalid Origin'});
    if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'&&req.headers['sec-fetch-site']!=='none')return reply(403,{error:'Cross-site request denied'});
    const auth=String(req.headers.authorization??'');const expected='Bearer '+apiKey;
    if(auth.length!==expected.length||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))return reply(401,{error:'Local Windows panel credential required'});
    if(req.method==='GET'&&req.url==='/api/queue')return reply(200,{csrf,entries:ledger.pending(),events:ledger.events()});
    if(req.method==='POST'&&req.url==='/api/decision'){
      if(req.headers['content-type']!=='application/json'||req.headers['x-ygpt-csrf']!==csrf)return reply(403,{error:'Invalid CSRF/content type'});
      let body='';req.on('data',b=>{body+=b;if(Buffer.byteLength(body)>2048)req.destroy();});
      req.on('end',()=>{let v;try{v=JSON.parse(body);}catch{return reply(400,{error:'Malformed JSON'});}
        const r=ledger.decideLocal(v.id,v.decision);if(!r.ok)return reply(409,{error:r.reason});
        if(r.approved)setImmediate(()=>onApproved(r.operation.id,r.operation.tool,ledger.args(r.operation.id)).catch(()=>process.stderr.write('[local panel] Execution failed; inspect operation status\n')));
        reply(200,{ok:true,id:r.operation.id,state:r.operation.state});
      });return;
    }
    reply(404,{error:'Not found'});
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=8;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});
  base='http://127.0.0.1:'+server.address().port;
  fs.writeFileSync(authFile,protectForWindows(JSON.stringify({base,key:apiKey})),{encoding:'utf8'});
  verifyState();
  process.stderr.write('[local panel] '+base+'; credential stored using CurrentUser DPAPI\n');
  if(ledger.pending().some(r=>r.state==='awaiting_user'))notifyLocal();
  return server;
}
