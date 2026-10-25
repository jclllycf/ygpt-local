// Full Access is a human-approved, revocable capability for one server-issued
// chat context. Neither a tool argument nor host metadata can activate it.
import {BAR_URI} from './inline-approval.mjs';
export const chatAccessTool={
 name:'y_chat_access',title:'Full Access in this chat',
 description:'Enable Full Access directly inside this ChatGPT conversation: when the user asks for Full Access, call action=request_full to return its in-chat confirmation card, then wait for their click. No Windows settings or local permissions window is required. action=status only checks; it does not request activation. action=revoke disables this chat grant. Preserve contextToken on later calls; other chats stay separate.',
 inputSchema:{type:'object',properties:{action:{type:'string',enum:['status','request_full','revoke'],default:'status'},durationMinutes:{type:'integer',minimum:1,maximum:720,default:120}},additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
 _meta:{ui:{resourceUri:BAR_URI},'openai/outputTemplate':BAR_URI}
};
export const chatAccessGate={decision:'approve',kind:'chat-full-access',reason:'The owner must explicitly enable Full Access for this chat context.'};
export const DESKTOP_FULL_ACCESS_MINUTES=10;
export function desktopAccessPresentation(){
 const p=chatAccessPresentation({durationMinutes:DESKTOP_FULL_ACCESS_MINUTES});
 return {...p,title:'Allow desktop control for 10 minutes',purpose:'Temporarily enable Full Access for this chat so desktop control can finish without repeated approval clicks.',impact:'For 10 minutes this chat can operate desktop windows, read and change files, and run commands without another YGPT approval. Other chats keep their existing permissions. The requested desktop step runs once after you confirm.',reversible:'Revoke with y_chat_access action=revoke, or close the chat context. Access expires after 10 minutes. Completed actions are not undone.',approveLabel:'Allow Full Access for 10 minutes'};
}
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
  contextRequired:!contextHash,windowsElevation:false,requiresWindowsUi:false,activationLocation:'this-conversation',...(!grant?{nextAction:{tool:'y_chat_access',arguments:{action:'request_full'},message:'If the user asked to enable Full Access, call request_full now. It returns a confirmation card in this chat; do not redirect them to Windows settings.'}}:{}),message:grant?'Full Access is active for this chat. Include its original contextToken. Revoke with y_chat_access action=revoke.':'Standard mode: reads and ordinary changes run automatically. To enable Full Access here, request it with y_chat_access action=request_full and confirm the returned chat card.'};
}
export function chatAccessStatusMetadata(status){return {yBar:{requestId:'ACCESS_STATUS',uiToken:'',state:status.active?'succeeded':'not_found',stateLabel:status.active?'Full Access active':'Standard mode',enabled:false,presentation:{title:status.active?'Full Access is active':'Chat access mode',target:status.active?'This chat only · expires '+status.expiresAt:'This chat only',impact:status.message,purpose:'Check or change YGPT permissions in this conversation.',technical:'Activation: y_chat_access action=request_full\nRevocation: y_chat_access action=revoke'},note:status.active?'This chat can continue without further YGPT approvals until the displayed expiry.':'Ask to enable Full Access; the confirmation appears in this conversation. Windows settings are not required.'}};}
