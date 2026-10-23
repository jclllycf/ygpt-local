const $=id=>document.getElementById(id);
let fieldsLoaded=false;
async function refresh(){
  const st=await chrome.runtime.sendMessage({kind:'status'}).catch(()=>null);
  if(!st)return;
  if(!fieldsLoaded){
    $('host').value=st.settings.host;$('port').value=st.settings.port;
    if(st.settings.hasToken)$('token').placeholder='saved; leave empty to keep it';
    fieldsLoaded=true;
  }
  const stateTxt={registered:'Connected ✓',open:'Waiting for relay registration…',registering:'Registering with YGPT…','registration-timeout':'Relay registration timed out. Check YGPT, then Reload this extension in chrome://extensions.',connecting:'Connecting…',closed:'Not connected',error:'Connection error','needs-token':'Paste the pairing token, then Save & connect'}[st.state]||st.state;
  $('status').textContent=stateTxt+'\nProfile: '+(st.profileLabel||st.profile?.email||'This browser profile');
}
$('save').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({kind:'save-settings',settings:{host:$('host').value.trim()||'127.0.0.1',port:Number($('port').value)||19341,token:$('token').value.trim()}});
  $('status').textContent='Saved. Connecting…';
  setTimeout(refresh,1200);
});
void refresh();

setInterval(refresh,1000);
