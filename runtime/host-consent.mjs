import {stable,digest} from './durable.mjs';
export const CURRENT_PROTOCOL='2026-07-28';
export function requestHost(msg,legacy){
 const meta=msg.params?._meta??{},version=meta['io.modelcontextprotocol/protocolVersion']??legacy?.protocolVersion;
 const capabilities=version===CURRENT_PROTOCOL?meta['io.modelcontextprotocol/clientCapabilities']:legacy?.capabilities;
 if(version===CURRENT_PROTOCOL&&(!capabilities||typeof capabilities!=='object'||Array.isArray(capabilities)))throw Error('Per-request clientCapabilities required for MCP 2026-07-28');
 return {version,capabilities:capabilities??{}};
}
export function nativeConsentSupported(host){return host.version===CURRENT_PROTOCOL&&!!host.capabilities?.elicitation?.form&&!!host.capabilities?.extensions?.['openai/elicitation']?.form;}
export function nativeConsentRequest(ledger,operation,name,args,host,{resultToken,contextToken}={}){
 if(!nativeConsentSupported(host))throw Error('Native form support is not advertised');
 const choices=[{const:'once',title:'Allow once'},...(operation.chatScope?.eligible?[{const:'chat',title:'Always allow in this chat'}]:[]),{const:'deny',title:'Deny'}];
 const schema={type:'object',properties:{decision:{type:'string',title:'Permission',oneOf:choices}},required:['decision'],additionalProperties:false};
 const nonce=ledger.grant('host_form',operation.id);
 const requestState=ledger.vault.seal(JSON.stringify({owner:ledger.owner,id:operation.id,name,argsDigest:digest(stable(args)),contextHash:operation.contextHash,nonce,expires:Date.parse(operation.expiresAt),resultToken,contextToken}));
 const p=operation.presentation;
 ledger.event(operation.id,'host_form_requested','mcp-mrtr');
 return {resultType:'input_required',requestState,inputRequests:{y_decision:{method:'elicitation/create',params:{mode:'form',message:[p.title,p.target,p.impact,p.technical,operation.chatScope?.explanation].filter(Boolean).join('\n\n'),requestedSchema:{type:'object',properties:{}},_meta:{'openai/elicitation':{requestedSchema:schema}}}}}};
}
export async function resumeNativeConsent(msg,name,args,host,ledger,execute){
 if(msg.params?.requestState===undefined&&msg.params?.inputResponses===undefined)return null;
 if(!nativeConsentSupported(host))throw Error('Native form retry requires advertised protocol capabilities');
 let state;try{state=JSON.parse(ledger.vault.open(msg.params.requestState));}catch{throw Error('Invalid native approval requestState');}
 if(state.owner!==ledger.owner||state.name!==name||state.argsDigest!==digest(stable(args))||state.expires<=Date.now()||!ledger.owns('host_form',state.id,state.nonce))throw Error('Native approval state expired, changed or foreign');
 const operation=ledger.get(state.id);
 if(!operation||operation.contextHash!==state.contextHash||!ledger.contextActive(state.contextHash))throw Error('Native approval context expired or revoked');
 const response=msg.params.inputResponses?.y_decision;
 if(!response||!['accept','decline','cancel'].includes(response.action))throw Error('Missing or invalid host form response');
 const choice=response.action==='accept'?response.content?.decision:'deny';
 if(!['once','chat','deny'].includes(choice)||choice==='chat'&&!operation.chatScope?.eligible)throw Error('Invalid host decision or scope');
 const decision=ledger.decideLocal(state.id,choice,'host-form-response');
 if(!decision.ok)throw Error(decision.reason);
 if(response.action==='cancel')ledger.event(state.id,'host_form_cancelled','mcp-mrtr');
 if(!decision.approved)return {content:[{type:'text',text:'The user declined or cancelled this operation. Nothing was executed.'}],structuredContent:{requestId:state.id,state:'denied',consentAction:response.action}};
 if(!decision.reused)await execute(state.id,name,ledger.args(state.id));
 // Retrying the host response returns the already stored result. It never
 // starts a second action, including after restart/unknown outcomes.
 const done=ledger.get(state.id),result=ledger.result(state.id);
 return {...(result??{content:[{type:'text',text:'Inspect this existing request; do not replay the operation.'}]}),structuredContent:{...(result?.structuredContent??{}),approval:{requestId:state.id,state:done.state,...(state.resultToken?{resultToken:state.resultToken}:{}),...(state.contextToken?{contextToken:state.contextToken}:{})}}};
}
