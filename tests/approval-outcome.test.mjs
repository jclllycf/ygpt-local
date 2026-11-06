import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalOutcome} from '../runtime/approval-outcome.mjs';
import {processFailure} from '../engine/src/process-outcome.mjs';

test('Legacy timeout results recover accurate diagnostics without changing their saved decision',()=>{
 const operation={id:'saved',tool:'y_process_run',state:'failed',kind:'system-maintenance'};
 const ledger={approvalDecision:()=>({decision:'once'}),result:()=>({structuredContent:{result:{state:'timed_out',timedOut:true},error:{code:'PROCESS_EXIT_FAILED',message:'Operation ended with state timed_out'}}})};
 const value=approvalOutcome(ledger,operation);assert.equal(value.permissionGranted,true);assert.equal(value.decisionSaved,true);assert.equal(value.executionError.code,'PROCESS_TIMEOUT');assert.equal(value.executionError.outcomeUnknown,true);assert.match(value.stateLabel,/Approved.*timed out/);
 assert.equal(operation.state,'failed');
 ledger.approvalDecision=()=>null;assert.equal(approvalOutcome(ledger,operation).permissionGranted,false);assert.equal(approvalOutcome(ledger,operation).stateLabel,undefined);
 ledger.approvalDecision=()=>({decision:'deny'});assert.equal(approvalOutcome(ledger,{...operation,state:'denied'}).permissionGranted,false);
});

test('Process outcomes retain uncertain effects for time/output limits and report a completed nonzero exit separately',()=>{
 for(const result of [{state:'timed_out',timeoutMs:16000},{state:'failed',truncated:true},{state:'cancelled'}])assert.equal(processFailure(result).outcomeUnknown,true);
 assert.match(processFailure({state:'timed_out',timeoutMs:16000}).message,/16000 ms/);
 assert.equal(processFailure({state:'failed',ownedPid:42,exitCode:7}).code,'PROCESS_EXIT_FAILED');
 assert.equal(processFailure({state:'succeeded'}),null);
});

test('Failure reporting keeps the original chat grant visible without borrowing another context',()=>{
 const ledger={approvalDecision:()=>({decision:'once'}),result:()=>({structuredContent:{error:{code:'TRASH_FAILED',message:'Windows refused this file operation'}}}),fullAccess:hash=>hash==='original'?{expires:Date.now()+60000}:null};
 const operation={id:'file-fixture',tool:'y_file_trash',state:'unknown',contextHash:'original'};
 assert.equal(approvalOutcome(ledger,operation).chatAccess.active,true);
 assert.equal(approvalOutcome(ledger,{...operation,contextHash:'different'}).chatAccess.active,false);
 assert.equal(approvalOutcome(ledger,operation).contextHash,undefined);
 assert.equal(approvalOutcome(ledger,operation).executionError.code,'TRASH_FAILED');
});
