import fs from 'node:fs';
import path from 'node:path';
import {config,RUNTIME,INSTALL} from './config.mjs';
// New resource URI forces hosts to fetch the revised CSP and bridge bundle.
export const BAR_URI='ui://ygpt/approval/strip-v3.html';
// The prior ChatGPT tool catalog can retain this URI across conversations.
// Serve the NEW strip at this legacy address rather than the retired large card.
export const LEGACY_BAR_URI='ui://ygpt/approval/card-v1.html';
// RC10 read-only MCP App surface. Never returns a decision capability until host attestation is proven.
export const INSPECTION_URI=config.chatAppConsent?'ui://ygpt/approval/compact-v1-rc2.html':'ui://ygpt/approval/inspection-v1.html';
// Resource addresses are protocol identifiers, not display branding. Old chats
// retain these exact addresses and must still receive the current component.
const knownResources=[BAR_URI,LEGACY_BAR_URI,INSPECTION_URI,...['compact-v11-3','interactive-v11-2c','interactive-v11-2b','interactive-v11-2','interactive-v11-1','interactive-v11','inspection-v1'].map(n=>'ui://ygpt/approval/'+n+'.html')];
export function approvalResourceUris(){
 const modern=config.rc10Candidate?knownResources:!config.rc9Candidate&&uiEnabled()?(barEnabled()?[BAR_URI,LEGACY_BAR_URI]:[BAR_URI]):[];
 return [...new Set(modern)];
}
export const approvalCenterTool={
 name:'y_approval_center',
 title:'Approval center',
 description:'Show this approval immediately at the current action with original contextToken, then wait using y_wait_approval. Keep the task in progress; no final report before the user decides. No arguments safely returns an empty state.',
 inputSchema:{type:'object',properties:{requestId:{type:'string',maxLength:128}},additionalProperties:false},
 _meta:{ui:{resourceUri:INSPECTION_URI},'openai/outputTemplate':INSPECTION_URI},
 annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
};
export function approvalCenterResult(operation,requestId){
 const resolved=operation?.id??String(requestId??'NONE').slice(0,128);
 const state=operation?.state??'not_found';
 const presentation=operation?.presentation??{
   title:'YGPT · 人工授权中心（只读）',
   purpose:'当前运行环境尚未验证可信真人批准通道。',
   target:'没有可供执行的操作',impact:'不执行任何命令或文件改动。',
   denied:'保持原样',risk:'只读',administrator:'无提权',technical:'Host consent not verified'
 };
 return {
  content:[{type:'text',text:JSON.stringify({requestId:resolved,state,approvalEnabled:false,message:'YGPT approval UI is display-only until a trusted host consent path passes acceptance.'})}],
  structuredContent:{requestId:resolved,state,approvalEnabled:false},
  _meta:{yBar:{requestId:resolved,uiToken:'',presentation,chatScope:{eligible:false},state,expiresAt:operation?.expiresAt??null,enabled:false,demo:true}}
 };
}
export function chatApprovalResult(ledger,args={}){
 let operation=args.requestId?ledger.get(args.requestId):null;
 let context;
 if(args.contextToken)context=ledger.context(args.contextToken);
 if(!operation&&context&&!args.requestId)operation=ledger.pending().find(o=>o.state==='awaiting_user'&&o.contextHash===context.hash);
 const matched=!!operation&&!!context&&operation.contextHash===context.hash;
 const enabled=barEnabled()&&matched&&operation.state==='awaiting_user'&&Date.parse(operation.expiresAt)>Date.now();
 const value={requestId:operation?.id??'NONE',state:operation?.state??'not_found',approvalEnabled:enabled,requiresOriginalChatContext:!!operation&&!matched};
 const presentation=operation?.presentation??{title:'No request to review',target:'No pending operation selected',impact:'No command or file change will run.',purpose:'Pass a pending requestId and its original contextToken.',denied:'Nothing changes.',risk:'None',reversible:'No operation',administrator:'No elevation',technical:''};
 // Keep the capability exclusively in the host-to-app metadata channel.
 return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,_meta:{yBar:{...value,uiToken:enabled?ledger.grant('ui',operation.id):'',presentation,chatScope:operation?.chatScope??{eligible:false,explanation:'No conversation grant available.'},expiresAt:operation?.expiresAt??null,enabled,demo:false,note:matched?'':operation?'Retry the original action in this chat, then include its contextToken.':'No pending request.'}}};
}
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
export const barTools=[
 {name:'y_show_approval',description:'Render the pending approval immediately at this action, then y_wait_approval with original resultToken. Do not finish the response or append a long report while pending. Preserve original contextToken and resultToken. The user decision sends a chat follow-up; inspect status, never replay the action.',inputSchema:{type:'object',properties:{requestId:{type:'string'},resultToken:{type:'string'}},required:['requestId','resultToken'],additionalProperties:false},_meta:{ui:{resourceUri:BAR_URI},'openai/outputTemplate':BAR_URI},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 ...['decide','status'].map(action=>({name:'y_bar_'+action,description:'UI-only '+action+'; requires a widget-only one-request capability.',inputSchema:{type:'object',properties:{requestId:{type:'string'},uiToken:{type:'string'},...(action==='decide'?{decision:{type:'string',enum:['once','chat','deny']}}:{})},required:['requestId','uiToken',...(action==='decide'?['decision']:[])],additionalProperties:false},_meta:{ui:{visibility:['app']},'openai/visibility':'private','openai/widgetAccessible':true},annotations:{readOnlyHint:action==='status',destructiveHint:action==='decide',openWorldHint:false}}))
];
// Safe production renderer probe: never issues an operation capability.
export const previewTool={
 name:'y_preview_approval_ui',
 description:'Display a harmless PREVIEW of the compact YGPT in-chat permission panel. Does not request or grant any permission or modify local files.',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 _meta:{ui:{resourceUri:BAR_URI},'openai/outputTemplate':BAR_URI},
 annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
};
export function previewResult(){
 const presentation={title:'YGPT · 授权条预览（不执行操作）',purpose:'验证 ChatGPT 中的对话内授权界面是否正常渲染。',target:'示例：D:\\AI\\Projects\\example\\build.log',impact:'仅展示界面；不会读取、写入、执行本机文件。',denied:'不产生任何更改。',risk:'无风险预览',reversible:'没有实际操作',administrator:'普通用户；不会提升权限',technical:'Preview only; no command execution'};
 return {...text({preview:true,executed:false,requiresApproval:false,ui:'in-chat preview'}),_meta:{yBar:{requestId:'PREVIEW_ONLY',uiToken:'',presentation,chatScope:{eligible:false,explanation:'此预览没有可授权的操作。'},state:'awaiting_user',expiresAt:null,enabled:false,demo:true}}};
}
// Default to plain MCP tools: no chat file-preview widgets or app resources.
export const uiEnabled=()=>config.chatAppConsent||config.enableMcpUi===true&&config.localApprovalDisabled!==true;
export const barEnabled=()=>uiEnabled()&&config.approvalSurface==='chat'&&(!config.chatAppConsent||config.allowInlineDecisions);
const BRAND_ICON_FILES=['plugin-icon-256.png','ygpt-local-green-y-256.png','ygpt-local-sky-y-256.png','ygpt-local-green-256.png','ygpt-local-signature-256.png'];
// The strip cannot load external images (its CSP allows none), so the owner's
// chosen icon is inlined as a data URL when the resource is served. Default
// and fallback: the current sprout (assets/brand/plugin-icon-256.png).
function brandIconDataUrl(){const name=BRAND_ICON_FILES.includes(config.brandIcon)?config.brandIcon:'plugin-icon-256.png';for(const candidate of [name,'plugin-icon-256.png']){try{return 'data:image/png;base64,'+fs.readFileSync(path.join(INSTALL,'assets','brand',candidate)).toString('base64');}catch{}}return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/qp5gaQAAAABJRU5ErkJggg==';}
export function barResource(uri=BAR_URI){const legacy=config.approvalStyle==='legacy';let text=fs.readFileSync(path.join(RUNTIME,legacy?'approval-bar-legacy.html':'approval-bar.html'),'utf8');if(!legacy)text=text.replace('__YGPT_BRAND_ICON__',brandIconDataUrl());return {uri,name:legacy?'YGPT compact approval strip (classic)':'YGPT compact approval strip',mimeType:'text/html;profile=mcp-app',text,_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[],frameDomains:[]}},'openai/widgetPrefersBorder':false,'openai/widgetCSP':{connect_domains:[],resource_domains:[]}}};}
// Test hook: the exact HTML a host receives for the current configuration.
export function barHtmlForTest(){return barResource(BAR_URI).text;}
export function handleBar(name,args,ledger,onApproved,isWaiting=()=>false){
 const id=args.requestId,operation=ledger.get(id);
 if(config.chatAppConsent&&['y_show_approval','y_review_approval','y_approval_center'].includes(name))return chatApprovalResult(ledger,args);
 if(name==='y_show_approval'||name==='y_review_approval'){
  // Legacy cached ChatGPT tool calls carry only requestId. This route merely
  // displays the NEW read-only strip; it never grants or executes anything.
  // Exact approval still requires a real user click and widget-only uiToken.
  if(name==='y_review_approval'){
   if(!operation||operation.state!=='awaiting_user')throw Error('No pending request in this runtime; retry the original action if it came from an older session');
  }else if(!ledger.canRead(id,args.resultToken)||!operation)throw Error('Original request resultToken required');
  const uiToken=ledger.grant('ui',id);
  // This result never enters call_result or the generic result ledger. Under
  // the MCP Apps host contract _meta is delivered ONLY to the sandboxed UI.
  return {...text({requestId:id,state:operation.state,title:operation.presentation.title}),_meta:{yBar:{requestId:id,uiToken,presentation:operation.presentation,chatScope:operation.chatScope,state:operation.state,expiresAt:operation.expiresAt,enabled:config.allowInlineDecisions}}};
 }
 if(!ledger.owns('ui',id,args.uiToken)||!operation)throw Error('APP_CAPABILITY_INVALID: this card does not own the pending request');
 if(config.chatAppConsent&&!ledger.contextActive(operation.contextHash))throw Error('APP_CONTEXT_EXPIRED: the original chat context was revoked or expired');
 if(name==='y_bar_status')return text({requestId:id,state:operation.state,continuation:isWaiting(id)?'waiting-tool':'follow-up'});
 if(!config.allowInlineDecisions)throw Error('Inline decisions disabled until the trusted host passes acceptance');
 ledger.event(id,'ui_decision_received','app-capability-validated');
 const decision=ledger.decideLocal(id,args.decision,'chat-app-click');if(!decision.ok)throw Error(decision.reason);
 if(decision.approved&&!decision.reused)setImmediate(()=>onApproved(id,operation.tool,ledger.args(id)).catch(()=>process.stderr.write('[approval strip] Inspect operation state before retrying\n')));
 return text({requestId:id,state:decision.operation.state,decisionSaved:true,reused:!!decision.reused,continuation:isWaiting(id)?'waiting-tool':'follow-up'});
}
