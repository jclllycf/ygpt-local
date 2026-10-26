import path from 'node:path';import {spawn} from 'node:child_process';
export class ApprovalNotifications {
 constructor({enabled=false,send,cooldownMs=10000,isPending=()=>true}={}){this.enabled=enabled;this.send=send??sendBalloon;this.cooldownMs=cooldownMs;this.isPending=isPending;this.seen=new Set();this.queue=[];this.timer=null;this.last=0;}
 enqueue(operation){if(!this.enabled||!operation||operation.state!=='awaiting_user'||this.seen.has(operation.id))return false;
  this.seen.add(operation.id);if(this.seen.size>2048)this.seen.delete(this.seen.values().next().value);
  this.queue.push({id:operation.id,chat:operation.chatLabel??'ctx-'+String(operation.contextHash??'local').slice(0,10),title:operation.presentation?.title??operation.tool});
  if(!this.timer)this.timer=setTimeout(()=>void this.flush(),Math.max(100,this.cooldownMs-(Date.now()-this.last))).unref();return true;
 }
 async flush(){clearTimeout(this.timer);this.timer=null;const pending=this.queue.splice(0).filter(p=>this.isPending(p.id));if(!pending.length)return;this.last=Date.now();
  const message={title:pending.length===1?'YGPT approval needed':`YGPT: ${pending.length} approvals need you`,body:pending.slice(0,3).map(p=>`${p.chat}: ${p.title} [${p.id.slice(0,8)}]`).join('\n').slice(0,240)};
  try{await this.send(message);}catch{}return message;
 }
 close(){clearTimeout(this.timer);this.timer=null;this.queue.length=0;}
}
function sendBalloon(message){const child=spawn('powershell.exe',['-NoProfile','-STA','-WindowStyle','Hidden','-File',path.join(import.meta.dirname,'approval-notification.ps1')],{windowsHide:true,stdio:['pipe','ignore','ignore']});child.on('error',()=>{});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(message));child.unref();}
