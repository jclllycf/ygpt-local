// Manual Windows-owner fallback. Reached only through the existing authenticated,
// owner-only named pipe, never from the public MCP catalog or a browser URL.
export function createLocalReview({ledger,onApproved}){
 const nonces=new Map();
 const nonce=operation=>{let token=nonces.get(operation.id);if(!ledger.owns('local_review',operation.id,token)){token=ledger.grant('local_review',operation.id);nonces.set(operation.id,token);}return token;};
 return async payload=>{
  if(payload?.kind==='queue')return {entries:ledger.pending().slice(0,40).map(operation=>({
   id:operation.id,state:operation.state,expiresAt:operation.expiresAt,presentation:operation.presentation,
   chatScope:operation.chatScope,requestDigest:operation.requestDigest,
   nonce:operation.state==='awaiting_user'?nonce(operation):null
  }))};
  if(payload?.kind!=='decision')return {ok:false,code:'UNSUPPORTED_REVIEW_ACTION'};
  const operation=ledger.get(payload.id);
  if(!operation||!ledger.owns('local_review',payload.id,payload.nonce)||payload.requestDigest!==operation.requestDigest)return {ok:false,code:'LOCAL_REVIEW_CAPABILITY_INVALID'};
  if(payload.decision!=='deny'&&operation.contextHash&&!ledger.contextActive(operation.contextHash))return {ok:false,code:'APP_CONTEXT_EXPIRED'};
  const decision=ledger.decideLocal(payload.id,payload.decision,'windows-owner-review');
  if(!decision.ok)return {ok:false,code:'REVIEW_REFUSED',message:decision.reason};
  if(decision.approved&&!decision.reused)setImmediate(()=>onApproved(payload.id,operation.tool,ledger.args(payload.id)).catch(()=>{}));
  return {ok:true,state:decision.operation.state,reused:!!decision.reused};
 };
}
