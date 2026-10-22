import {DatabaseSync} from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import {EngineError} from './file-engine.mjs';
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export class EngineLedger {
  constructor(stateDir) {
    this.db=new DatabaseSync(path.join(stateDir,'engine.sqlite3'));
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,request_key TEXT UNIQUE,digest TEXT NOT NULL,tool TEXT NOT NULL,state TEXT NOT NULL,started INTEGER,ended INTEGER,result TEXT);
      UPDATE calls SET state='unknown' WHERE state='running';`);
  }
  begin(tool,args,key) {
    if(key!==undefined&&!/^[a-zA-Z0-9_.:-]{1,120}$/.test(key))throw new EngineError('BAD_REQUEST_KEY','Invalid request key');
    const digest=crypto.createHash('sha256').update(stable({tool,args})).digest('hex');
    const old=key?this.db.prepare('SELECT * FROM calls WHERE request_key=?').get(key):null;
    if(old){if(old.digest!==digest)throw new EngineError('IDEMPOTENCY_COLLISION','Request key has different arguments');
      if(old.state!=='succeeded'&&old.state!=='failed')throw new EngineError('RESULT_UNKNOWN','Previous call may have executed; inspect state before retry');
      return {id:old.id,reused:true,result:JSON.parse(old.result)};}
    const id=crypto.randomUUID();this.db.prepare("INSERT INTO calls(id,request_key,digest,tool,state,started) VALUES(?,?,?,?,'running',?)").run(id,key??null,digest,tool,Date.now());return {id,reused:false};
  }
  finish(id,result){this.db.prepare('UPDATE calls SET state=?,ended=?,result=? WHERE id=?').run(result.error?.outcomeUnknown?'unknown':result.ok?'succeeded':'failed',Date.now(),JSON.stringify(result),id);}
  close(){this.db.close();}
}
