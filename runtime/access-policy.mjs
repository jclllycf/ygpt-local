import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {config,INSTALL,RUNTIME,currentPermissionMode} from './config.mjs';
import {applyProfile} from './permission-profiles.mjs';
import {fileReadTools,isReadOnlyCommand,isReadOnlyInvocation} from './read-only-policy.mjs';
const w=path.win32;
const OS=process.env.SystemRoot??'C:/Windows';
export const systemRoots=[OS,process.env.ProgramFiles??'C:/Program Files',process.env.ProgramData??'C:/ProgramData',config.stateDir,RUNTIME,config.configFile,...config.protectedRoots].map(v=>canonical(v));
export const projectRoots=config.projectRoots.map(canonical);
export const userWritableRoots=projectRoots;
const privateRoots=[config.stateDir,INSTALL,config.configFile,...config.protectedRoots].map(canonical);
const ownWriteRoots=[INSTALL,config.stateDir,config.configFile,...config.protectedRoots].map(canonical);
const sensitive=/(?:^|\\)(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.codex|\.agents|\.mcp-auth|\.git|\.env(?:\.[^\\]+)?|\.npmrc|\.netrc|credentials[^\\]*|cookies[^\\]*|login data|local state|id_rsa|id_ed25519|private\.key|authorized_keys|startup)(?:\\|$)|\\appdata\\|\.(?:pem|p12|pfx|kdbx|reg)$|\\(?:sam|security|system|ntuser\.dat)$/i;
export const within=(p,r)=>p===r||p.startsWith(r+'\\');
function sensitivePath(target){
  // AppData logs and Git metadata are ordinary files in owner blacklist mode.
  // Named secret stores (cookies, .env, .ssh, .codex, keys) still match below.
  const probe=config.blacklistDefaultAllow?target.replace(/\\appdata(?=\\)/gi,'\\user-app-data').replace(/\\\.git(?=\\|$)/gi,'\\git-metadata'):target;
  return sensitive.test(probe);
}
export function canonical(input){
  if(typeof input!=='string'||!input||/[\x00-\x1f]/.test(input)||!w.isAbsolute(input)||!/^([a-z]:)[\\/]/i.test(input))throw Error('Expected absolute local drive path');
  const normalized=w.normalize(input);
  if(normalized.slice(2).includes(':'))throw Error('NTFS alternate streams are not allowed');
  if(normalized.split('\\').slice(1).some(v=>/[. ]$/.test(v)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(v)))throw Error('Ambiguous Windows device/path segment');
  let current=normalized;const missing=[];
  while(!fs.existsSync(current)&&w.dirname(current)!==current){try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Dangling reparse target');}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}missing.unshift(w.basename(current));current=w.dirname(current);}
  if(fs.existsSync(current))current=fs.realpathSync.native(current);
  const full=w.resolve(current,...missing);
  if(!/^[a-z]:\\/i.test(full))throw Error('Resolved UNC or device target is not allowed');
  return full.replace(/\\+$/,'').toLowerCase();
}
export function route(input){
  const target=canonical(input);
  if(/^g:/i.test(target)||/^g:/i.test(input))return {target,permission:'vault',sensitive:true};
  if(privateRoots.some(r=>within(target,r)))return {target,permission:'private',sensitive:true};
  const system=systemRoots.some(r=>within(target,r))||/^[a-z]:$/.test(target)||/^[a-z]:\\(?:boot|efi|recovery|\$recycle.bin|system volume information)(\\|$)/i.test(target);
  if(system||sensitivePath(target))return {target,permission:'approval',sensitive:true,system,secretAdjacent:sensitivePath(target)};
  return {target,permission:projectRoots.some(r=>within(target,r))?'project':'approval'};
}
export const developerTasks=['git-status','git-diff','git-log','node-test','npm-test','npm-build','npm-lint','npm-typecheck','python-pytest'];
/** Explicit opt-in for structured developer tasks. No raw shell or caller-provided argv.
 * This is HIGH TRUST: project tests and package scripts run as the Windows user,
 * without an OS sandbox. Only use with owner-reviewed project roots. */
export function planDevTask(a={}){
  if(config.autoDevTasks!==true)throw Error('Auto developer tasks disabled by owner configuration');
  if(typeof a.cwd!=='string'||!developerTasks.includes(a.task))throw Error('Unrecognized developer task or working directory');
  const cwd=canonical(a.cwd);
  const trusted=Array.isArray(config.trustedDeveloperRoots)?config.trustedDeveloperRoots:[];
  if(!trusted.some(root=>within(cwd,canonical(root)))||route(cwd).permission!=='project')throw Error('Task requires an owner-trusted developer project directory');
  if(!fs.existsSync(cwd)||!fs.statSync(cwd).isDirectory())throw Error('Developer working directory does not exist');
  const timeoutSeconds=a.timeoutSeconds??900;
  if(!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>1800)throw Error('Developer task timeout outside bounds');
  let argv;
  if(a.task.startsWith('git-')){
    const git=config.executables.git;
    if(!git||!fs.existsSync(git))throw Error('Pinned git executable is not available');
    const sub=a.task==='git-status'?['status','--short']:a.task==='git-diff'?['diff','--stat']:['log','-3','--oneline'];
    argv=[git,'-c','core.fsmonitor=false','-c','core.hooksPath=NUL',...sub];
  }else if(a.task==='node-test'){
    argv=[process.execPath,'--test'];
  }else if(a.task==='python-pytest'){
    if(!fs.existsSync(config.python))throw Error('Pinned Python executable is not available');
    argv=[config.python,...config.pythonArgs,'-m','pytest','-q'];
  }else{
    if(!fs.existsSync(path.join(cwd,'package.json')))throw Error('A project package.json is required for npm tasks');
    const cli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
    if(!fs.existsSync(cli))throw Error('Pinned npm-cli.js is not installed beside Node');
    const sub=a.task.slice('npm-'.length);
    argv=[process.execPath,cli,...(sub==='test'?['test','--ignore-scripts=false']:['run',sub])];
  }
  return {cwd,argv,timeoutSeconds,task:a.task};
}
const gate=(kind,summary,reason,extra={})=>({decision:'approve',kind,summary,reason,privilege:'当前 Windows 用户；不会提权',reversibility:'可能产生不可逆效果，请核对具体操作',...extra});
const deny=reason=>({decision:'deny',reason});
const allow=reason=>({decision:'allow',reason});
function workflow(a){
  const rules=fs.existsSync(config.configFile)?JSON.parse(fs.readFileSync(config.configFile,'utf8').replace(/^\uFEFF/,'' )).trustedWorkflows??[]:[];
  return rules.some(r=>{
    try{
      if(canonical(r.cwd)!==canonical(a.cwd)||JSON.stringify(r.argv)!==JSON.stringify(a.argv)||!Object.keys(r.files??{}).length)return false;
      for(const [f,hash] of Object.entries(r.files)){
        const full=canonical(w.resolve(r.cwd,f));if(!within(full,canonical(r.cwd)))return false;
        if(createHash('sha256').update(fs.readFileSync(full)).digest('hex')!==hash)return false;
      }
      return true;
    }catch{return false;}
  });
}
export function commandRisk(a={}){
  const command=String(a.command??'');
  if(!command||command.length>12000)return deny('Empty/oversized command');
  if(config.readOnlyAutoAllow&&isReadOnlyCommand(command))return allow('Owner-authorized read-only PowerShell pipeline; parsed without execution');
  if(highRiskCommand(command))return gate('system-maintenance',JSON.stringify({command,cwd:a.cwd??a.workingDirectory}),
    'Known destructive, privilege or protected configuration command requires verified human authorization');
  const cwd=a.cwd??a.workingDirectory??config.projectRoots[0];
  const target=route(cwd);
  if(target.permission==='private'||target.permission==='vault')return deny('Protected process working directory');
  const simple=new Map([
    ['node --version',{exe:process.execPath,argv:['--version']}],['node.exe --version',{exe:process.execPath,argv:['--version']}],
    ['whoami',{exe:w.join(OS,'System32','whoami.exe'),argv:[]}],['Get-Date',{local:'date'}],['Get-Location',{local:'cwd'}],['pwd',{local:'cwd'}],
    ['python --version',{exe:config.python,argv:[...config.pythonArgs,'--version']}],
    ['py --version',{exe:config.python,argv:[...config.pythonArgs,'--version']}],
    ['Get-Disk',{local:'disks'}],['Get-Partition',{local:'disks'}],
  ]);
  if(config.executables.git&&fs.existsSync(config.executables.git))for(const words of [['--version'],['status','--short'],['status','-sb'],['branch','--show-current'],['rev-parse','--show-toplevel']])simple.set('git '+words.join(' '),{exe:config.executables.git,argv:['-c','core.fsmonitor=false','-c','core.hooksPath=NUL',...words]});
  if(simple.has(command)&&Object.keys(a).every(k=>['command','cwd','workingDirectory','timeout_ms'].includes(k)))return {...allow('Known introspection executed without a shell or profile'),exec:simple.get(command),cwd};
  if(target.permission==='project')return allow('Ordinary owner-project terminal; native Windows ACL applies; arbitrary script effects are not fully sandboxed');
  if(config.blacklistDefaultAllow)return allow('Owner default-allow: no explicit command blacklist signal; current Windows permissions apply');
  return gate('command',JSON.stringify({command,cwd,input:a.input??null},null,2),'Shell/scripts/unknown execution requires exact local consent',{cwd,targets:[target.target]});
}
// Recognize only a complete Node literal-print program, never arbitrary JS or
// shell quoting. This fixes diagnostic words such as Clear-Disk being treated
// as an actual disk command. All other programs retain the full signal scan.
export function argvRiskText(argv=[]){
  const [exe,flag,script,...rest]=argv;
  if(config.blacklistDefaultAllow&&/^(?:node|node\.exe)$/i.test(w.basename(String(exe)))&&flag==='-e'&&!rest.length&&typeof script==='string'&&/^console\.log\((?:"(?:[^"\\\r\n]|\\["\\/bfnrt]|\\u[0-9a-f]{4})*"|'(?:[^'\\\r\n]|\\['"\\/bfnrt]|\\u[0-9a-f]{4})*')\);?$/i.test(script.trim()))return String(exe)+' literal-print-only';
  return argv.join(' ');
}
// A high-risk signal is never treated as a comprehensive shell sandbox. The
// same check is applied to argv job paths, including direct interpreter flags.
export function highRiskCommand(command){
  const value=String(command);
  // File tools classify targets structurally; terminals need an explicit
  // mutation + system-path signal as well. This is a blacklist, not a sandbox.
  if(config.blacklistDefaultAllow&&/\b(?:set-content|add-content|out-file|copy-item|move-item|remove-item|writefilesync|writefile|unlinksync|unlink|rmsync|rmtree|open|copy|move|del|erase)\b[^\r\n;]{0,160}(?:[a-z]:[\\/](?:windows|program files(?: \(x86\))?|programdata|boot|efi)\b|\$(?:env:)?(?:windir|systemroot|programfiles|programdata)\b)|(?:^|[^=])>{1,2}\s*["']?(?:[a-z]:[\\/](?:windows|program files|programdata|boot|efi)\b|\$env:(?:windir|systemroot|programfiles|programdata)\b)/i.test(value))return true;
  if(/\b(?:set-acl|icacls(?:\.exe)?|takeown(?:\.exe)?|set-mppreference|add-mppreference|set-executionpolicy|new-localuser|remove-localuser|add-localgroupmember|remove-localgroupmember)\b/i.test(value))return true;
  const normalized=value.replaceAll('/','\\').toLowerCase();
  // Explicit references to the connector's runtime/key/state or common secret
  // stores cannot use the ordinary project shell exception. This is a signal
  // guard, not a claim that arbitrary trusted code is an OS sandbox.
  if([config.stateDir,config.configFile,INSTALL,...config.protectedRoots].some(p=>normalized.includes(canonical(p))))return true;
  if(/(?:^|[\\/\s'"(])(?:\.ssh|\.aws|\.azure|\.kube|\.codex|\.mcp-auth|\.env(?:\.[\w-]+)?)(?:[\\/\s'";)]|$)|\b(?:auth\.json|id_rsa|id_ed25519|login data|credentials\.json)\b/i.test(value))return true;
  if(/\b(?:stop-process|taskkill(?:\.exe)?|stop-service|restart-service|set-service|new-service|remove-service|register-scheduledtask|unregister-scheduledtask|bcdboot|bootsect|mountvol|fsutil|runas(?:\.exe)?)\b|\bsc(?:\.exe)?\s+(?:create|config|delete|start|stop)\b|\bschtasks(?:\.exe)?\s+\/(?:create|delete|change|run|end)\b|\bnet(?:\.exe)?\s+(?:user|localgroup|start|stop)\b/i.test(value))return true;
  if(/(?:-enc(?:odedcommand)?\b|\bfrombase64string\b|\binvoke-expression\b|\biex\s*\()/i.test(value))return true; // opaque code cannot be reviewed by a name-only check
  // A bare wildcard can clear every entry in the working directory even when
  // no -Recurse/-Force option is present. Check *all* statements, not just the
  // first command of a PowerShell/CMD chain or an interpreter's argv.
  if(/\b(?:remove-item|rm|del|erase|rmdir|rd)\b(?:\s+(?:-(?:path|literalpath|filter)\s+)?|\s+)["']?(?:\.\\|\.\/)?\*(?:\s|["';|&)]|$)/i.test(value))return true;
  if(/\b(?:remove-item|rm|del|erase|rmdir|rd)\b[^\r\n;|&]{0,150}(?:[\\/]\*|\*\.[*\w?]+)(?:\s|["';|&)]|$)/i.test(value))return true;
  // Commands that explicitly discard dirty Git working trees are not ordinary
  // builds. They remain reviewable even within a trusted project directory.
  if(/\bgit(?:\.exe)?\s+(?:clean\s+-[a-z]*f[a-z]*|reset\s+--hard\b|checkout\s+--\s+\.|restore\s+(?:--worktree\s+)?\.)(?=\s|$|[;&|])/i.test(value))return true;
  if(/\b(?:rm|rmdir)\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\b/i.test(value))return true;
  return /\b(?:format-volume|clear-disk|initialize-disk|new-partition|remove-partition|resize-partition|set-partition|diskpart(?:\.exe)?|format\.com|bcdedit|manage-bde|reagentc|ventoy2disk|remove-localuser|set-mppreference|set-executionpolicy|takeown(?:\.exe)?|icacls(?:\.exe)?|reg\s+(?:delete|add)|vssadmin\s+delete|wbadmin\s+delete)\b|(?:^|\s)-verb\s+["']?runas\b|\b(?:rm|rmdir|del|erase|remove-item)\b[^\r\n]{0,200}(?:-recurse|-force|\/s|\/q|[a-z]:[\\/])|\b(?:rmSync|rmdirSync|rmtree)\s*\([^\r\n]{0,250}(?:[a-z]:[\\/]|recursive\s*:\s*true)/i.test(value);
}
function authorizeImpl(name,a={},scope={}){
  if(['y_review_approval','y_widget_credential','y_inline_decision','set_config_value','give_feedback_to_desktop_commander','get_recent_tool_calls'].includes(name))return deny('Legacy UI/config/history path is disabled');
  if(name==='y_dev_task'){
    try{const plan=planDevTask(a);return allow('Owner-opted trusted developer task: '+plan.task+' in '+plan.cwd+'; no shell, but project code runs as current Windows user');}
    catch(e){return deny(e.message);}
  }
  if(name==='start_process')return commandRisk(a);
  if(['interact_with_process','force_terminate','kill_process'].includes(name))return gate('process',JSON.stringify({tool:name,...a},null,2),'Process input/termination requires local consent');
  if(name==='job_submit'||name==='run_trusted_workflow'){
    if(!Array.isArray(a.argv)||!a.argv.length||a.argv.length>100||a.argv.some(x=>typeof x!=='string'||x.length>12000||/[\r\n\x00]/.test(x)))return deny('Invalid job argv');
    const t=route(a.cwd);if(t.permission==='private'||t.permission==='vault')return deny('Protected job cwd');
    if(highRiskCommand(argvRiskText(a.argv)))return gate('system-maintenance',JSON.stringify({cwd:a.cwd,argv:a.argv}),'Known destructive or privilege-sensitive job requires verified human authorization');
    if(t.permission==='project')return allow('Ordinary project background job; native Windows ACL and Job Object limits apply');
    if(config.blacklistDefaultAllow)return allow('Owner default-allow job; no explicit blacklist signal; current Windows permissions apply');
    if(workflow(a))return {...allow('Owner-configured workflow matches cwd, argv and reviewed file hashes'),workflow:true};
    return gate('job',JSON.stringify({argv:a.argv,cwd:a.cwd,releaseOutput:true},null,2),'Start a durable job; its bounded logs/results will be readable by this private owner instance',{cwd:a.cwd,targets:[t.target]});
  }
  if(name==='download_file')return route(a.destination).permission==='project'?allow('Bounded HTTPS official-source file download; never executes it'):deny('Download target must be inside ordinary owner-allowed folders');
  if(name==='verify_checksum')return authorizeImpl('read_file',{path:a.path},scope);
  if(name==='disk_inspect')return allow('Read-only fixed Windows disk inventory');
  if(name==='inspect_download_status')return scope.ownsJob?allow('Scoped download progress only'):deny('Download output token not owned');
  if(name==='job_cancel')return scope.ownsJob?allow('Cancels only this owner instance approved job'):deny('Job not owned by this deployment');
  if(name==='job_recover')return gate('job-recovery',JSON.stringify({jobId:a.id},null,2),'Release a new output credential for this existing private-owner job; do not restart the process');
  if(name==='job_tail')return scope.ownsJob?allow('Output scope from original job approval'):deny('No approved job output scope');
  if(['job_status','job_list','call_status','call_result','recent_calls','y_ping','y_policy','y_pending_approvals','y_workstation_health'].includes(name))return allow('Private single-owner status');
  if(['read_process_output','get_more_search_results','stop_search'].includes(name))return scope.ownsSession?allow('Output belongs to a request issued by this bridge process'):deny('Unscoped or stale process/search ID');
  if(['get_config','list_sessions','list_processes','list_searches','get_usage_stats'].includes(name))return allow('Read-only metadata; sanitized upstream');
  const read=['read_file','read_multiple_files','list_directory','get_file_info','start_search'].includes(name);
  const write=['write_file','create_directory','edit_block','move_file','write_pdf'].includes(name);
  if(read||write){
    if(name==='write_pdf')return deny('PDF rendering disabled in RC: vulnerable optional document dependency chain');
    const paths=name==='read_multiple_files'?a.paths:name==='move_file'?[a.source,a.destination]:[name==='edit_block'?a.file_path:a.path];
    if(!Array.isArray(paths)||!paths.length)return deny('Missing paths');
    const targets=paths.map(route);
    if(write&&targets.some(t=>ownWriteRoots.some(r=>within(t.target,r)||within(r,t.target))))return deny('Runtime/config/state or their containing directory cannot be modified via MCP');
    if(targets.some(t=>t.permission==='private')&&(write||paths.some(p=>within(canonical(p),canonical(config.stateDir)))))return deny('Runtime, configuration, approval secrets and state are inaccessible via MCP');
    if(write&&targets.some(t=>t.permission==='vault'))return deny('G: vault is read-only');
    if((read||write)&&paths.some(p=>/\.(pdf|xlsx?|docx?|pptx?|od[stp])$/i.test(p)))return deny('Optional document parsers disabled in hardened RC');
    if(name==='start_search'&&(String(a.pattern??'').length>300||a.literalSearch===false))return deny('Only bounded literal searches are supported in RC');
    if(name==='start_search'&&a.searchType==='content')return gate('filesystem',JSON.stringify({tool:name,...a},null,2),'Recursive content searches may include hidden credentials; releases this query results only');
    if(targets.every(t=>t.permission==='project'||(read&&t.permission==='vault')))return allow('Ordinary project operation in owner-allowed roots');
    return gate('filesystem',JSON.stringify({tool:name,...a},null,2),'Sensitive/outside-root operation',{targets:targets.map(t=>t.target)});
  }
  return deny('Unclassified tool is disabled: '+name);
}
// Owner-selected interim operation mode: do not enqueue any local consent UI.
// This removes human-approval interruptions, not hard-deny security boundaries.
// Protected/system/outside-project operations that used to require consent
// fail closed until a new review mechanism is implemented and tested.
export function authorize(name,args={},scope={}){
 try{
  if(config.readOnlyAutoAllow&&fileReadTools.has(name)){
   const paths=name==='read_multiple_files'?args.paths:[args.path];
   if(!Array.isArray(paths)||!paths.length)return deny('Missing read paths');
   for(const p of paths)canonical(p);
   if(name==='start_search'&&(String(args.pattern??'').length>300||args.literalSearch===false))return deny('Only bounded literal searches are supported');
   return allow('Owner policy: all typed file, directory, search and database reads require no human approval; native ACL applies');
  }
  if(config.readOnlyAutoAllow&&['job_submit','run_trusted_workflow'].includes(name)&&isReadOnlyInvocation({argv:args.argv}))return allow('Parsed read-only PowerShell invocation');
  if(config.rc10Candidate&&name==='interact_with_process'&&highRiskCommand(args.input??''))return gate('process-input',JSON.stringify({pid:args.pid}),'Sensitive interactive process input requires verified human review');
  if(config.rc9Candidate)return authorizeRc9(name,args,scope);
  const baseline=authorizeImpl(name,args,scope);
  if(config.localApprovalDisabled===true&&baseline.decision==='approve'){
   const routes=baseline.targets??[];
   const trustedProject=routes.length>0&&routes.every(t=>projectRoots.some(r=>within(t,r)));
   const ordinaryFile=['read_file','read_multiple_files','list_directory','get_file_info','start_search','write_file','edit_block','create_directory','move_file'].includes(name);
   // Safe project operations and explicitly scoped sessions run without any
   // application-owned approval queue, popup or in-chat iframe.
   if(ordinaryFile&&trustedProject)return allow('Owner mode: project file operation, no local prompt');
   if(name==='start_process'&&trustedProject)return allow('Owner mode: project terminal command, no local prompt');
   if(['job_submit','run_trusted_workflow'].includes(name)&&trustedProject)return allow('Owner mode: trusted-root durable job, no local prompt');
   if(['interact_with_process','force_terminate','kill_process'].includes(name)&&scope.ownsSession)return allow('Owner mode: already scoped local process, no local prompt');
   return deny('No local approval mechanism is active; operation is outside the trusted development boundary');
  }
  return applyProfile(name,args,baseline,{mode:currentPermissionMode()});
 }catch(e){return deny(e.message);}
}

// The RC9 pilot is private-owner only; review entries never execute while the
// trusted ChatGPT click channel remains unverified. Parsing arbitrary scripts
// cannot prove their effects, so only typed developer jobs auto-execute.
function authorizeRc9(name,a={},scope={}){
  const baseline=authorizeImpl(name,a,scope);
  if(['y_backup_list','y_backup_diff','y_backup_restore','y_backup_accept'].includes(name)){
    if(name==='y_backup_accept')return gate('backup-cleanup',JSON.stringify({backupId:a.id}),'Only verified owner acceptance can permit backup cleanup');
    return allow('Protected backup inventory and conflict-aware restore');
  }
  if(['download_file','job_submit','run_trusted_workflow','y_dev_task'].includes(name))return baseline;
  if(name==='start_process'){
    if(baseline.decision==='deny' && /Physical disk\/startup\/admin actions/.test(baseline.reason))
      return gate('device',JSON.stringify({command:a.command,cwd:a.cwd??a.workingDirectory}),
        'Device/boot/admin operation requires a device-specific plan and verified ChatGPT approval');
    return baseline;
  }
  if(['interact_with_process','force_terminate','kill_process'].includes(name)&&scope.ownsSession)
    return allow('Identity-checked process control for a YGPT-issued session');
  if(baseline.decision==='deny')return baseline;
  if(['read_file','read_multiple_files','list_directory','get_file_info','start_search','write_file','edit_block','move_file','create_directory'].includes(name)){
    const isRead=['read_file','read_multiple_files','list_directory','get_file_info','start_search'].includes(name);
    const paths=name==='read_multiple_files'?a.paths:name==='move_file'?[a.source,a.destination]:[name==='edit_block'?a.file_path:a.path];
    if(!Array.isArray(paths)||!paths.length)return deny('Missing target paths');
    const targets=paths.map(route);
    const allClean=targets.every((t,i)=>t.permission!=='vault'&&t.permission!=='private'&&!sensitivePath(canonical(paths[i]))&&!t.system);
    // Ordinary OS diagnostic reads are useful, but broad recursive searches and
    // paths naming known secret stores remain gated.
    if(isRead&&name!=='start_search'&&targets.every((t,i)=>t.permission!=='private'&&t.permission!=='vault'&&!sensitivePath(canonical(paths[i]))))
      return allow('Owner diagnostic read under native Windows ACL, with output filtering');
    // Only explicitly enrolled project roots may be modified automatically.
    // A clean-looking personal folder outside them still needs owner review.
    // In particular, move_file must have BOTH endpoints in a trusted root.
    const projectWrite=config.blacklistDefaultAllow||targets.every(t=>t.permission==='project');
    if(allClean && (isRead || (projectWrite && ['write_file','edit_block','move_file','create_directory'].includes(name))))
      return allow('Ordinary owner file operation; protected pre-write snapshot mandatory');
    return gate('filesystem',JSON.stringify({tool:name,targets:targets.map(t=>t.target)}),
      'Protected, credential-adjacent or system-impacting operation requires verified owner review',
      {targets:targets.map(t=>t.target)});
  }
  if(baseline.decision==='approve')return baseline;
  return applyProfile(name,a,baseline,{mode:currentPermissionMode()});
}
