import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {YSearchEngine} from '../engine/src/search-engine.mjs';
import {YTerminalEngine} from '../engine/src/terminal-engine.mjs';
import {config} from './config.mjs';
export function createCompatEngine(){
 const search=new YSearchEngine({resolve:p=>fs.realpath(p)}),terminal=new YTerminalEngine({root:path.parse(config.projectRoots[0]).root,stateDir:config.stateDir,allowedExecutables:[],authorizeExecutable:async()=>true}),searches=new Map(),pids=new Map();
 const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],structuredContent:typeof value==='object'?value:{text:value}});
 function session(pid){const id=pids.get(pid);if(!id)throw Error('Unknown owned process');return terminal.poll(id);}
 async function invoke(n,a){
  if(n==='get_config')return text({product:'YGPT Local',configManagedLocally:true});
  if(n==='read_file'){const b=await fs.readFile(a.path);if(b.length>8*1024*1024)throw Error('Read bounded to 8 MiB; use y_file_read_bytes');return text(b.toString('utf8').split(/\r?\n/).slice(a.offset??0,(a.offset??0)+(a.length??100)).join('\n'));}
  if(n==='read_multiple_files')return text({files:await Promise.all(a.paths.map(async p=>({path:p,result:await invoke('read_file',{path:p})})))});
  if(n==='write_file'){await fs.mkdir(path.dirname(a.path),{recursive:true});if(a.mode==='append')await fs.appendFile(a.path,a.content);else await fs.writeFile(a.path,a.content);return text({written:true,path:a.path});}
  if(n==='edit_block'){const s=await fs.readFile(a.file_path,'utf8'),parts=s.split(a.old_string);if(parts.length-1!==(a.expected_replacements??1))throw Error('Exact replacement count mismatch; no edit');await fs.writeFile(a.file_path,parts.join(a.new_string));return text({edited:true});}
  if(n==='create_directory'){await fs.mkdir(a.path,{recursive:true});return text({created:true});}
  if(n==='move_file'){await fs.rename(a.source,a.destination);return text({moved:true});}
  if(n==='list_directory')return text({entries:(await fs.readdir(a.path,{withFileTypes:true})).slice(0,1000).map(e=>({name:e.name,type:e.isDirectory()?'directory':e.isFile()?'file':'other'}))});
  if(n==='get_file_info'){const s=await fs.stat(a.path);return text({path:a.path,size:s.size,isDirectory:s.isDirectory(),modified:s.mtime.toISOString()});}
  if(n==='start_search'){const id='search_'+Date.now()+'_'+randomUUID().slice(0,8),r=a.searchType==='files'?await search.findFiles(a.path,a.pattern,{limit:1000}):await search.findText(a.path,a.pattern,{maxMatches:1000,caseSensitive:!a.ignoreCase,glob:a.filePattern});searches.set(id,r);return text({sessionId:id,results:r,complete:true});}
  if(n==='get_more_search_results'){const r=searches.get(a.sessionId);if(!r)throw Error('Unknown search');return text({sessionId:a.sessionId,results:(r.matches??r.paths).slice(a.offset??0,(a.offset??0)+(a.length??100)),complete:true});}
  if(n==='stop_search'){searches.delete(a.sessionId);return text({stopped:true});}
  if(n==='list_searches')return text({searches:[...searches.keys()]});
  if(n==='start_process'){const exe=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),r=await terminal.start({executable:exe,args:['-NoLogo','-NoProfile','-NonInteractive','-Command',a.command],cwd:config.projectRoots[0],timeoutMs:Math.max(100,a.timeout_ms??10000)});pids.set(r.ownedPid,r.sessionId);await new Promise(r=>setTimeout(r,100));return text({...session(r.ownedPid),pid:r.ownedPid});}
  if(n==='read_process_output')return text(session(a.pid));
  if(n==='interact_with_process'){await terminal.input(pids.get(a.pid),a.input);return text(session(a.pid));}
  if(n==='force_terminate'||n==='kill_process')return text(await terminal.cancel(pids.get(a.pid)));
  if(n==='list_sessions'||n==='list_processes')return text({sessions:terminal.list()});
  if(n==='get_usage_stats')return text({ownedSessions:pids.size,searches:searches.size});
  throw Error('Unsupported compatible operation');
 }
 return {invoke,close:()=>terminal.close()};
}
