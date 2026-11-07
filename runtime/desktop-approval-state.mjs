// Consent to the temporary chat grant and the selected desktop step have
// independent outcomes. This reports ledger state; it never creates a grant.
export function desktopApprovalState(ledger,operation){
 if(operation?.kind!=='desktop-full-access')return {};
 const grant=ledger.fullAccess(operation.contextHash),active=grant?.operation_id===operation.id;
 return {desktopAccess:{active,scope:'this-chat',expiresAt:active?new Date(grant.expires).toISOString():null},...(active?{stateLabel:'Access granted'}:{})};
}
export async function desktopApprovalResult(ledger,operation,response,readWindows){
 const status=desktopApprovalState(ledger,operation);if(!status.desktopAccess)return response;
 const value={...response.structuredContent,...status},code=value.error?.code??value.code;
 if(status.desktopAccess.active&&['DESKTOP_TARGET_STALE','NO_WINDOW','NO_TARGET','PROCESS_IDENTITY_CHANGED','EXECUTION_TARGET_CHANGED'].includes(code)){
  value.recovery={tool:'y_desktop_windows',selectCurrentWindow:true,requiresNewApproval:false,repeatOriginalAction:false};
  // Inventory is read-only. Never guess a replacement HWND or replay input.
  if(readWindows)try{const current=await readWindows();value.recovery.inventory={...current,observedAt:new Date().toISOString()};}catch(e){value.recovery.inventoryError={code:e.code??'WINDOW_INVENTORY_UNAVAILABLE',message:'Current window inventory is unavailable. Read y_desktop_windows again; no input was sent.'};}
  value.message='Full Access was enabled for this chat, but the reviewed window is no longer current. Read y_desktop_windows, then bind the intended current window using the same contextToken. No new YGPT approval is needed while this grant is active. The old desktop step was not replayed; never select a replacement window automatically.';
  // A bind has no input effect. The grant succeeds even if its earlier HWND
  // disappeared. Failed/uncertain clicks and keystrokes remain failures.
  const skippedBind=operation.tool==='y_desktop_bind'&&value.error?.outcomeUnknown!==true&&(value.executed===false||['NO_WINDOW','PROCESS_IDENTITY_CHANGED'].includes(code));
  if(skippedBind){
   value.desktopStep={state:'not_executed',code,error:value.error};
   delete value.error;delete value.code;
   Object.assign(value,{ok:true,state:'succeeded',executed:false,bindingRequired:true,requiresUserInteraction:false,
    nextAction:{tool:value.recovery.inventory?.windows?.length?'y_desktop_bind':'y_desktop_windows',reuseOriginalContext:true,selectFromCurrentWindows:true,requiresNewApproval:false},
    message:'Full Access is enabled for 100 minutes in this chat. No window was bound and no desktop input was sent: the earlier window disappeared while awaiting consent. Continue the task now using the original contextToken: select the intended current window from recovery.inventory (or read y_desktop_windows if unavailable), then bind its current hwnd. This fresh binding needs no new approval. Never replay an old input action or choose an unrelated window.'});
   return {...response,isError:false,structuredContent:value,content:[...(response.content??[]).filter(c=>c.type!=='text'),{type:'text',text:JSON.stringify(value)}]};
  }
 }
 return {...response,structuredContent:value,content:[...(response.content??[]).filter(c=>c.type!=='text'),{type:'text',text:JSON.stringify(value)}]};
}
