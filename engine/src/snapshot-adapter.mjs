import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {EngineError,sha256} from './file-engine.mjs';

// Fixture-only durable preimages. Live writes require the external RC9 BackupManager.
// This is deliberately not a second production backup / Git / approval system.
export async function fixtureSnapshotProvider(root,stateDir) {
  const marker=await fs.readFile(path.join(root,'.ygpt-engine-fixture'),'utf8').catch(()=>null);
  if(marker!=='YGPT disposable fixture\n')throw new EngineError('FIXTURE_REQUIRED','Standalone writes require an explicitly created disposable fixture');
  const base=path.join(stateDir,'fixture-preimages');await fs.mkdir(base,{recursive:true});
  return async ({path:target,before,existed,sha256:digest})=>{
    const relative=path.relative(root,target);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new EngineError('OUT_OF_SCOPE','Snapshot outside fixture');
    const id=crypto.randomUUID(),dir=path.join(base,id);await fs.mkdir(dir);
    if(existed){const h=await fs.open(path.join(dir,'preimage.bin'),'wx');try{await h.writeFile(before);await h.sync();}finally{await h.close();}
      if(sha256(await fs.readFile(path.join(dir,'preimage.bin')))!==digest)throw new EngineError('BACKUP_FAILED','Preimage verification failed');}
    const h=await fs.open(path.join(dir,'manifest.json'),'wx');try{await h.writeFile(JSON.stringify({id,path:target,existed,sha256:digest}));await h.sync();}finally{await h.close();}
    return {id,durable:true};
  };
}

export function rc9SnapshotProvider(manager,operation='y_engine_file_write') {
  if(!manager?.create||!manager?.verify||!manager?.finish)throw new EngineError('RC9_REQUIRED','RC9 BackupManager create/verify/finish are required');
  const provider=async ({path:target,sha256:expected})=>{
    const receipt=manager.create(operation,[target]);manager.verify(receipt.id);
    const entry=receipt.files.find(x=>path.resolve(x.path).toLowerCase()===path.resolve(target).toLowerCase());
    if(!entry||entry.beforeHash!==expected){manager.finish(receipt.id,false);throw new EngineError('STALE_PREIMAGE','RC9 preimage changed');}
    return {id:receipt.id,durable:true};
  };
  provider.finish=(id,ok)=>manager.finish(id,ok);
  return provider;
}
