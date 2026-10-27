// Permission requests happen only in this explicit, synchronous button click.
// The optional content script inspects the viewer header, never chat contents.
(()=>{
 const button=document.getElementById('inline-display'),status=document.getElementById('inline-display-status');
 const id='ygpt-inline-approval-display',origins=['https://chatgpt.com/*'];let enabled=false,busy=false;
 const render=()=>{button.disabled=busy;button.textContent=enabled?'Disable inline display helper':'Keep YGPT approvals in chat';};
 async function load(){const s=await chrome.storage.local.get('inlineApprovalDisplay');enabled=s.inlineApprovalDisplay===true&&await chrome.permissions.contains({permissions:['scripting'],origins});render();status.textContent=enabled?'Enabled for this browser profile.':'Optional. Requires access to chatgpt.com to close YGPT viewers. No chat content is read or sent.';}
 button.addEventListener('click',()=>{
  if(busy)return;busy=true;
  // Keep this call before any await: Chrome requires the owner's click.
  const grant=enabled?Promise.resolve(false):chrome.permissions.request({permissions:['scripting'],origins});render();
  void (async()=>{try{
   if(enabled){await chrome.storage.local.set({inlineApprovalDisplay:false});await chrome.scripting.unregisterContentScripts({ids:[id]}).catch(()=>{});enabled=false;status.textContent='Disabled. Existing ChatGPT permissions can be removed in the browser extension settings.';return;}
   if(!await grant){status.textContent='Permission was not granted. No display helper was enabled.';return;}
   const existing=await chrome.scripting.getRegisteredContentScripts({ids:[id]});if(!existing.length)await chrome.scripting.registerContentScripts([{id,matches:origins,js:['approval-display.js'],runAt:'document_idle',persistAcrossSessions:true}]);
   await chrome.storage.local.set({inlineApprovalDisplay:true});enabled=true;
   const tabs=await chrome.tabs.query({url:origins});for(const tab of tabs)if(Number.isInteger(tab.id))await chrome.scripting.executeScript({target:{tabId:tab.id},files:['approval-display.js']}).catch(()=>{});
   status.textContent='Enabled. YGPT viewers close automatically, including after refresh. Approval decisions stay in the chat.';
  }catch{status.textContent='Could not enable the display helper. Check this extension’s site permissions.';}
  finally{busy=false;render();}})();
 });
 void load();
})();
