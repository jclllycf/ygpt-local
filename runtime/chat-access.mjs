// Full Access is a human-approved, revocable capability for one server-issued
// chat context. Neither a tool argument nor host metadata can activate it.
export const chatAccessTool={
 name:'y_chat_access',title:'Chat access mode',
 description:'Check this chat access mode, request Full Access for development, or revoke it. Full Access requires the owner to click its dedicated approval card once. Retain this chat contextToken on every later call. It never grants another chat access, replays pending actions, or elevates Windows permissions.',
 inputSchema:{type:'object',properties:{action:{type:'string',enum:['status','request_full','revoke'],default:'status'},durationMinutes:{type:'integer',minimum:1,maximum:720,default:120}},additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}
};
export const chatAccessGate={decision:'approve',kind:'chat-full-access',reason:'The owner must explicitly enable Full Access for this chat context.'};
export function chatAccessPresentation(args={}){
 const minutes=args.durationMinutes??120;
 return {title:'Enable Full Access for this chat',target:'This chat only · '+minutes+' minutes',
 purpose:'Let this development chat run all YGPT actions with your current Windows permissions.',
 impact:'While active, this chat can read private files, change files, run commands and operate desktop windows without further YGPT approval. Other chats keep their existing permissions.',
 denied:'Keep the standard approval rules for this chat.',risk:'Full Access to this Windows user environment',
 reversible:'Revoke with y_chat_access action=revoke, or close the chat context. Completed actions are not undone. Pending requests are not executed by enabling this mode.',
 administrator:'Current Windows user; no automatic elevation. Resource ownership and path integrity checks still apply.',
 technical:'Capability: current server-issued chat context only\nDuration: '+minutes+' minutes\nAutomatic execution of pending approvals: no',
 approveLabel:'Enable Full Access'};
}
export function chatAccessStatus(ledger,contextHash){
 const grant=contextHash?ledger.fullAccess(contextHash):null;
 return {mode:grant?'full':'standard',scope:'this-chat',active:!!grant,expiresAt:grant?new Date(grant.expires).toISOString():null,
  contextRequired:!contextHash,windowsElevation:false,message:grant?'Full Access is active for this chat. Include its original contextToken. Revoke with y_chat_access action=revoke.':'Standard mode: reads and ordinary changes run automatically; sensitive or major changes require review.'};
}
