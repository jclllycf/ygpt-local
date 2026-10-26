// Optional ChatGPT presentation helper. Runs only after the owner grants this
// exact origin in the extension popup. No bridge, network, tools or chat reads.
(()=>{
 if(location.origin!=='https://chatgpt.com'||window.top!==window)return;
 const key='__ygptInlineApprovalDisplay';if(globalThis[key])return;
 const titles=new Set(['Review local action','Review local command','Full Access in this chat','YGPT approval preview','YGPT Local · y_show_approval']);
 const closed=new WeakSet();let observer,stopped=false,active=false;
 function scan(){
  if(stopped||!active)return;
  for(const panel of document.querySelectorAll('[role="tabpanel"]')){
   const label=panel.getAttribute('aria-label')||document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent?.trim();
   if(!titles.has(label)||!panel.querySelector('img[alt="YGPT"],img[alt="YGPT Local"]'))continue;
   const button=panel.querySelector('button[aria-label="Close viewer"]');
   if(!button||button.disabled||closed.has(button)||!button.getClientRects().length)continue;
   closed.add(button);button.click();
  }
 }
 const stop=()=>{stopped=true;observer?.disconnect();globalThis.chrome?.storage?.onChanged?.removeListener(changed);delete globalThis[key];};
 const changed=(changes,area)=>{if(area==='local'&&changes.inlineApprovalDisplay?.newValue===false)stop();};
 globalThis[key]={stop};
 observer=new MutationObserver(scan);
 // Optional permissions alone are not consent to turn on the feature.
 if(typeof chrome!=='undefined'&&chrome.storage?.local){
  chrome.storage.onChanged.addListener(changed);
  chrome.storage.local.get('inlineApprovalDisplay').then(s=>{if(s.inlineApprovalDisplay===true){active=true;observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','aria-labelledby','alt','hidden']});scan();}else stop();}).catch(stop);
 }else stop();
})();
