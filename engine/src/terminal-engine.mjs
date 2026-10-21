import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {EngineError} from './file-engine.mjs';
import {cleanEnvironment} from './environment.mjs';
import {terminateProcessTree} from '../vendor/desktop-commander/process-tree.js';
export class YTerminalEngine {
  constructor({root,allowedExecutables,authorizeExecutable,maxOutputBytes=65536,stateDir=path.join(root,'.ygpt-terminal')}={}) {
    if(!path.isAbsolute(root??''))throw new EngineError('BAD_ROOT','An absolute project root is required');
    this.root=path.resolve(root);this.stateDir=stateDir;this.allowed=new Set((allowedExecutables??[]).map(p=>path.resolve(p).toLowerCase()));this.maxOutputBytes=maxOutputBytes;this.sessions=new Map();
    this.authorizeExecutable=authorizeExecutable;
  }
  async validate({executable,args=[],cwd=this.root,timeoutMs=10000}) {
    if(!path.isAbsolute(executable??''))throw new EngineError('EXE_NOT_ALLOWED','Executable must use an absolute local path');
    if(!this.allowed.has(path.resolve(executable).toLowerCase())&&await this.authorizeExecutable?.({executable,args,cwd,timeoutMs})!==true)throw new EngineError('EXE_NOT_ALLOWED','Executable requires broker authorization for this exact invocation');
    if(!Array.isArray(args)||args.length>100||args.some(x=>typeof x!=='string'||x.includes('\0')||x.length>32768))throw new EngineError('BAD_ARGS','Use a bounded argv array');
    const full=await fs.realpath(path.resolve(this.root,cwd)),rel=path.relative(this.root,full);
    if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new EngineError('OUT_OF_SCOPE','Process cwd outside project root');
    if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>86400000)throw new EngineError('BAD_TIMEOUT','Invalid timeout');
    return {executable,args,cwd:full,timeoutMs};
  }
  async start(input={}) {
    if([...this.sessions.values()].filter(s=>s.state==='running').length>=8)throw new EngineError('PROCESS_LIMIT','Eight active sessions already exist');
    const spec=await this.validate(input),id=crypto.randomUUID(),env=await cleanEnvironment(this.stateDir);
    const child=spawn(spec.executable,spec.args,{cwd:spec.cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const s={id,child,state:'running',stdout:'',stderr:'',bytes:0,truncated:false,timedOut:false,exitCode:null,startedAt:new Date().toISOString()};this.sessions.set(id,s);
    child.stdin.on('error',()=>{}); // write callback reports EPIPE without crashing the MCP server
    const decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};s.done=new Promise(resolve=>{s.resolve=resolve;});
    for(const key of ['stdout','stderr'])child[key].on('data',b=>{const room=this.maxOutputBytes-s.bytes;if(room>0){s[key]+=decoders[key].write(b.subarray(0,room));s.bytes+=Math.min(room,b.length);}if(b.length>room){s.truncated=true;void terminateProcessTree(child);}});
    s.timer=setTimeout(()=>{s.timedOut=true;void terminateProcessTree(child);},spec.timeoutMs);
    child.once('error',e=>{s.error=e.message;s.state='failed';clearTimeout(s.timer);s.resolve();});
    child.once('close',(code,signal)=>{clearTimeout(s.timer);s.stdout+=decoders.stdout.end();s.stderr+=decoders.stderr.end();s.exitCode=code;s.signal=signal;s.endedAt=new Date().toISOString();s.state=s.cancelled?'cancelled':s.timedOut?'timed_out':code===0?'succeeded':'failed';s.resolve();});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});return this.poll(id);
  }
  get(id){const s=this.sessions.get(id);if(!s)throw new EngineError('NO_SESSION','No process owned by this engine session');return s;}
  poll(id,{offset=0,limit=65536}={}) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>65536)throw new EngineError('BAD_RANGE','Invalid output range');
    const s=this.get(id);return {sessionId:id,state:s.state,ownedPid:s.child.pid,stdout:s.stdout.slice(offset,offset+limit),stderr:s.stderr.slice(offset,offset+limit),nextOffset:Math.max(s.stdout.length,s.stderr.length),exitCode:s.exitCode,signal:s.signal??null,truncated:s.truncated,timedOut:s.timedOut,error:s.error,startedAt:s.startedAt,endedAt:s.endedAt,interactive:'pipes; not a PTY'};
  }
  async input(id,text,{end=false}={}){const s=this.get(id);if(s.state!=='running'||typeof text!=='string'||Buffer.byteLength(text)>65536)throw new EngineError('BAD_INPUT','Session closed or input too large');await new Promise((resolve,reject)=>s.child.stdin.write(text,e=>e?reject(e):resolve()));if(end)s.child.stdin.end();return {sessionId:id,bytes:Buffer.byteLength(text)};}
  async cancel(id){const s=this.get(id);if(s.state!=='running')return this.poll(id);s.cancelled=true;const treeTerminated=await terminateProcessTree(s.child);await s.done;return {...this.poll(id),treeTerminated};}
  list(){return [...this.sessions.keys()].map(id=>this.poll(id,{limit:1})).map(({stdout,stderr,...s})=>s);}
  async run(input={}){const p=await this.start(input);await this.get(p.sessionId).done;return this.poll(p.sessionId);}
  async close(){await Promise.all([...this.sessions.values()].filter(s=>s.state==='running').map(s=>this.cancel(s.id)));}
}
