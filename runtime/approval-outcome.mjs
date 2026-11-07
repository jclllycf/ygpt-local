import {processFailure} from '../engine/src/process-outcome.mjs';
import {scrub} from './durable.mjs';

export function approvalOutcome(ledger,operation){
 if(!operation)return {};
 const decision=ledger.approvalDecision(operation.id),response=ledger.result(operation.id)?.structuredContent;
 const processError=operation.tool==='y_process_run'?processFailure(response?.result):null;
 const error=processError??response?.error??(response?.code?{code:response.code,message:response.message}:null);
 const granted=decision?.decision==='once'||decision?.decision==='chat';
 const access=ledger.fullAccess?.(operation.contextHash);
 const failed=['failed','unknown'].includes(operation.state);
 return {tool:operation.tool,operationKind:operation.kind,decisionSaved:!!decision,permissionGranted:granted,chatAccess:{active:!!access,scope:'this-chat',expiresAt:access?new Date(access.expires).toISOString():null},
  ...(response?.bindingRequired?{bindingRequired:true,desktopStep:response.desktopStep}:{}),
  ...(failed&&granted?{stateLabel:error?.code==='PROCESS_TIMEOUT'?'Approved · command timed out':operation.state==='unknown'?'Approved · check result':'Approved · action failed'}:{}),
  ...(error?{executionError:{code:error.code,message:scrub(error.message??'').slice(0,700),outcomeUnknown:error.outcomeUnknown===true}}:{})};
}
