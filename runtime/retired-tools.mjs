// Names removed from the public catalog in the chat-only upgrade. They are NOT
// aliases: a call with one of them executes nothing and returns NO_TOOL with
// the replacement below, so an old cached chat can switch to the canonical API.
// docs/UPGRADE_TOOL_MAPPING.md is the human-readable version of this table.
export const RETIRED=Object.freeze({
 y_local_get_config:['y_ping','Health and catalog; y_policy shows roots and protections'],
 y_local_read_file:['y_file_read',''],
 y_local_read_multiple_files:['y_file_read_many','Per-file limits, partial failures and SHA-256 per file'],
 y_local_write_file:['y_file_write','Use expectedSha256 from your last read'],
 y_local_create_directory:['y_file_mkdir',''],
 y_local_list_directory:['y_file_list',''],
 y_local_move_file:['y_file_move',''],
 y_local_get_file_info:['y_file_info',''],
 y_local_edit_block:['y_file_edit','Or y_file_patch for several hunks or a unified diff'],
 y_local_start_search:['y_search_text','y_search_files for names; results return inline with offset paging'],
 y_local_get_more_search_results:['y_search_text','Repeat the search with offset'],
 y_local_stop_search:['y_search_text','Searches finish within their own time bound; nothing to stop'],
 y_local_list_searches:['y_search_text','Searches are not kept as sessions'],
 y_local_start_process:['y_process_start','Typed executable + argv instead of a shell string; y_process_run waits for completion'],
 y_local_read_process_output:['y_process_poll',''],
 y_local_interact_with_process:['y_process_input',''],
 y_local_force_terminate:['y_process_cancel','Only sessions this chat started'],
 y_local_kill_process:['y_process_cancel','Only sessions this chat started; arbitrary PIDs are never signalled'],
 y_local_list_sessions:['y_process_list',''],
 y_local_list_processes:['y_process_list','y_system_inspect kind=processes for a read-only system list'],
 y_local_get_usage_stats:['y_usage_report',''],
 y_task_submit:['y_job_submit','executable + args + cwd; pass a fresh UUID as id'],
 y_task_status:['y_job_status',''],
 y_task_tail:['y_job_logs',''],
 y_task_cancel:['y_job_cancel',''],
 y_task_list:['y_job_list',''],
 y_task_recover:['y_job_status','A lost response is recovered with y_call_status / y_call_result; jobs are never re-run'],
 y_run_trusted_workflow:['y_job_submit','Owner workflow hashes are still honoured by the job policy'],
 y_inspect_download_status:['y_job_status','Download byte progress is part of the job status'],
 y_disk_inspect:['y_system_inspect','kind=physical-disks'],
 y_workstation_health:['y_system_inspect','kind=health'],
 y_service_health:['y_ping',''],
 y_permission_mode:['y_policy',''],
 y_engine_history:['y_recent_calls','y_usage_report for statistics'],
 y_review_approval:['y_show_approval','Pass requestId, resultToken and contextToken']
});
export function retiredTool(name){
 if(typeof name!=='string')return null;
 // yuki_* and unprefixed Desktop Commander names were routed to y_ names before.
 const n=name.startsWith('yuki_')?'y_'+name.slice(5):name;
 const hit=RETIRED[n]??RETIRED['y_local_'+n];
 if(hit)return {replacement:hit[0],note:hit[1]||undefined};
 return n!==name?{replacement:n,note:'yuki_ names are retired; use the y_ name'}:null;
}
