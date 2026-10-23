const $=id=>document.getElementById(id);
async function refresh(){
  const st=await chrome.runtime.sendMessage({kind:'status'}).catch(()=>null);
  if(!st)return;
  $('host').value=st.settings.host;$('port').value=st.settings.port;
  if(st.settings.hasToken)$('token').placeholder='saved; leave empty to keep it';
  const stateTxt={open:'Connected ✓',connecting:'Connecting…',closed:'Not connected',error:'Connection error','needs-token':'Paste the pairing token, then Save & connect'}[st.state]||st.state;
  $('status').textContent=stateTxt+(st.profile?.email?'\nProfile: '+st.profile.email:'\nProfile: not signed in to the browser');
}
$('save').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({kind:'save-settings',settings:{host:$('host').value.trim()||'127.0.0.1',port:Number($('port').value)||19341,token:$('token').value.trim()}});
  $('status').textContent='Saved. Connecting…';
  setTimeout(refresh,1200);
});
void refresh();
