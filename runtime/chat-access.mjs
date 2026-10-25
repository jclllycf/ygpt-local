// Full Access is a human-approved, revocable capability for one server-issued
// chat context. Neither a tool argument nor host metadata can activate it.
import {FULL_ACCESS_URI} from './inline-approval.mjs';
import {DESKTOP_FULL_ACCESS_MINUTES} from '../engine/src/access-defaults.mjs';
export {DESKTOP_FULL_ACCESS_MINUTES};
export const chatAccessTool={
 name:'y_chat_access',title:'Full Access in this chat',
 description:'Enable Full Access directly inside this ChatGPT conversation: call action=request_full and wait for the owner card click. Set administrator=true only when the user requests the extra Administrator option; after the card it needs Windows UAC on this PC and enables y_admin_run. Normal Full Access never requests UAC. action=status only checks; action=revoke ends the grant and its Administrator executor. Preserve contextToken; other chats stay separate.',
 inputSchema:{type:'object',properties:{action:{type:'string',enum:['status','request_full','revoke'],default:'status'},durationMinutes:{type:'integer',minimum:1,maximum:720,default:120},administrator:{type:'boolean',default:false,description:'Optional Windows Administrator command executor. Requires this chat card plus a separate Windows UAC confirmation; never enabled by ordinary Full Access.'}},additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
 _meta:{ui:{resourceUri:FULL_ACCESS_URI},'openai/outputTemplate':FULL_ACCESS_URI}
};
export const chatAccessGate={decision:'approve',kind:'chat-full-access',reason:'The owner must explicitly enable Full Access for this chat context.'};
export function desktopAccessPresentation(){
 const p=chatAccessPresentation({durationMinutes:DESKTOP_FULL_ACCESS_MINUTES});
 const minutes=DESKTOP_FULL_ACCESS_MINUTES;
 return {...p,displayMode:'inline',title:`Allow desktop control for ${minutes} minutes`,purpose:'Temporarily enable Full Access for this chat so desktop control can finish without repeated approval clicks.',impact:`For ${minutes} minutes this chat can operate desktop windows, read and change files, and run commands without another YGPT approval. Other chats keep their existing permissions. The requested desktop step runs once after you confirm.`,reversible:`Revoke with y_chat_access action=revoke, or close the chat context. Access expires after ${minutes} minutes. Completed actions are not undone.`,approveLabel:`Allow Full Access for ${minutes} minutes`};
}
export function chatAccessPresentation(args={}){
 const minutes=args.durationMinutes??120;
 return {displayMode:'inline',title:args.administrator?'Enable Full Access + Administrator':'Enable Full Access for this chat',target:'This chat only · '+minutes+' minutes',
 purpose:'Let this development chat run all YGPT actions with your current Windows permissions.',
 impact:'While active, this chat can read private files, change files, run commands and operate desktop windows without further YGPT approval. Other chats keep their existing permissions.'+(args.administrator?' Administrator commands can also change protected system files and settings through y_admin_run. Normal file and desktop tools keep their ordinary Windows token.':''),
 denied:'Keep the standard approval rules for this chat.',risk:'Full Access to this Windows user environment',
 reversible:'Revoke with y_chat_access action=revoke, or close the chat context. Completed actions are not undone. Pending requests are not executed by enabling this mode.',
 administrator:args.administrator?'After this card, confirm Windows UAC on this PC. Administrator commands use a temporary executor for this chat only. It closes on expiry, revoke or disconnect. Cancelling UAC keeps ordinary Full Access enabled.':'Current Windows user; no automatic elevation. Resource ownership and path integrity checks still apply.',
 technical:'Capability: current server-issued chat context only\nDuration: '+minutes+' minutes\nAutomatic execution of pending approvals: no',
 approveLabel:args.administrator?'Enable Full Access + Administrator':'Enable Full Access'};
}
export function chatAccessStatus(ledger,contextHash){
 const grant=contextHash?ledger.fullAccess(contextHash):null;
 return {mode:grant?'full':'standard',scope:'this-chat',active:!!grant,expiresAt:grant?new Date(grant.expires).toISOString():null,
  contextRequired:!contextHash,windowsElevation:false,requiresWindowsUi:false,activationLocation:'this-conversation',...(!grant?{nextAction:{tool:'y_chat_access',arguments:{action:'request_full'},message:'If the user asked to enable Full Access, call request_full now. It returns a confirmation card in this chat; do not redirect them to Windows settings.'}}:{}),message:grant?'Full Access is active for this chat. Include its original contextToken. Revoke with y_chat_access action=revoke.':'Standard mode: reads and ordinary changes run automatically. To enable Full Access here, request it with y_chat_access action=request_full and confirm the returned chat card.'};
}
export function chatAccessStatusMetadata(status){return {yBar:{requestId:'ACCESS_STATUS',uiToken:'',state:status.active?'succeeded':'not_found',stateLabel:status.active?'Full Access active':'Standard mode',enabled:false,presentation:{title:status.active?'Full Access is active':'Chat access mode',target:status.active?'This chat only · expires '+status.expiresAt:'This chat only',impact:status.message,purpose:'Check or change YGPT permissions in this conversation.',technical:'Activation: y_chat_access action=request_full\nRevocation: y_chat_access action=revoke'},note:status.active?'This chat can continue without further YGPT approvals until the displayed expiry.':'Ask to enable Full Access; the confirmation appears in this conversation. Windows settings are not required.'}};}
