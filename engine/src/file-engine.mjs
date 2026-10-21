import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {writeFileAtomic} from '../vendor/desktop-commander/atomic-write.js';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export class EngineError extends Error {
  constructor(code, message) { super(message); this.name = 'YEngineError'; this.code = code; }
}
const missing = error => error?.code === 'ENOENT';

export class YFileEngine {
  // This prototype is constrained to a fixture root, independent of the production YGPT policy.
  static async create(root, { snapshot } = {}) {
    const real = await fs.realpath(root);
    if (!snapshot || typeof snapshot !== 'function') throw new EngineError('SNAPSHOT_REQUIRED', 'A pre-write snapshot provider is required');
    return new YFileEngine(real, snapshot);
  }
  constructor(root, snapshot) { this.root = root; this.snapshot = snapshot; this.pending=Promise.resolve(); }
  exclusive(fn) { const work=this.pending.catch(()=>{}).then(fn);this.pending=work;return work; }
  async resolve(input) {
    if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new EngineError('BAD_PATH', 'Invalid path');
    const unprefixed=input.replace(/^[a-zA-Z]:[\\/]/,'');
    if(unprefixed.split(/[\\/]/).some(p=>p.includes(':')||/[. ]$/.test(p)&&p!=='.'&&p!=='..'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new EngineError('BAD_PATH','Windows device, ADS and ambiguous path rejected');
    const full = path.resolve(this.root, input);
    const relative = path.relative(this.root, full);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new EngineError('OUT_OF_SCOPE', 'Path outside YGPT fixture root');
    if(relative.split(/[\\/]/).some(p=>p.includes(':')||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new EngineError('BAD_PATH','Windows device, ADS and ambiguous path rejected');
    let current = this.root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (e) { if (missing(e)) break; throw e; }
      if (stat.isSymbolicLink()) throw new EngineError('REPARSE_POINT', 'Symbolic links and junctions are not supported in the prototype');
      if(stat.isFile()&&stat.nlink!==1)throw new EngineError('LINKED_FILE','Hard-linked files require a separate recovery plan');
    }
    return full;
  }
  async stat(input) {
    const target = await this.resolve(input); const info = await fs.stat(target);
    return { path: target, size: info.size, isFile: info.isFile(), isDirectory: info.isDirectory(), mtimeMs: info.mtimeMs };
  }
  async boundedBytes(target,maxBytes=32*1024*1024){const info=await fs.stat(target);if(!info.isFile()||info.size>maxBytes)throw new EngineError('READ_LIMIT','Regular file exceeds this operation limit');const bytes=await fs.readFile(target);if(bytes.length>maxBytes)throw new EngineError('READ_LIMIT','File grew during read');return bytes;}
  async list(input = '.') {
    const target = await this.resolve(input);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.map(x => ({ name: x.name, type: x.isDirectory() ? 'directory' : x.isFile() ? 'file' : 'other' }))
      .sort((a,b) => a.name.localeCompare(b.name));
  }
  async read(input, { offset = 0, lines = 100, maxBytes = 1_048_576 } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(lines) || lines < 1 || lines > 2000) throw new EngineError('BAD_RANGE', 'Invalid read range');
    const target = await this.resolve(input); const info = await fs.stat(target);
    if (!info.isFile() || info.size > maxBytes) throw new EngineError('READ_LIMIT', 'File is not a regular bounded text file');
    const data = await fs.readFile(target);
    const all = new TextDecoder('utf-8', { fatal: true }).decode(data).split(/\r?\n/);
    return { path: target, content: all.slice(offset, offset + lines).join('\n'), totalLines: all.length,
      remainingLines: Math.max(0, all.length - offset - lines), sha256: sha256(data) };
  }
  async atomicWrite(input,value,options={}) { return this.exclusive(()=>this.writeLocked(input,value,options)); }
  async writeLocked(input, value, { expectedSha256 } = {}) {
    const target = await this.resolve(input), bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    if (bytes.length > 8 * 1024 * 1024) throw new EngineError('WRITE_LIMIT', 'Prototype file size limit: 8 MiB');
    let before = null;
    try { before = await this.boundedBytes(target); } catch (e) { if (!missing(e)) throw e; }
    const currentHash = before === null ? null : sha256(before);
    if (expectedSha256 !== undefined && expectedSha256 !== currentHash) throw new EngineError('STALE_PREIMAGE', 'Target changed since inspection');
    // RC9 integration seam: fail closed if no durable pre-write snapshot is confirmed.
    const receipt = await this.snapshot({ path: target, before, existed: before !== null, sha256: currentHash });
    if (!receipt || !receipt.durable) throw new EngineError('BACKUP_FAILED', 'Snapshot was not durably recorded; write cancelled');
    let committed=false;
    try {
      await writeFileAtomic(target,bytes,{beforeCommit:async()=>{
        await this.resolve(input);let check=null;
        try{check=await this.boundedBytes(target);}catch(e){if(!missing(e))throw e;}
        if((check===null?null:sha256(check))!==currentHash)throw new EngineError('STALE_PREIMAGE','Target changed after snapshot');
      }});
      committed=true;
      return { path: target, oldSha256: currentHash, sha256: sha256(bytes), snapshotId: receipt.id, bytes: bytes.length };
    } finally {
      await this.snapshot.finish?.(receipt.id,committed);
    }
  }
  async replaceExact(input, oldText, newText, { expectedSha256 } = {}) {
    if (typeof oldText !== 'string' || !oldText.length) throw new EngineError('BAD_REPLACE', 'Nonempty old text is required');
    const target = await this.resolve(input); const original = new TextDecoder('utf-8',{fatal:true}).decode(await this.boundedBytes(target,8*1024*1024));
    const occurrences = original.split(oldText).length - 1;
    if (occurrences !== 1) throw new EngineError('AMBIGUOUS_EDIT', 'Exact replacement must match once, found ' + occurrences);
    const actual=sha256(Buffer.from(original));
    if(expectedSha256!==undefined&&expectedSha256!==actual)throw new EngineError('STALE_PREIMAGE','Target changed since inspection');
    return this.atomicWrite(input, original.replace(oldText, String(newText)), { expectedSha256:actual });
  }
  async readBytes(input,{offset=0,length=65536}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>1048576)throw new EngineError('BAD_RANGE','Invalid byte range');
    const target=await this.resolve(input),h=await fs.open(target,'r');
    try{const stat=await h.stat();if(!stat.isFile())throw new EngineError('NOT_FILE','Regular file required');const buffer=Buffer.alloc(length),{bytesRead}=await h.read(buffer,0,length,offset);return {path:target,offset,bytesRead,totalBytes:stat.size,base64:buffer.subarray(0,bytesRead).toString('base64'),nextOffset:offset+bytesRead};}finally{await h.close();}
  }
  async copy(source,destination,{expectedSha256,expectedSourceSha256}={}) {
    return this.exclusive(async()=>{
      const src=await this.resolve(source),data=await this.boundedBytes(src,8*1024*1024);
      if(data.length>8*1024*1024)throw new EngineError('WRITE_LIMIT','Copy limit is 8 MiB');
      if(expectedSourceSha256!==undefined&&sha256(data)!==expectedSourceSha256)throw new EngineError('STALE_PREIMAGE','Source changed');
      return this.writeLocked(destination,data,{expectedSha256});
    });
  }
  async move(source,destination,{expectedSha256}={}) {
    return this.exclusive(async()=>{
      const src=await this.resolve(source),dest=await this.resolve(destination);
      if(src.toLowerCase()===dest.toLowerCase())throw new EngineError('SAME_PATH','Source and destination are identical');
      const data=await this.boundedBytes(src,8*1024*1024),digest=sha256(data);
      if(expectedSha256!==undefined&&expectedSha256!==digest)throw new EngineError('STALE_PREIMAGE','Source changed');
      const receipt=await this.snapshot({path:src,before:data,existed:true,sha256:digest});
      if(!receipt?.durable)throw new EngineError('BACKUP_FAILED','Move source preimage was not persisted');
      let removed=false;
      try{
        const written=await this.writeLocked(destination,data,{expectedSha256:null});
        await this.resolve(source);
        if(sha256(await fs.readFile(src))!==digest)throw new EngineError('PARTIAL_MOVE','Destination copied, source changed and was retained');
        await fs.unlink(src);removed=true;
        return {...written,source:src,sourceSnapshotId:receipt.id};
      }finally{await this.snapshot.finish?.(receipt.id,removed);}
    });
  }
  async mkdir(input) {
    return this.exclusive(async()=>{const target=await this.resolve(input),receipt=await this.snapshot({path:target,before:null,existed:false,sha256:null});
      if(!receipt?.durable)throw new EngineError('BACKUP_FAILED','Directory preimage missing');let ok=false;
      try{await fs.mkdir(target);ok=true;return {path:target,snapshotId:receipt.id};}finally{await this.snapshot.finish?.(receipt.id,ok);}});
  }
  async batch(operations) {
    if(!Array.isArray(operations)||operations.length<1||operations.length>50)throw new EngineError('BAD_BATCH','Use 1 to 50 operations');
    for(const op of operations){if(!['write','copy','move','edit'].includes(op.kind)||op.kind==='write'&&typeof op.content!=='string'||op.kind==='edit'&&(typeof op.oldText!=='string'||typeof op.newText!=='string')||['copy','move'].includes(op.kind)&&(!op.source||!op.destination))throw new EngineError('BAD_BATCH','Missing or unsupported batch fields');await this.resolve(op.path??op.source);if(op.destination)await this.resolve(op.destination);}
    const results=[];
    for(const op of operations){try{const result=op.kind==='write'?await this.atomicWrite(op.path,op.content,op):op.kind==='edit'?await this.replaceExact(op.path,op.oldText,op.newText,op):await this[op.kind](op.source,op.destination,op);results.push({ok:true,result});}
      catch(e){results.push({ok:false,error:{code:e.code??'FAILED',message:e.message}});break;}}
    return {atomic:false,completed:results.filter(x=>x.ok).length,requested:operations.length,results};
  }
}
