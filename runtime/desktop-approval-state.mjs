// Consent to the temporary chat grant and the selected desktop step have
// independent outcomes. This reports ledger state; it never creates a grant.
export function desktopApprovalState(ledger,operation){
 if(operation?.kind!=='desktop-full-access')return {};
 const grant=ledger.fullAccess(operation.contextHash),active=grant?.operation_id===operation.id;
 return {desktopAccess:{active,scope:'this-chat',expiresAt:active?new Date(grant.expires).toISOString():null},...(active?{stateLabel:'Access granted'}:{})};
}
export function desktopApprovalResult(ledger,operation,response){
 const status=desktopApprovalState(ledger,operation);if(!status.desktopAccess)return response;
 const value={...response.structuredContent,...status},code=value.error?.code??value.code;
 if(status.desktopAccess.active&&['DESKTOP_TARGET_STALE','NO_WINDOW','NO_TARGET','PROCESS_IDENTITY_CHANGED','EXECUTION_TARGET_CHANGED'].includes(code)){
  value.recovery={tool:'y_desktop_windows',selectCurrentWindow:true,requiresNewApproval:false,repeatOriginalAction:false};
  value.message='Full Access was enabled for this chat, but the reviewed window is no longer current. Read y_desktop_windows, then bind the intended current window using the same contextToken. No new YGPT approval is needed while this grant is active. The old desktop step was not replayed; never select a replacement window automatically.';
 }
 return {...response,structuredContent:value,content:[...(response.content??[]).filter(c=>c.type!=='text'),{type:'text',text:JSON.stringify(value)}]};
}
