// YGPT permission profiles, V2. Every tool call is subject to baseline hard-deny guards.
// This module never accepts model-provided approvals as authority.
export const modes = Object.freeze(['autonomous','balanced','secure']);
export const DEFAULT_MODE = 'balanced';
export function normalizeMode(value){
  return modes.includes(value)?value:DEFAULT_MODE;
}
export const descriptions=Object.freeze({
  autonomous:'Auto-run ordinary project file edits and owner-trusted, typed developer jobs; review shell/system/private operations.',
  balanced:'Auto-run ordinary project reads/writes; require review for new shell commands and process control.',
  secure:'Auto-run ordinary project reads only; require review for project modifications, shell/process and other sensitive operations.'
});
const projectWrites=new Set(['write_file','create_directory','edit_block','move_file']);
const projectReads=new Set(['read_file','read_multiple_files','list_directory','get_file_info','start_search']);
const alwaysSensitive=new Set(['start_process','interact_with_process','force_terminate','kill_process','job_submit','job_recover','run_trusted_workflow']);
export function applyProfile(name,args,baseline,options={}){
  const mode=normalizeMode(options.mode);
  if(!baseline||!['allow','approve','deny'].includes(baseline.decision))return {decision:'deny',reason:'Unclassified baseline decision'};
  // Existing hard-deny policy (credentials, runtime state, physical disk) always wins.
  if(baseline.decision==='deny')return baseline;
  // Existing path/command hardening always wins; never downgrade a required
  // approval just because the model requested autonomous mode.
  if(baseline.decision==='approve')return baseline;
  if(mode==='secure'&&projectWrites.has(name)){
    return {decision:'approve',kind:'filesystem',summary:JSON.stringify({tool:name,...args}).slice(0,3000),
      reason:'Secure mode: human confirmation for project changes',
      privilege:'Current Windows user; no elevation',reversibility:'Review modification before execution'};
  }
  if((mode==='secure'||(mode==='balanced'&&name==='y_dev_task'&&!['git-status','git-diff','git-log'].includes(args?.task)))&&name==='y_dev_task'){
    return {decision:'approve',kind:'job',summary:JSON.stringify({tool:name,...args}).slice(0,3000),
      reason:'Secure mode: local consent for trusted code execution',
      privilege:'Current Windows user; no elevation',reversibility:'Project scripts may have side effects'};
  }
  // Neither the model's subjective judgement nor a per-call flag may elevate.
  if(alwaysSensitive.has(name)&&name!=='y_dev_task')return baseline;
  return baseline;
}
export function profileSummary(mode){
  const id=normalizeMode(mode);return {mode:id,description:descriptions[id],supported:modes,modelCanSelfApproveSystemChanges:false,systemChangesNeedHuman:true};
}
