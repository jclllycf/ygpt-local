import path from 'node:path';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {chatScope} from './chat-scope.mjs';
import {stable,digest,scrub} from './durable.mjs';
import {config,INSTALL} from './config.mjs';
import {argvRiskText} from './access-policy.mjs';
export function describeEnglish(name,args={}){
 const file=/^(?:y_file_|write_file|edit_block|move_file|create_directory)/.test(name);
 const read=/^(?:read_|list_directory|get_file_info|start_search)/.test(name);
 return {title:read?'Read protected information':file?'Review file change':name.startsWith('y_browser_')?'Review browser action':'Review local command',
 purpose:'Continue the requested task after your approval.',target:args.path??args.file_path??args.destination??args.cwd??args.tabId??'Current Windows user environment',
 impact:read?'Return the selected information to this chat. No file is changed.':file?'Apply the exact file operation shown in Details.':'Run the exact action in Details. It may change files, start programs or contact external services.',
 denied:'Do not execute this operation.',risk:'Approval required',reversible:'Only recorded file snapshots can be restored; external effects may not be reversible.',administrator:'Current user permissions; no automatic elevation.',technical:scrub(JSON.stringify({tool:name,arguments:args},null,2))};
}
export function reviewScope(name,args){
 // A conversation grant is never a blanket OS permission. Keep physical disks,
 // credentials, Windows security and the live connector itself once-only.
 const raw=args.executable?argvRiskText([args.executable,...(args.args??[])]):args.argv?argvRiskText(args.argv):JSON.stringify(args),normalized=JSON.stringify(args).replaceAll('\\\\','\\').toLowerCase();
 const protectedNames=[config.stateDir,config.configFile,INSTALL,...config.protectedRoots].map(p=>path.resolve(p).toLowerCase());
 const restricted=/clear-disk|format-volume|diskpart|remove-partition|bcdedit|set-acl|icacls|takeown|mppreference|executionpolicy|localuser|localgroupmember|credentials|id_rsa|id_ed25519|auth\.json|\.ssh|\.codex/i.test(raw)||protectedNames.some(p=>normalized.includes(p));
 const existing=chatScope(name,args);
 if(!restricted&&existing.eligible)return {...existing,explanation:'Only this exact reviewed action and file/script hashes, for this chat capability, up to two hours. Revoke with y_close_context.'};
 if(!restricted&&['start_process','y_process_run','y_process_start','y_job_submit','write_file','edit_block','move_file','create_directory','read_file','read_multiple_files','list_directory','get_file_info','start_search','y_file_write','y_file_edit','y_file_copy','y_file_move','y_file_mkdir','y_file_batch'].includes(name)){
  const hashes=[];
  for(const value of [args.executable,...(args.args??[]),...(String(args.command??'').match(/[A-Za-z]:\\[^"'\s;|]+\.(?:ps1|mjs|cjs|js|py|exe)/gi)??[])]){
   if(typeof value==='string'&&path.isAbsolute(value)&&fs.existsSync(value)&&fs.statSync(value).isFile())hashes.push([value,createHash('sha256').update(fs.readFileSync(value)).digest('hex')]);
  }
  return {eligible:true,key:digest(stable([name,args,hashes])),explanation:'Always allow only this exact action, targets, arguments and reviewed executable/script hashes in this chat, for up to two hours. Changed scope requires approval.'};
 }
 return {eligible:false,key:null,explanation:'This sensitive action requires Allow once. A conversation-wide grant is unavailable.'};
}
