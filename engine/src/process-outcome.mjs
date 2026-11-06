// A command's execution deadline is independent of the owner's permission.
// Partial effects after a timeout must never be presented as safe to replay.
export function processFailure(result){
 if(!result||result.state==='succeeded')return null;
 const timeout=result.timedOut||result.state==='timed_out';
 if(timeout||result.truncated||result.state==='cancelled')return {
  code:timeout?'PROCESS_TIMEOUT':result.truncated?'PROCESS_OUTPUT_LIMIT':'PROCESS_CANCELLED',
  message:timeout?'Command reached its execution time limit'+(result.timeoutMs?' ('+result.timeoutMs+' ms)':'')+'.':result.truncated?'Command exceeded its output limit.':'Command was cancelled.',
  effectStarted:true,outcomeUnknown:true,
  recovery:{tool:'y_process_poll',reuseSession:true,repeatOriginalAction:false}
 };
 return {code:'PROCESS_EXIT_FAILED',message:result.error||'Command exited with code '+result.exitCode+'.',effectStarted:!!result.ownedPid};
}
