import path from 'node:path';
import {createEngine} from './engine.mjs';
import {EngineError} from './file-engine.mjs';

// Translation only. All policy / human consent / Git logic stays in RC9.
// There is no allow:true input or approval tool in the public engine catalog.
export function rc9Intents({tool,args:a,root,mutating}) {
  const full=p=>path.resolve(root,p),read=p=>({tool:'read_file',args:{path:full(p)}}),write=p=>({tool:'write_file',args:{path:full(p)}});
  const n=tool;
  if(n==='y_file_copy')return [read(a.source),write(a.destination)];
  if(n==='y_file_move')return [{tool:'move_file',args:{source:full(a.source),destination:full(a.destination)}}];
  if(n==='y_file_batch')return a.operations.flatMap(op=>rc9Intents({tool:'y_file_'+({write:'write',edit:'edit',copy:'copy',move:'move'}[op.kind]),args:op,root,mutating:true}));
  if(['y_file_write','y_file_edit','y_file_mkdir'].includes(n))return [{tool:n==='y_file_mkdir'?'create_directory':n==='y_file_edit'?'edit_block':'write_file',args:n==='y_file_edit'?{file_path:full(a.path)}:{path:full(a.path)}}];
  if(['y_file_read','y_file_read_bytes','y_file_info','y_file_list'].includes(n))return [read(a.path)];
  if(n==='y_file_read_many')return [{tool:'read_multiple_files',args:{paths:a.paths.map(full)}}];
  if(n==='y_file_patch')return [{tool:'edit_block',args:{file_path:full(a.path)}}];
  if(n==='y_project_inspect')return [{tool:'y_project_inspect',args:{path:full(a.path??'.')}}];
  if(['y_search_text','y_search_files'].includes(n))return [{tool:'start_search',args:{path:full(a.directory),pattern:a.pattern}}];
  // New browser/desktop/process capabilities must be explicitly recognized by
  // the host broker. They never inherit a generic file-read authorization.
  return [{tool:n,args:a,capability:tool.startsWith('y_browser_')?'browser':tool.startsWith('y_desktop_')?'desktop':tool.startsWith('y_process_')||tool.startsWith('y_job_')?'process':'observation',mutating}];
}
export function rc9Authorization(authorizeOperation) {
  if(typeof authorizeOperation!=='function')throw new EngineError('RC9_REQUIRED','Trusted RC9 authorization callback is required');
  return async request=>{
    for(const intent of rc9Intents(request)){
      const decision=await authorizeOperation(intent,request);
      if(decision?.decision!=='allow')return {allowed:false,reason:decision?.reason??'RC9 suspended or rejected this capability',code:decision?.code??(decision?.decision==='approve'?'APPROVAL_REQUIRED':null)};
    }
    return {allowed:true};
  };
}
export async function createRc9EngineExtension({config,authorizeOperation,backupManager,operationLedger,protectState}) {
  if(!operationLedger?.callStart||!operationLedger?.callFinish)throw new EngineError('RC9_REQUIRED','Live extension requires the shared RC9 encrypted ledger');
  // One call record per tool call: the broker opens it (with provenance) and
  // the engine reuses its ID. A direct engine call outside the broker opens its own.
  const brokerCall=typeof config.currentCall==='function'?config.currentCall:()=>null;
  const ledger={
    begin(tool,args,requestKey){if(requestKey!==undefined)throw new EngineError('BROKER_IDEMPOTENCY_REQUIRED','Live request keys must be resolved by the trusted RC9 broker before engine dispatch');const id=brokerCall();return id?{id,reused:false,broker:true}:{id:operationLedger.callStart(tool),reused:false};},
    finish(id,response){if(id===brokerCall())return;operationLedger.callFinish(id,response.error?.outcomeUnknown?'unknown':response.ok?'succeeded':'failed',response);}
  };
  return createEngine({...config,mode:'rc9-integrated'},{authorize:rc9Authorization(authorizeOperation),backupManager,ledger,protectState});
}
