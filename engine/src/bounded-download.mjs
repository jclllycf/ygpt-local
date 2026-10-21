import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {EngineError} from './file-engine.mjs';

// Native browser downloads are disabled. An explicit tool request reserves a
// complete slot BEFORE opening a connection, then streams with a hard cap.
export class BoundedDownloads {
  constructor({directory,validateUrl,maxBytes=32*1024*1024,totalBytes=128*1024*1024,maxFiles=4}){Object.assign(this,{directory,validateUrl,maxBytes,totalBytes,maxFiles});this.reserved=0;this.active=0;}
  async save(raw){
    this.validateUrl(raw);await fs.mkdir(this.directory,{recursive:true});
    const entries=await fs.readdir(this.directory,{withFileTypes:true});
    if(entries.some(e=>!e.isFile()))throw new EngineError('DOWNLOAD_STORE_UNSAFE','Download store contains a non-file');
    let used=0;for(const e of entries)used+=(await fs.stat(path.join(this.directory,e.name))).size;
    if(entries.length+this.active>=this.maxFiles||used+this.reserved+this.maxBytes>this.totalBytes)throw new EngineError('DOWNLOAD_QUOTA','Download count/storage quota reached; owner must archive existing downloads');
    const space=await fs.statfs(this.directory);if(space.bavail*space.bsize<this.maxBytes+64*1024*1024)throw new EngineError('DOWNLOAD_QUOTA','Insufficient free disk space');
    this.reserved+=this.maxBytes;this.active++;
    const id=randomUUID(),output=path.join(this.directory,id+'.download');let handle,response;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      let url=raw;
      for(let i=0;i<6;i++){
        url=this.validateUrl(url);
        response=await new Promise((resolve,reject)=>{const req=(new URL(url).protocol==='https:'?https:http).get(url,{signal:controller.signal,headers:{'Accept-Encoding':'identity','User-Agent':'YGPT-Local-PC/2.1.0-rc.10'}},resolve);req.on('error',reject);});
        if([301,302,303,307,308].includes(response.statusCode)){const next=new URL(response.headers.location,url).href;response.destroy();url=next;if(i===5)throw new EngineError('DOWNLOAD_REDIRECT','Too many redirects');continue;}break;
      }
      if(response.statusCode!==200)throw new EngineError('DOWNLOAD_HTTP','Download returned HTTP '+response.statusCode);
      const declared=response.headers['content-length'];
      if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>this.maxBytes))throw new EngineError('DOWNLOAD_LIMIT','Declared size exceeds reserved limit; body not accepted');
      if(response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding']))throw new EngineError('DOWNLOAD_ENCODING','Compressed transfers unavailable in bounded path');
      handle=await fs.open(output,'wx');const hash=createHash('sha256');let bytes=0;
      for await(const chunk of response){if(bytes+chunk.length>this.maxBytes)throw new EngineError('DOWNLOAD_LIMIT','Streaming transfer exceeded reserved limit');bytes+=chunk.length;hash.update(chunk);await handle.writeFile(chunk);}
      if(declared!==undefined&&Number(declared)!==bytes)throw new EngineError('DOWNLOAD_TRUNCATED','Download length mismatch');
      await handle.sync();await handle.close();handle=null;
      return {downloadId:id,path:output,suggestedFilename:path.basename(new URL(url).pathname),bytes,sha256:hash.digest('hex'),quotaReservedBeforeTransfer:true};
    }catch(e){response?.destroy();await handle?.close().catch(()=>{});await fs.unlink(output).catch(()=>{});throw e;}
    finally{clearTimeout(timer);this.reserved-=this.maxBytes;this.active--;}
  }
}
