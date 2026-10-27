// Bundled into both current and compatibility resources. Capabilities stay in
// host-to-component metadata; no decision is inferred from conversation text.
(()=>{
 const $=id=>document.getElementById(id),terminal=new Set(['succeeded','failed','unknown','denied','expired','not_found']);
 const labels={awaiting_user:'Awaiting approval',context_required:'Refresh approval',request_unavailable:'Approval unavailable',approved:'Approved',running:'Running',succeeded:'Completed',failed:'Failed',unknown:'Check result',denied:'Denied',expired:'Expired',not_found:'No request'};
 let card=null,call=null,standard=false,healthy=false,busy=false,notifying=false,timer=null,failures=0,closed=false,compatibilityTools=false;
 const states=new Map(),deliveries=new Map(),inflight=new Set(),requests=new Map();let sequence=0;
 let hostContext={},presentationPending=false,presentationDone=false,closeRequested=false,presentationRevision=0,presentationTimer=null,presentationAttempts=0;
 const expanded=mode=>['pip','picture-in-picture','fullscreen'].includes(mode);
 function presentationChanged(){presentationRevision++;presentationDone=false;presentationAttempts=0;closeRequested=false;clearTimeout(presentationTimer);}
 function boundedPresentation(action){return new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(Error('Presentation timeout')),2000);Promise.resolve().then(action).then(resolve,reject).finally(()=>clearTimeout(deadline));});}
 // Presentation is negotiated independently of tool metadata: a refreshed
 // host can restore the side panel before it replays an old tool result.
 async function preferInline(){
  const api=window.openai,revision=presentationRevision;
  if(presentationPending||presentationDone||presentationAttempts>=3)return;
  if(!standard&&typeof api?.requestDisplayMode!=='function')return;
  presentationPending=true;presentationAttempts++;
  let accepted=false;
  try{
   const supported=hostContext.availableDisplayModes;
   if(!supported||supported.includes('inline')){
    const result=standard?await request('ui/request-display-mode',{mode:'inline'},2000):await boundedPresentation(()=>api.requestDisplayMode({mode:'inline'}));
    accepted=result?.mode==='inline'||api?.displayMode==='inline';
    // An RPC acknowledgement is not a host-context update. In particular,
    // a compatibility host may acknowledge inline while still reporting PiP.
    if(standard&&!accepted&&typeof api?.requestDisplayMode==='function'){
     const fallback=await boundedPresentation(()=>api.requestDisplayMode({mode:'inline'}));accepted=fallback?.mode==='inline'||api.displayMode==='inline';
    }
   }
  }catch{
   if(standard&&typeof api?.requestDisplayMode==='function')try{const result=await boundedPresentation(()=>api.requestDisplayMode({mode:'inline'}));accepted=result?.mode==='inline'||api.displayMode==='inline';}catch{}
  }
  // Closing an expanded host surface is distinct from hiding its inline card.
  // Never requestClose when the host has not identified an expanded mode.
  const reported=api?.displayMode??hostContext.displayMode;
  if(revision===presentationRevision&&expanded(reported)&&!closeRequested&&typeof api?.requestClose==='function'){
   closeRequested=true;try{await boundedPresentation(()=>api.requestClose());}catch{closeRequested=false;}
  }
  presentationPending=false;
  const confirmed=api?.displayMode??hostContext.displayMode;
  if(confirmed==='inline')hostContext.displayMode='inline';
  presentationDone=revision===presentationRevision&&(confirmed==='inline'||accepted&&!expanded(confirmed));
  // Retry a missing/late bridge only a bounded number of times. A context
  // change during an in-flight negotiation must get its own negotiation.
  if(!presentationDone&&(revision!==presentationRevision||presentationAttempts<3)&&!closed){clearTimeout(presentationTimer);presentationTimer=setTimeout(()=>void preferInline(),250);}
 }
 function unwrap(value){for(let n=0;n<8;n++){
  if(typeof value==='string'){value=JSON.parse(value);continue;}
  if(value?.isError||value?.error)throw Error(value.error?.message??value.content?.[0]?.text??'Host rejected the request');
  if(value?.structuredContent)return value.structuredContent;
  const nested=value?.params??value?.mcp_tool_result??value?.call_tool_result??value?.result;
  if(nested){value=nested;continue;}
  if(value?.content?.[0]?.text){value=JSON.parse(value.content[0].text);continue;}
  return value??{};
 }throw Error('Unrecognized host result');}
 function metadata(value){for(let n=0;n<8&&value;n++){
  if(value._meta?.yBar)return value._meta.yBar;
  if(value.yBar)return value.yBar;
  value=value.params??value.mcp_tool_result??value.call_tool_result??value.result;
 }return null;}
 function stableState(id,next){const old=states.get(id);
  if(terminal.has(old)||old==='running'&&['awaiting_user','approved'].includes(next)||old==='approved'&&next==='awaiting_user')return old;
  states.set(id,next);return next;
 }
 function delivery(id,status){deliveries.set(id,status);try{window.openai?.setWidgetState?.({privateContent:{ygptDelivery:{requestId:id,status}}});}catch{}}
 function note(text){$('note').textContent=text;}
 function render(){
  if(!card)return;const p=card.presentation??{},expired=card.expiresAt&&Date.parse(card.expiresAt)<=Date.now();
  document.querySelector('main').dataset.state=card.state;document.querySelector('main').dataset.delivery=deliveries.get(card.requestId)??'';
  for(const [id,key] of Object.entries({title:'title',target:'target',fulltarget:'target',impact:'impact',purpose:'purpose',denied:'denied',technical:'technical',privilege:'administrator'}))$(id).textContent=p[key]??'';
  $('target').title=p.target??'';$('risk').textContent=[p.risk,p.reversible].filter(Boolean).join(' · ');
  $('scope').textContent=card.chatScope?.explanation??'Allow once is required for this action.';
  $('state').textContent=expired&&card.state==='awaiting_user'?labels.expired:card.stateLabel??labels[card.state]??card.state;
  $('once').textContent=p.approveLabel??'Allow once';
  const enabled=healthy&&!busy&&!!call&&card.enabled&&card.state==='awaiting_user'&&!expired&&!!card.uiToken;
  for(const id of ['once','chat','deny'])$(id).disabled=!enabled||id==='chat'&&!card.chatScope?.eligible;
  $('actions').hidden=card.state!=='awaiting_user'||expired;$('chat').hidden=!card.chatScope?.eligible;
  $('chat').title=card.chatScope?.explanation??'A conversation grant is unavailable for this operation.';
  const status=deliveries.get(card.requestId);
  $('notify').hidden=!card.uiToken||status!=='unconfirmed'||['awaiting_user','expired','not_found'].includes(card.state);$('notify').disabled=notifying;
  if(card.demo)note('Preview only. No operation can execute.');
  else if(status==='unconfirmed')note('Decision saved. Chat notification was not confirmed. Choose Resume chat to retry the message only.');
  else if(expired&&card.state==='awaiting_user')note('This card has expired. Check its saved status; do not repeat the operation.');
  else if(card.note)note(card.note);
  else if(!healthy)note('Connecting to approval controls… If buttons do not appear, open this same conversation on the web or use the Windows approval center.');
  else if(enabled)note(p.approveLabel?'Choose '+p.approveLabel+' or Deny. This applies only to the chat and duration shown above.':card.chatScope?.eligible?'Review the exact action, then choose. A decision on another device appears here automatically.':'Choose Allow once or Deny. The same decision is shared with your other devices.');
  else if(card.state==='succeeded')note('Completed. The original result is available.');
  else if(card.state==='failed'||card.state==='unknown')note((card.executionError?.code?card.executionError.code+': ':'')+(card.executionError?.message||'The desktop action did not return a confirmed success.')+(card.executionError?.outcomeUnknown?' Inspect the window before retrying; no action was resubmitted.':' Your authorization was saved. Inspect the target before choosing the next action.'));
  else if(card.state==='denied')note('Denied. Nothing was executed.');
  void preferInline();
 }
 function accept(value){
  const next=metadata(value);if(!next||typeof next.requestId!=='string'||!next.presentation)return;
  if((card?.instanceId??card?.requestId)!==(next.instanceId??next.requestId)){$('details').open=false;if(card)presentationChanged();}
  const persisted=window.openai?.widgetState?.privateContent?.ygptDelivery;
  if(persisted?.requestId===next.requestId&&typeof persisted.status==='string')deliveries.set(next.requestId,persisted.status);
  card={...next,state:stableState(next.requestId,next.state)};
  if(card.uiToken&&!deliveries.has(card.requestId)&&['approved','running','succeeded','failed','unknown','denied'].includes(card.state))delivery(card.requestId,'unconfirmed');
  render();schedule(0);
 }
 function request(method,params,timeout=12000){const id='ygpt-ui-'+(++sequence);
  return new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{requests.delete(id);reject(Error('Host bridge timeout'));},timeout);
   requests.set(id,{resolve,reject,deadline});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');
  });
 }
 window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.jsonrpc!=='2.0')return;
  const message=event.data,pending=requests.get(message.id);
  if(pending){requests.delete(message.id);clearTimeout(pending.deadline);message.error?pending.reject(Object.assign(Error(message.error.message??'Host bridge error'),{code:message.error.code})):pending.resolve(message.result);}
  else if(message.method==='ui/notifications/tool-result')accept(message.params);
  else if(message.method==='ui/notifications/host-context-changed'){if(message.params?.displayMode&&message.params.displayMode!=='inline'&&message.params.displayMode!==hostContext.displayMode)presentationChanged();hostContext={...hostContext,...message.params};void preferInline();}
 });
 async function notify(event=null){
  if(event&&!event.isTrusted||!card?.uiToken||!call||notifying||['sent','returned'].includes(deliveries.get(card.requestId)))return;
  const current=card,id=current.requestId;notifying=true;let token=null;delivery(id,'attempted');render();
  try{
   const status=unwrap(await call('y_bar_status',{requestId:id,uiToken:current.uiToken}));
   if(status.state==='awaiting_user')throw Error('No decision committed');
   if(card?.requestId===id){card={...card,state:stableState(id,status.state)};render();}
   if(status.continuation==='waiting-tool'){delivery(id,'waiting');return;}
   if(status.continuation==='result-returned'){delivery(id,'returned');return;}
   const reserved=unwrap(await call('y_bar_status',{requestId:id,uiToken:current.uiToken,notifyAction:event?'retry':'claim'})).delivery;
   if(!reserved?.granted){delivery(id,reserved?.status==='sent'?'sent':'unconfirmed');return;}
   token=reserved.token;
   const prompt='YGPT approval saved for request '+id+'. Continue the original task by retrieving its existing status/result with the resultToken retained in this conversation. Never repeat the operation; a denial remains a denial.';
   if(standard){
    try{const result=await request('ui/message',{role:'user',content:[{type:'text',text:prompt}]});if(result?.isError)throw Error('Host declined the follow-up');}
    catch(error){if(error.code!==-32601||typeof window.openai?.sendFollowUpMessage!=='function')throw error;await window.openai.sendFollowUpMessage({prompt,scrollToBottom:true});}
   }else if(typeof window.openai?.sendFollowUpMessage==='function')await window.openai.sendFollowUpMessage({prompt,scrollToBottom:true});
   else throw Error('No message bridge');
   await call('y_bar_status',{requestId:id,uiToken:current.uiToken,notifyAction:'sent',deliveryToken:token});delivery(id,'sent');
   if(card?.requestId===id)note('Decision saved. Chat notified; the original result will be checked.');
  }catch{
   delivery(id,'unconfirmed');if(token)try{await call('y_bar_status',{requestId:id,uiToken:current.uiToken,notifyAction:'uncertain',deliveryToken:token});}catch{}
   if(card?.requestId===id)note('Decision saved. Chat notification was not confirmed. Choose Resume chat to retry the message only.');
  }finally{notifying=false;render();}
 }
 function schedule(delay=3000){clearTimeout(timer);if(closed||!card?.uiToken||terminal.has(card.state)&&deliveries.get(card.requestId)!=='waiting')return;
  timer=setTimeout(async()=>{if(document.visibilityState!=='hidden')await refresh();schedule(Math.min(30000,3000*2**failures));},delay);
 }
 async function refresh(){
  if(!card?.uiToken||!call)return;const current=card,id=current.requestId;if(inflight.has(id))return;inflight.add(id);
  try{
   const value=unwrap(await call('y_bar_status',{requestId:id,uiToken:current.uiToken}));healthy=true;failures=0;
   if(card?.requestId!==id)return;
   const before=card.state,wasWaiting=deliveries.get(id)==='waiting';card={...card,state:stableState(id,value.state),expiresAt:value.expiresAt??card.expiresAt,executionError:value.executionError??card.executionError};
   const decided=['approved','running','succeeded','failed','unknown','denied'].includes(card.state);
   if(value.notificationSent)delivery(id,'sent');else if(decided&&value.continuation==='result-returned')delivery(id,'returned');else if(decided&&value.continuation==='waiting-tool')delivery(id,'waiting');render();
   if(decided&&!['waiting-tool','result-returned'].includes(value.continuation)&&!value.notificationSent&&(before==='awaiting_user'||wasWaiting))await notify();
  }catch{healthy=false;failures=Math.min(4,failures+1);render();note('Approval connection interrupted. No action was resubmitted. Controls retry automatically.');}
  finally{inflight.delete(id);}
 }
 async function decide(choice,event){
  if(!event.isTrusted||busy||!healthy||!card?.enabled||!card.uiToken||!call||card.state!=='awaiting_user'||choice==='chat'&&!card.chatScope?.eligible)return;
  const current=card,id=current.requestId;busy=true;render();note('Recording your choice…');
  try{
   const result=unwrap(await call('y_bar_decide',{requestId:id,uiToken:current.uiToken,decision:choice}));
   if(!['approved','running','succeeded','failed','unknown','denied'].includes(result.state))throw Error('Unexpected decision state');
   if(card?.requestId===id){card={...card,state:stableState(id,result.state)};busy=false;render();}
   if(result.continuation==='waiting-tool')delivery(id,'waiting');else if(result.continuation==='result-returned')delivery(id,'returned');else await notify();schedule();
  }catch{await refresh();if(card?.state==='awaiting_user')note('Decision not confirmed. It was not resubmitted; wait for the controls to reconnect.');}
  finally{busy=false;render();}
 }
 for(const id of ['once','chat','deny'])$(id).addEventListener('click',event=>decide(id,event));
 $('notify').addEventListener('click',event=>notify(event));
 function globals(event){
  const openai=window.openai;if(typeof openai?.callTool==='function'&&!standard){call=(name,args)=>openai.callTool(name,args);healthy=true;}
  const mode=event?.detail?.globals?.displayMode??openai?.displayMode;if(mode){if(mode!=='inline'&&mode!==hostContext.displayMode)presentationChanged();hostContext.displayMode=mode;}
  void preferInline();
  accept(event?.detail?.globals?.toolResponseMetadata??openai?.toolResponseMetadata);
  if(card){render();schedule(0);}
 }
 window.addEventListener('openai:set_globals',globals);globals();
 if(window.parent!==window)request('ui/initialize',{appInfo:{name:'YGPT approval',version:'1.0.20'},appCapabilities:{availableDisplayModes:['inline']},protocolVersion:'2026-01-26'}).then(result=>{
  // Some ChatGPT compatibility methods silently ignore calls without a
  // synchronous user event. Always negotiate again over the real standard
  // bridge, even when its initial mode matches the compatibility globals.
  standard=true;presentationChanged();hostContext={...hostContext,...result.hostContext};void preferInline();
  healthy=true;call=async(name,args)=>{const compat=window.openai?.callTool;if(compatibilityTools&&typeof compat==='function')return compat(name,args);try{return await request('tools/call',{name,arguments:args});}catch(error){if(typeof compat==='function'&&(error.code===-32601||name==='y_bar_status'&&!args.notifyAction)){const result=await compat(name,args);compatibilityTools=true;return result;}throw error;}};
  window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
  const resize=()=>{const rect=document.querySelector('main').getBoundingClientRect();window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{width:Math.ceil(rect.width),height:Math.ceil(rect.height)}},'*');};
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>requestAnimationFrame(resize)).observe(document.querySelector('main'));resize();globals();schedule(0);
 }).catch(()=>{if(!call)note('This host did not connect approval controls. Open this conversation on the web or use the Windows approval center. Nothing was approved.');});
 else if(!call)note('Open this component inside the YGPT app in ChatGPT.');
 window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);clearTimeout(presentationTimer);});
 window.addEventListener('pageshow',event=>{closed=false;if(event.persisted)presentationChanged();globals();refresh();schedule();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden'){globals();refresh();schedule();}});
 window.addEventListener('focus',()=>{refresh();schedule();});
})();
