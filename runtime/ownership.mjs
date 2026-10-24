// Per-conversation resource ownership. The owner of a resource is the chat
// context (server-issued capability) that created it. IDs supplied by the model
// (tabId, targetId, sessionId, job id, PID) only NAME a resource; the server-side
// owner record decides whether the calling context may use it.
import {AsyncLocalStorage} from 'node:async_hooks';
export const callScope=new AsyncLocalStorage();
export const currentOwner=()=>callScope.getStore()?.context?.hash??null;
export const currentAccessMode=()=>{const mode=callScope.getStore()?.accessMode;return typeof mode==='function'?mode():mode??'standard';};
// The broker's call record for this tool call; the engine reuses it.
export const currentCall=()=>callScope.getStore()?.callId??null;
const pick=(kind,id)=>({kind,id:id===undefined||id===null?'':String(id)});
// Classify a call by the owned resource it creates, uses or lists. Volatile
// kinds (browser, desktop, session) are enforced by the engines themselves;
// durable jobs are enforced by the broker ledger.
export function resourceIntent(name,a={}){
 if(name==='y_chat_access')return a.action==='request_full'?{creates:'chat-access'}:{lists:'any'};
 // Selecting a daily profile is already owned state, before any tab opens.
 // Mint the chat context here so the next open uses that same selection.
 if(name==='y_browser_open'||name==='y_browser_attach')return {creates:'browser'};
 if(name==='y_browser_tabs'||name==='y_browser_detach')return {lists:'browser'};
 if(/^y_browser_(?:snapshot|navigate|action|wait|screenshot|download|close)$/.test(name))return {uses:pick('browser',a.tabId)};
 if(name==='y_desktop_bind')return {creates:'desktop'};
 if(/^y_desktop_(?:inspect|value|action|screenshot)$/.test(name))return {uses:pick('desktop',a.targetId)};
 if(name==='y_process_start'||name==='y_process_run')return {creates:'session'};
 if(name==='y_process_list')return {lists:'session'};
 if(/^y_process_(?:poll|input|cancel)$/.test(name))return {uses:pick('session',a.sessionId)};
 if(['y_job_submit','y_dev_task','y_download_file'].includes(name))return {creates:'job'};
 if(name==='y_job_list')return {lists:'job'};
 if(['y_job_status','y_job_logs','y_job_cancel'].includes(name))return {uses:pick('job',a.id)};
 if(['y_resource_owner','y_pending_approvals'].includes(name))return {lists:'any'};
 return {};
}
// Broker-enforced kinds. Engines enforce browser/desktop/session ownership
// because only they know about popups and child targets.
export const LEDGER_KINDS=new Set(['job']);
export function ledgerEnforced(name,intent){return !!intent.uses&&LEDGER_KINDS.has(intent.uses.kind);}
// Decide whether the calling context may use a ledger-tracked resource.
// Jobs created before ownership existed have no owner row; they keep the older
// output-token check only, and are reported as unattributed.
export function ownershipViolation(ledger,name,intent,contextHash){
 if(!ledgerEnforced(name,intent))return null;
 const {kind,id}=intent.uses,owner=ledger.ownerOf(kind,id);
 if(owner===null&&kind==='job')return null;
 if(owner!==null&&owner===contextHash)return null;
 return {state:'rejected',executed:false,code:'SESSION_FOREIGN',resource:{kind,id},message:'SESSION_FOREIGN: this '+kind+' is not owned by the calling chat context. Include the contextToken returned when it was created; another conversation cannot use it, even with its ID or output token.'};
}
// Extract the identifier of a resource that a successful call created.
export function createdId(kind,result){
 const v=result?.structuredContent??result??{},r=v.result??v;
 if(kind==='job')return r.job_id??v.job_id??null;
 if(kind==='browser')return r.tabId??null;
 if(kind==='desktop')return r.targetId??null;
 if(kind==='session')return r.sessionId??null;
 return null;
}
