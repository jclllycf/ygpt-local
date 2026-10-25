import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {config,RUNTIME,INSTALL} from './config.mjs';
// New resource URI forces hosts to fetch the revised CSP and bridge bundle.
export const BAR_URI='ui://ygpt/approval/strip-v11-inline-wait.html';
export const FULL_ACCESS_URI='ui://ygpt/access/full-v2-inline.html';
// The prior ChatGPT tool catalog can retain this URI across conversations.
// Serve the NEW strip at this legacy address rather than the retired large card.
export const LEGACY_BAR_URI='ui://ygpt/approval/card-v1.html';
// RC10 read-only MCP App surface. Never returns a decision capability until host attestation is proven.
export const INSPECTION_URI=config.chatAppConsent?BAR_URI:'ui://ygpt/approval/inspection-v1.html';
// Resource addresses are protocol identifiers, not display branding. Old chats
// retain these exact addresses and must still receive the current component.
const knownResources=[BAR_URI,FULL_ACCESS_URI,'ui://ygpt/approval/strip-v10-context-recovery.html','ui://ygpt/access/full-v1.html','ui://ygpt/approval/strip-v9-access-options.html','ui://ygpt/approval/strip-v8-desktop-flow.html',LEGACY_BAR_URI,INSPECTION_URI,'ui://ygpt/approval/strip-v5.html','ui://ygpt/approval/compact-v1-rc2.html','ui://ygpt/approval/strip-v4-rc18.html','ui://ygpt/approval/strip-v3.html',...['compact-v11-3','interactive-v11-2c','interactive-v11-2b','interactive-v11-2','interactive-v11-1','interactive-v11','inspection-v1'].map(n=>'ui://ygpt/approval/'+n+'.html')];
export const approvalGuidance='Show one fresh inline approval card for this request at the current conversation step, with details collapsed. Do not open a side panel or reuse an earlier request card. Immediately call y_wait_approval with the original requestId, resultToken and contextToken. While continueWaiting or taskPending is true, call y_wait_approval again with those same arguments; a bounded wait timeout is not task completion. Do not send a final answer saying approved work is blocked, finished or needs a new user message merely because a decision is pending. After the decision, continue the original task from its existing result without repeating the action. If the host ended the response, the card sends one continuation notification when no wait is active. The host controls exact card placement and whether cards mount during generation; do not promise to override that. Only an explicit card or local-center decision grants permission.';
export function approvalTaskState(state){
 const pending=['awaiting_user','approved','running'].includes(state);
 return {taskPending:pending,requiresUserInteraction:state==='awaiting_user',continueWaiting:pending,...(pending?{shouldEndTurn:false,nextAction:{tool:'y_wait_approval',reuseOriginalArguments:true,waitMs:25000}}:{})};
}
export function approvalResourceUris(){
 const modern=config.rc10Candidate?knownResources:!config.rc9Candidate&&uiEnabled()?(barEnabled()?[BAR_URI,LEGACY_BAR_URI]:[BAR_URI]):[];
 return [...new Set([...modern,...(modern.length?['ui://ygpt/approval/strip-v6-cross-device.html','ui://ygpt/approval/strip-v7-chat-access.html']:[])])];
}
export function chatApprovalResult(ledger,args={}){
 let operation=args.requestId?ledger.get(args.requestId):null;
 let context,expiredContext=false;
 if(args.contextToken)try{context=ledger.context(args.contextToken);}catch{expiredContext=true;}
 if(!operation&&context&&!args.requestId)operation=ledger.pending().find(o=>o.state==='awaiting_user'&&o.contextHash===context.hash);
 const matched=!!operation&&!!context&&operation.contextHash===context.hash;
 if(operation&&!matched){
  const receipt=ledger.canRead(operation.id,args.resultToken),code=!receipt?'APPROVAL_RECEIPT_REQUIRED':expiredContext?'APPROVAL_CONTEXT_EXPIRED':context?'APPROVAL_CONTEXT_MISMATCH':'APPROVAL_CONTEXT_REQUIRED';
  const message=receipt?'This approval cannot accept a decision because its original chat context is missing, different or expired. Refresh y_show_approval with the original requestId, resultToken and contextToken from this conversation. Do not ask the user to click this unavailable card, keep polling it, invent a new context, or repeat the desktop action. If the original context cannot be recovered, the owner can resolve the saved request in the Windows approval center.':'The original request resultToken is required before this approval can be displayed. No decision was enabled.';
  const value={requestId:receipt?operation.id:'NONE',state:receipt?'context_required':'request_unavailable',code,executed:false,approvalEnabled:false,requiresOriginalChatContext:true,requiresUserInteraction:false,continueWaiting:false,renderer:'mcp-app',recovery:{tool:'y_show_approval',requiredOriginalArguments:['requestId','resultToken','contextToken'],fallback:'Windows approval center; owner decision only',repeatOriginalAction:false},message};
  if(receipt)ledger.event(operation.id,'approval_context_required',expiredContext?'expired-context':context?'wrong-context':'missing-context');
  return {isError:true,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,_meta:{yBar:{...value,instanceId:'ygpt-approval-recovery-'+randomUUID(),uiToken:'',presentation:{title:'Refresh this approval',target:'Original chat context required',impact:'This card is unavailable. The original operation remains saved; no action was executed.',purpose:message,technical:code},chatScope:{eligible:false},enabled:false,note:'Ask ChatGPT to refresh this approval with the original chat context. If it is lost, use the Windows approval center. No action was executed.'}}};
 }
 const enabled=barEnabled()&&matched&&operation.state==='awaiting_user'&&Date.parse(operation.expiresAt)>Date.now();
 const value={requestId:operation?.id??'NONE',state:operation?.state??'not_found',approvalEnabled:enabled,requiresOriginalChatContext:!!operation&&!matched,...approvalTaskState(operation?.state),renderer:'mcp-app',message:approvalGuidance};
 const presentation=operation?.presentation??{title:'No request to review',target:'No pending operation selected',impact:'No command or file change will run.',purpose:'Pass a pending requestId and its original contextToken.',denied:'Nothing changes.',risk:'None',reversible:'No operation',administrator:'No elevation',technical:''};
 // Keep the capability exclusively in the host-to-app metadata channel.
 return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,_meta:{yBar:{...value,instanceId:'ygpt-approval-'+value.requestId+'-'+randomUUID(),uiToken:barEnabled()&&matched?ledger.grant('ui',operation.id):'',presentation:{...presentation,displayMode:'inline'},chatScope:operation?.chatScope??{eligible:false,explanation:'No conversation grant available.'},expiresAt:operation?.expiresAt??null,enabled,demo:false,note:matched?'':operation?'Use the pending request and original contextToken from the chat that created it. Do not repeat the action.':'No pending request.'}}};
}
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
export const barTools=[
 {name:'y_show_approval',title:'Review local action',description:'Display a fresh approval card using the ORIGINAL requestId, resultToken and contextToken returned together in this chat. Do not substitute a newer browser context. If approvalEnabled is false or APPROVAL_CONTEXT_* is returned, recover the original context or guide the owner to the Windows approval center; do not tell them to click disabled buttons or keep waiting. With an enabled card, use bounded y_wait_approval and retrieve the existing result without repeating the action.',inputSchema:{type:'object',properties:{requestId:{type:'string'},resultToken:{type:'string'},contextToken:{type:'string'}},required:['requestId','resultToken',...(config.chatAppConsent?['contextToken']:[])],additionalProperties:false},_meta:{ui:{resourceUri:BAR_URI},'openai/outputTemplate':BAR_URI},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 ...['decide','status'].map(action=>({name:'y_bar_'+action,description:'UI-only '+action+'; requires a widget-only one-request capability.',inputSchema:{type:'object',properties:{requestId:{type:'string'},uiToken:{type:'string'},...(action==='decide'?{decision:{type:'string',enum:['once','chat','deny']}}:{notifyAction:{type:'string',enum:['claim','retry','sent','uncertain']},deliveryToken:{type:'string',maxLength:128}})},required:['requestId','uiToken',...(action==='decide'?['decision']:[])],additionalProperties:false},_meta:{ui:{visibility:['app']},'openai/visibility':'private','openai/widgetAccessible':true},annotations:{readOnlyHint:action==='status',destructiveHint:action==='decide',openWorldHint:false}}))
];
// Safe production renderer probe: never issues an operation capability.
export const previewTool={
 name:'y_preview_approval_ui',
 title:'YGPT approval preview',
 description:'Display a harmless PREVIEW of the compact YGPT in-chat permission panel. Does not request or grant any permission or modify local files.',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 _meta:{ui:{resourceUri:BAR_URI},'openai/outputTemplate':BAR_URI},
 annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
};
export function previewResult(){
 const presentation={title:'YGPT approval preview',purpose:'Check whether this client displays approval controls.',target:'Example operation — no files accessed',impact:'This preview cannot grant permission or execute an operation.',denied:'Nothing changes.',risk:'Harmless preview',reversible:'No operation',administrator:'No elevation',technical:'Preview only; no command execution'};
 return {...text({preview:true,executed:false,requiresApproval:false,ui:'in-chat preview'}),_meta:{yBar:{requestId:'PREVIEW_ONLY',uiToken:'',presentation,chatScope:{eligible:false,explanation:'This preview has no action to approve.'},state:'awaiting_user',expiresAt:null,enabled:false,demo:true}}};
}
// Default to plain MCP tools: no chat file-preview widgets or app resources.
export const uiEnabled=()=>config.chatAppConsent||config.enableMcpUi===true&&config.localApprovalDisabled!==true;
export const barEnabled=()=>uiEnabled()&&config.approvalSurface==='chat'&&(!config.chatAppConsent||config.allowInlineDecisions);
const BRAND_ICON_FILES=['plugin-icon-256.png','ygpt-local-green-y-256.png','ygpt-local-sky-y-256.png','ygpt-local-green-256.png','ygpt-local-signature-256.png'];
// The strip cannot load external images (its CSP allows none), so the owner's
// chosen icon is inlined as a data URL when the resource is served. Default
// and fallback: the current sprout (assets/brand/plugin-icon-256.png).
function brandIconDataUrl(){const name=BRAND_ICON_FILES.includes(config.brandIcon)?config.brandIcon:'plugin-icon-256.png';for(const candidate of [name==='plugin-icon-256.png'?'ygpt-local-512.png':name.replace('-256.png','-512.png'),'ygpt-local-512.png','plugin-icon-256.png']){try{return 'data:image/png;base64,'+fs.readFileSync(path.join(INSTALL,'assets','brand',candidate)).toString('base64');}catch{}}return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/qp5gaQAAAABJRU5ErkJggg==';}
// The strip's accent colors follow the chosen icon's family (owner rule: keep
// blue and green clearly apart). Green-family icons re-skin the top edge, the
// primary button, the status accent and the icon tile to a fresh green; the
// sky family keeps the default Sky Air values baked into approval-bar.html.
// The served style therefore differs per family, so the inline CSP hashes are
// recomputed over the exact served script/style (same transform as
// scripts/csp.mjs) and the meta is patched to match.
const GREEN_ICON_FILES=['ygpt-local-green-y-256.png','ygpt-local-green-256.png'];
const GREEN_THEME=[['--accent:#0369a1','--accent:#15803d'],['--sky1:#a6e1fa','--sky1:#4ade80'],['--sky2:#7ac8f5','--sky2:#16a34a'],['--act1:#d5f0ff','--act1:#d5f5e0'],['--act2:#b9e4fc','--act2:#b3e8c6'],['--act-ink:#164765','--act-ink:#14532d'],['--act-edge:#9ed3f0','--act-edge:#9cd6b3'],['--tint:#e0f2fe','--tint:#dcfce7'],['--tint-line:#bae6fd','--tint-line:#bbf7d0'],['--tint-ink:#075985','--tint-ink:#166534'],['--ring:rgba(56,189,248,.22)','--ring:rgba(34,197,94,.22)'],['--lift:rgba(2,132,199,.10)','--lift:rgba(22,163,74,.12)'],['#eff8fe','#f0fdf4'],['#d5e6f2','#bbf7d0'],['#0ea5e9','#22c55e'],['--accent:#7dd3fc','--accent:#86efac'],['--sky2:#0369a1','--sky2:#15803d'],['--tint:#0f3550','--tint:#14532d'],['--tint-line:#1d5a80','--tint-line:#166534'],['--tint-ink:#bae6fd','--tint-ink:#bbf7d0'],['--ring:rgba(56,189,248,.3)','--ring:rgba(34,197,94,.3)']];
function rehashCsp(text){
 const hash=v=>createHash('sha256').update(v.replace(/\r\n?/g,'\n')).digest('base64');
 const grab=(open,close)=>{const a=text.indexOf(open),b=a<0?-1:text.indexOf(close,a+open.length);return a<0||b<0?null:text.slice(a+open.length,b);};
 const script=grab('<script>','</script>'),style=grab('<style>','</style>');
 if(script===null||style===null)return text;
 const patch=(src,kind,h)=>{const marker=kind+"-src 'sha256-",i=src.indexOf(marker);if(i<0)return src;const j=src.indexOf("'",i+marker.length);return src.slice(0,i+marker.length)+h+src.slice(j);};
 return patch(patch(text,'script',hash(script)),'style',hash(style));
}
export function barResource(uri=BAR_URI){const legacy=config.approvalStyle==='legacy';let text=fs.readFileSync(path.join(RUNTIME,legacy?'approval-bar-legacy.html':'approval-bar.html'),'utf8');text=text.replace("img-src 'none'","img-src data:").replace(/<script>[\s\S]*?<\/script>/,()=>'<script>'+fs.readFileSync(path.join(RUNTIME,'approval-ui.js'),'utf8')+'</script>');if(!legacy){text=text.replace('__YGPT_BRAND_ICON__',brandIconDataUrl());if(GREEN_ICON_FILES.includes(config.brandIcon))for(const [from,to] of GREEN_THEME)text=text.replace(from,to);}text=rehashCsp(text);return {uri,name:legacy?'YGPT approval (classic)':'YGPT approval',description:'Review an exact local operation inline, with details collapsed. Approval stays pending until you choose; phone and desktop show the same saved result.',mimeType:'text/html;profile=mcp-app',text,_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[],frameDomains:[]}},'openai/ui':{availableDisplayModes:['inline']},'openai/widgetDescription':'Approve or deny this local operation in the conversation. Keep the task pending until the decision; continue from the existing result. Changes made on another device are synchronized.','openai/widgetPrefersBorder':false,'openai/widgetCSP':{connect_domains:[],resource_domains:[]}}};}
// Test hook: the exact HTML a host receives for the current configuration.
export function barHtmlForTest(){return barResource(BAR_URI).text;}
export function handleBar(name,args,ledger,onApproved,isWaiting=()=>false){
 const id=args.requestId,operation=ledger.get(id);
 if(config.chatAppConsent&&name==='y_show_approval')return chatApprovalResult(ledger,args);
 if(name==='y_show_approval'){
  if(!ledger.canRead(id,args.resultToken)||!operation)throw Error('Original request resultToken required');
  const uiToken=ledger.grant('ui',id);
  // This result never enters call_result or the generic result ledger. Under
  // the MCP Apps host contract _meta is delivered ONLY to the sandboxed UI.
  return {...text({requestId:id,state:operation.state,title:operation.presentation.title,...approvalTaskState(operation.state),message:approvalGuidance}),_meta:{yBar:{requestId:id,instanceId:'ygpt-approval-'+id+'-'+randomUUID(),uiToken,presentation:{...operation.presentation,displayMode:'inline'},chatScope:operation.chatScope,state:operation.state,expiresAt:operation.expiresAt,enabled:config.allowInlineDecisions}}};
 }
 if(!ledger.owns('ui',id,args.uiToken)||!operation)throw Error('APP_CAPABILITY_INVALID: this card does not own the pending request');
 if(config.chatAppConsent&&!ledger.contextActive(operation.contextHash))throw Error('APP_CONTEXT_EXPIRED: the original chat context was revoked or expired');
 const progress=isWaiting(id),continuation=typeof progress==='object'?(progress.active?'waiting-tool':progress.delivered?'result-returned':'follow-up'):progress?'waiting-tool':'follow-up';
 if(name==='y_bar_status'){
  const delivery=args.notifyAction==='claim'||args.notifyAction==='retry'?ledger.reserveUiDelivery(id,args.notifyAction==='retry'):args.notifyAction==='sent'||args.notifyAction==='uncertain'?ledger.finishUiDelivery(id,args.deliveryToken,args.notifyAction==='sent'):null;
  const result=ledger.result(id),error=result?.structuredContent?.error;
  return text({requestId:id,state:operation.state,updatedAt:operation.updatedAt,expiresAt:operation.expiresAt,rendererConnected:true,notificationSent:ledger.uiDelivery(id)?.event==='ui_notify_sent',continuation,...(error?{executionError:{code:error.code,message:String(error.message??'').slice(0,500),outcomeUnknown:!!error.outcomeUnknown}}:{}),...(delivery?{delivery}:{})});
 }
 if(!config.allowInlineDecisions)throw Error('Inline decisions disabled until the trusted host passes acceptance');
 ledger.event(id,'ui_decision_received','app-capability-validated');
 const decision=ledger.decideLocal(id,args.decision,'chat-app-click');if(!decision.ok)throw Error(decision.reason);
 if(decision.approved&&!decision.reused)setImmediate(()=>onApproved(id,operation.tool,ledger.args(id)).catch(()=>process.stderr.write('[approval strip] Inspect operation state before retrying\n')));
 return text({requestId:id,state:decision.operation.state,decisionSaved:true,reused:!!decision.reused,continuation});
}
