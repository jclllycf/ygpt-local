import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {vault} from './secure-state.mjs';
import path from 'node:path';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const scrub=value=>String(value??'').replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,'[PRIVATE KEY REDACTED]').replace(/Bearer\s+[\w.\/+\-=]+/gi,'Bearer [REDACTED]').replace(/((?:authorization|password|token|secret|api[_-]?key|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi,'$1[REDACTED]').replace(/(?:sk-[\w-]{10,}|gh[pousr]_[\w]{12,})/g,'[REDACTED]');
// A chat context is a server-issued bearer capability held by ONE conversation.
// It is the only per-conversation discriminator on the shared stdio ingress: the
// host's clientInfo, session claims or model-supplied IDs are never identity.
// Idle contexts lapse after 12 hours; any context lapses 7 days after issue.
export const CONTEXT_IDLE_MS=12*3600000,CONTEXT_MAX_MS=7*86400000,CHAT_GRANT_MS=2*3600000;
// Engine resources that live only in the bridge process; their owner rows are
// discarded at startup because the resources themselves cannot survive it.
const VOLATILE_KINDS=['browser','desktop','session','search'];
const fail=(code,message)=>Object.assign(Error(code+': '+message),{code,effectStarted:false});
export const contextLabel=hash=>'ctx-'+String(hash).slice(0,10);
export class DurableLedger {
  constructor(location,{owner='private-stdio-owner',retentionDays=14,vault:injected}={}){
    // Explicit vault injection is used only by portable unit tests; the bridge
    // always uses the Windows-owner protected key.
    this.owner=digest(owner);this.vault=injected??vault(path.dirname(location));this.retentionDays=retentionDays;
    this.db=new DatabaseSync(location);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,digest TEXT NOT NULL,idem TEXT,tool TEXT NOT NULL,args TEXT NOT NULL,preview TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL,reason TEXT,result_ref TEXT,result TEXT,receipt TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS operation_idem ON operations(owner,idem) WHERE idem IS NOT NULL;
      CREATE INDEX IF NOT EXISTS op_pending ON operations(owner,digest,state);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,operation_id TEXT,state TEXT NOT NULL,created INTEGER,updated INTEGER,result_digest TEXT,result TEXT);
      CREATE TABLE IF NOT EXISTS approval_events(id TEXT PRIMARY KEY,owner TEXT NOT NULL,operation_id TEXT NOT NULL,event TEXT NOT NULL,channel TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS contexts(owner TEXT NOT NULL,token_hash TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,token_hash));
      CREATE TABLE IF NOT EXISTS chat_grants(owner TEXT NOT NULL,context_hash TEXT NOT NULL,scope_key TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,context_hash,scope_key));
      CREATE TABLE IF NOT EXISTS scopes(owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,token_hash TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,kind,id));`);
    this.db.exec('CREATE TABLE IF NOT EXISTS ui_capabilities(owner TEXT NOT NULL,id TEXT NOT NULL,token_hash TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,id,token_hash));');
    // Resource ownership: which chat context created a job, tab, UIA target or
    // process session. Possessing an ID or output token alone is not ownership.
    this.db.exec('CREATE TABLE IF NOT EXISTS resources(owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,context_hash TEXT NOT NULL,created INTEGER NOT NULL,label TEXT,PRIMARY KEY(owner,kind,id));');
    const columns=table=>new Set(this.db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name));
    for(const [table,column,type] of [['calls','context_label','TEXT'],['calls','transport','TEXT'],['calls','error_code','TEXT'],['contexts','created','INTEGER']])
      if(!columns(table).has(column))this.db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+type);
    this.db.prepare('DELETE FROM resources WHERE owner=? AND kind IN ('+VOLATILE_KINDS.map(()=>'?').join(',')+')').run(this.owner,...VOLATILE_KINDS);
    const interrupted=this.db.prepare("SELECT id FROM operations WHERE owner=? AND state IN ('running','approved')").all(this.owner);
    this.db.prepare("UPDATE operations SET state='unknown',reason='Bridge restarted during execution; reconcile before retrying',updated=? WHERE owner=? AND state IN ('running','approved')").run(Date.now(),this.owner);
    for(const r of interrupted)this.event(r.id,'unknown','restart-reconciliation');
    this.db.prepare("UPDATE calls SET state='unknown',updated=? WHERE owner=? AND state='running'").run(Date.now(),this.owner);
    this.prune();
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  prune(){
    const now=Date.now();const expired=this.db.prepare("SELECT id FROM operations WHERE owner=? AND state='awaiting_user' AND expires<=?").all(this.owner,now);
    this.db.prepare("UPDATE operations SET state='expired',updated=? WHERE owner=? AND state='awaiting_user' AND expires<=?").run(now,this.owner,now);
    for(const r of expired)this.event(r.id,'expired','system-expiry');
    const cutoff=now-this.retentionDays*86400000;
    this.db.prepare("DELETE FROM operations WHERE owner=? AND updated<? AND state IN ('succeeded','failed','denied','expired')").run(this.owner,cutoff);
    this.db.prepare("DELETE FROM calls WHERE owner=? AND updated<? AND state!='running'").run(this.owner,cutoff);
    this.db.prepare("DELETE FROM scopes WHERE owner=? AND created<?").run(this.owner,cutoff);
    this.db.prepare('DELETE FROM ui_capabilities WHERE owner=? AND created<?').run(this.owner,cutoff);
    this.db.prepare("DELETE FROM approval_events WHERE owner=? AND at<?").run(this.owner,cutoff);
    this.db.prepare('DELETE FROM chat_grants WHERE owner=? AND expires<=?').run(this.owner,now);
    this.db.prepare('DELETE FROM contexts WHERE owner=? AND expires<=?').run(this.owner,now);
    this.db.prepare('DELETE FROM resources WHERE owner=? AND created<?').run(this.owner,cutoff);
  }
  create(tool,args,preview,{idempotencyKey=null,ttlMs=1800000}={}){
    this.prune();const raw=stable(args);if(Buffer.byteLength(raw)>60000)throw Error('Operation exceeds 60 KB approval bound');
    if(idempotencyKey!==null&&(!/^[\w.:/-]{1,128}$/.test(idempotencyKey)))throw Error('Invalid idempotency key');
    const hash=digest(stable([tool,args,preview.contextHash??null]));
    // An idempotency key is scoped to the chat context that supplied it. Two
    // conversations choosing the same key (or the same arguments at nearly the
    // same time) are two operations, never a replay of each other.
    const idem=idempotencyKey===null?null:String(preview.contextHash??'no-context').slice(0,24)+'/'+idempotencyKey;
    return this.tx(()=>{
      const prev=idem?this.db.prepare('SELECT * FROM operations WHERE owner=? AND idem=?').get(this.owner,idem):this.db.prepare("SELECT * FROM operations WHERE owner=? AND digest=? AND state IN ('awaiting_user','approved','running','unknown') ORDER BY created DESC LIMIT 1").get(this.owner,hash);
      if(prev){if(prev.tool!==tool||this.vault.open(prev.args)!==raw)throw Error('Idempotency key was bound to different arguments');return {operation:this.public(prev),reused:true};}
      const id=randomUUID();const now=Date.now();const receipt=randomBytes(32).toString('hex');
      const clean={...preview,summary:scrub(preview.summary??tool),requestDigest:hash};
      this.db.prepare('INSERT INTO operations(id,owner,digest,idem,tool,args,preview,state,created,updated,expires,receipt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,this.owner,hash,idem,tool,this.vault.seal(raw),this.vault.seal(JSON.stringify(clean)),'awaiting_user',now,now,now+ttlMs,digest(receipt));
      return {operation:this.get(id),receipt,reused:false};
    });
  }
  row(id){if(typeof id!=='string'||!id)return null;return this.db.prepare('SELECT * FROM operations WHERE owner=? AND id=?').get(this.owner,id);}
  public(r){if(!r)return null;const p=JSON.parse(this.vault.open(r.preview));return {id:r.id,tool:r.tool,...p,state:r.state,createdAt:new Date(r.created).toISOString(),updatedAt:new Date(r.updated).toISOString(),expiresAt:new Date(r.expires).toISOString(),reason:r.reason??p.reason,resultRef:r.result_ref??undefined};}
  get(id){this.prune();return this.public(this.row(id));}
  args(id){const r=this.row(id);return r?JSON.parse(this.vault.open(r.args)):null;}
  // Completed traffic must never push a live approval out of the queue or out
  // of the owner's maintenance inventory. History has its own bounded APIs.
  pending(){this.prune();return this.db.prepare("SELECT * FROM operations WHERE owner=? AND state IN ('awaiting_user','approved','running','unknown') ORDER BY created DESC").all(this.owner).map(r=>this.public(r));}
  decideLocal(id,choice,channel='local-panel'){
    if(!['once','chat','deny'].includes(choice))return {ok:false,reason:'Invalid decision'};
    return this.tx(()=>{const r=this.row(id);if(!r)return {ok:false,reason:'Missing request'};
      if(r.state!=='awaiting_user'){
        const expected=choice==='chat'?'allow_chat':choice==='once'?'allow_once':'deny';
        const prior=this.db.prepare("SELECT event FROM approval_events WHERE owner=? AND operation_id=? AND event IN ('allow_once','allow_chat','deny') ORDER BY at LIMIT 1").get(this.owner,id);
        if(prior?.event===expected)return {ok:true,reused:true,approved:choice!=='deny',operation:this.public(r)};
        return {ok:false,reason:'Already decided or expired; decision cannot be changed'};
      }
      if(r.expires<=Date.now())return {ok:false,reason:'Expired request'};
      const p=JSON.parse(this.vault.open(r.preview));
      if(choice==='chat'){
        const context=this.db.prepare('SELECT expires FROM contexts WHERE owner=? AND token_hash=?').get(this.owner,p.contextHash??'');
        if(!p.chatScope?.eligible||!context||context.expires<=Date.now())return {ok:false,reason:'Conversation scope unavailable/expired; use Allow once'};
        // A scope may ask for a shorter lifetime (UIA: ten minutes), never longer.
        const ttl=Math.min(CHAT_GRANT_MS,Number.isInteger(p.chatScope.ttlMs)&&p.chatScope.ttlMs>0?p.chatScope.ttlMs:CHAT_GRANT_MS);
        this.db.prepare('INSERT OR REPLACE INTO chat_grants(owner,context_hash,scope_key,expires) VALUES(?,?,?,?)').run(this.owner,p.contextHash,p.chatScope.key,Math.min(context.expires,Date.now()+ttl));
      }
      const state=choice==='deny'?'denied':'approved';this.db.prepare('UPDATE operations SET state=?,updated=? WHERE id=? AND owner=? AND state=?').run(state,Date.now(),id,this.owner,'awaiting_user');
      this.event(id,choice==='chat'?'allow_chat':choice==='once'?'allow_once':'deny',channel);
      return {ok:true,approved:state==='approved',operation:this.get(id)};});
  }
  claim(id,tool,args){return this.tx(()=>{
    const r=this.row(id);if(!r)return false;const preview=JSON.parse(this.vault.open(r.preview));if(r.tool!==tool||r.digest!==digest(stable([tool,args,preview.contextHash??null]))||r.state!=='approved'||r.expires<=Date.now())return false;
    return this.db.prepare("UPDATE operations SET state='running',updated=? WHERE id=? AND owner=? AND state='approved'").run(Date.now(),id,this.owner).changes===1;
  });}
  autoClaim(id){return this.tx(()=>{const r=this.row(id);if(!r||r.state!=='awaiting_user'||r.expires<=Date.now())return false;return this.db.prepare("UPDATE operations SET state='running',updated=? WHERE owner=? AND id=? AND state='awaiting_user'").run(Date.now(),this.owner,id).changes===1;});}
  finish(id,state,response=null,reason=null,ref=null){
    if(!['succeeded','failed','unknown'].includes(state))throw Error('Invalid terminal state');
    const raw=response?JSON.stringify(response):null;
    const bounded=raw&&Buffer.byteLength(raw)<=131072?this.vault.seal(raw):null;
    const update=this.db.prepare("UPDATE operations SET state=?,updated=?,result=?,reason=?,result_ref=? WHERE owner=? AND id=? AND state='running'")
      .run(state,Date.now(),bounded,scrub(reason??(raw&&!bounded?'Result exceeded 128 KiB retention limit':'')),ref,this.owner,id);
    if(update.changes)this.event(id,state,'execution-result');
  }
  result(id){const r=this.row(id);return r?.result?JSON.parse(this.vault.open(r.result)):null;}
  canRead(id,receipt){return !!receipt&&this.row(id)?.receipt===digest(String(receipt));}
  // Provenance is recorded as a short context label (never the token or its
  // full hash) and the transport kind; host type (Chat vs Agent) is unverified.
  callStart(name,operationId=null,{context=null,transport=null}={}){const id=randomUUID(),now=Date.now();this.db.prepare('INSERT INTO calls(id,owner,name,operation_id,state,created,updated,context_label,transport) VALUES(?,?,?,?,?,?,?,?,?)').run(id,this.owner,name,operationId,'running',now,now,context?contextLabel(context):null,transport);return id;}
  callFinish(id,state,response=null,{code=null}={}){const raw=response?JSON.stringify(response):null;const errorCode=code??response?.structuredContent?.code??response?.structuredContent?.error?.code??null;this.db.prepare('UPDATE calls SET state=?,updated=?,result_digest=?,result=?,error_code=? WHERE owner=? AND id=?').run(state,Date.now(),raw?digest(raw):null,raw&&Buffer.byteLength(raw)<=131072?this.vault.seal(raw):null,typeof errorCode==='string'?errorCode.slice(0,64):null,this.owner,id);}
  calls(limit=20){return this.db.prepare('SELECT id,name,operation_id,state,created,updated,result_digest,context_label,transport FROM calls WHERE owner=? ORDER BY created DESC LIMIT ?').all(this.owner,Math.min(100,Math.max(1,Number(limit)||20)));}
  usageRows(since,limit=20000){return this.db.prepare('SELECT name,state,created,updated,context_label,transport,error_code FROM calls WHERE owner=? AND created>=? ORDER BY created LIMIT ?').all(this.owner,since,limit);}
  call(id,withResult=false){const r=this.db.prepare('SELECT * FROM calls WHERE owner=? AND id=?').get(this.owner,id);if(!r)return null;return {id:r.id,name:r.name,state:r.state,operation_id:r.operation_id,result_digest:r.result_digest,created:r.created,updated:r.updated,...(withResult?{result:r.result?JSON.parse(this.vault.open(r.result)):null}:{})};}
  grant(kind,id){const token=randomBytes(32).toString('hex');if(kind==='ui')this.db.prepare('INSERT INTO ui_capabilities(owner,id,token_hash,created) VALUES(?,?,?,?)').run(this.owner,String(id),digest(token),Date.now());else this.db.prepare('INSERT OR REPLACE INTO scopes(owner,kind,id,token_hash,created) VALUES(?,?,?,?,?)').run(this.owner,kind,String(id),digest(token),Date.now());return token;}
  owns(kind,id,token){if(!token)return false;const hash=digest(String(token));if(kind==='ui'&&this.db.prepare('SELECT 1 FROM ui_capabilities WHERE owner=? AND id=? AND token_hash=?').get(this.owner,String(id),hash))return true;const r=this.db.prepare('SELECT token_hash FROM scopes WHERE owner=? AND kind=? AND id=?').get(this.owner,kind,String(id));return !!r&&r.token_hash===hash;}
  event(id,event,channel){this.db.prepare('INSERT INTO approval_events(id,owner,operation_id,event,channel,at) VALUES(?,?,?,?,?,?)').run(randomUUID(),this.owner,id,event,channel,Date.now());}
  events(limit=20){const labels={allow_once:'允许这一次',allow_chat:'对话内固定范围允许',deny:'拒绝',expired:'过期',succeeded:'已完成',failed:'失败',unknown:'结果待核实'};return this.db.prepare('SELECT operation_id,event,channel,at FROM approval_events WHERE owner=? ORDER BY at DESC LIMIT ?').all(this.owner,limit).map(r=>({...r,at:new Date(r.at).toISOString(),label:labels[r.event]??r.event,title:this.public(this.row(r.operation_id))?.presentation?.title??'历史操作'}));}
  context(token){
    const now=Date.now();
    if(token){const hash=digest(String(token));const r=this.db.prepare('SELECT expires,created FROM contexts WHERE owner=? AND token_hash=?').get(this.owner,hash);if(!r||r.expires<=now)throw fail('CONTEXT_EXPIRED','conversation context expired, revoked or invalid; omit contextToken to receive a fresh one (resources of the old context stay with it)');
      // Sliding expiry: use keeps the context alive, bounded by its absolute lifetime.
      const created=r.created??r.expires-CONTEXT_IDLE_MS,expires=Math.max(r.expires,Math.min(created+CONTEXT_MAX_MS,now+CONTEXT_IDLE_MS));
      if(expires!==r.expires)this.db.prepare('UPDATE contexts SET expires=? WHERE owner=? AND token_hash=?').run(expires,this.owner,hash);
      return {hash,expires};}
    const value=randomBytes(32).toString('hex'),expires=now+CONTEXT_IDLE_MS;const hash=digest(value);this.db.prepare('INSERT INTO contexts(owner,token_hash,expires,created) VALUES(?,?,?,?)').run(this.owner,hash,expires,now);return {hash,expires,token:value};
  }
  own(kind,id,contextHash,label=null){
    if(typeof contextHash!=='string'||!contextHash)throw fail('SESSION_FOREIGN','an owned resource requires a chat context');
    return this.tx(()=>{const prior=this.ownerOf(kind,id);if(prior&&prior!==contextHash)throw fail('SESSION_FOREIGN','resource already belongs to another chat context');
      this.db.prepare('INSERT OR REPLACE INTO resources(owner,kind,id,context_hash,created,label) VALUES(?,?,?,?,?,?)').run(this.owner,kind,String(id),contextHash,Date.now(),label===null?null:String(label).slice(0,200));return true;});
  }
  ownerOf(kind,id){return this.db.prepare('SELECT context_hash FROM resources WHERE owner=? AND kind=? AND id=?').get(this.owner,kind,String(id))?.context_hash??null;}
  disown(kind,id){this.db.prepare('DELETE FROM resources WHERE owner=? AND kind=? AND id=?').run(this.owner,kind,String(id));}
  resourcesOf(contextHash,kind=null){return this.db.prepare('SELECT kind,id,created,label FROM resources WHERE owner=? AND context_hash=?'+(kind?' AND kind=?':'')+' ORDER BY created DESC LIMIT 200').all(this.owner,String(contextHash??''),...(kind?[kind]:[])).map(r=>({...r,created:new Date(r.created).toISOString()}));}
  foreignCounts(contextHash){return Object.fromEntries(this.db.prepare('SELECT kind,COUNT(*) AS n FROM resources WHERE owner=? AND context_hash!=? GROUP BY kind').all(this.owner,String(contextHash??'')).map(r=>[r.kind,r.n]));}
  // Only called after a verified human decision on a specific recovery request.
  transfer(kind,id,contextHash){if(typeof contextHash!=='string'||!contextHash)throw fail('SESSION_FOREIGN','recovery requires a chat context');this.db.prepare('INSERT OR REPLACE INTO resources(owner,kind,id,context_hash,created,label) VALUES(?,?,?,?,?,?)').run(this.owner,kind,String(id),contextHash,Date.now(),'recovered');}
  hasChatGrant(hash,key){return !!key&&!!this.db.prepare('SELECT 1 FROM chat_grants WHERE owner=? AND context_hash=? AND scope_key=? AND expires>?').get(this.owner,hash,key,Date.now());}
  contextActive(hash){return typeof hash==='string'&&!!this.db.prepare('SELECT 1 FROM contexts WHERE owner=? AND token_hash=? AND expires>?').get(this.owner,hash,Date.now());}
  closeContext(token){const hash=digest(String(token));this.db.prepare('DELETE FROM chat_grants WHERE owner=? AND context_hash=?').run(this.owner,hash);this.db.prepare('DELETE FROM contexts WHERE owner=? AND token_hash=?').run(this.owner,hash);}
  close(){this.db.close();}
}
