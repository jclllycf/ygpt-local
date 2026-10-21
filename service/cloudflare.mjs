// Official REST API only. Never replace an existing route or DNS record.
import {randomBytes} from 'node:crypto';
export async function createCloudflare({apiToken,accountId,zoneId,hostname,port,confirmCreate,request=fetch}){
 if(confirmCreate!==true)throw Error('Confirm creation of a dedicated tunnel and DNS record');
 if(!/^[a-f0-9]{32}$/.test(accountId)||!/^[a-f0-9]{32}$/.test(zoneId)||! /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(hostname)||!hostname.includes('.'))throw Error('Invalid Cloudflare account, zone or hostname');
 async function api(method,p,body){const r=await request('https://api.cloudflare.com/client/v4/'+p,{method,headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const v=await r.json();if(!r.ok||!v.success)throw Object.assign(Error('Cloudflare permission or configuration request failed (HTTP '+r.status+'). Check Tunnel Edit and DNS Edit for the selected account/zone.'),{code:'CF_API_'+r.status});return v.result;}
 await api('GET','user/tokens/verify');const existing=await api('GET','zones/'+zoneId+'/dns_records?name='+encodeURIComponent(hostname));if(existing.length)throw Error('This DNS hostname already exists. Choose a new dedicated name; no record was changed.');
 let tunnel,dns;
 try{
  tunnel=await api('POST','accounts/'+accountId+'/cfd_tunnel',{name:'ygpt-local-'+randomBytes(4).toString('hex'),config_src:'cloudflare',tunnel_secret:randomBytes(32).toString('base64')});
  await api('PUT','accounts/'+accountId+'/cfd_tunnel/'+tunnel.id+'/configurations',{config:{ingress:[{hostname,service:'http://127.0.0.1:'+port},{service:'http_status:404'}]}});
  dns=await api('POST','zones/'+zoneId+'/dns_records',{type:'CNAME',name:hostname,content:tunnel.id+'.cfargotunnel.com',proxied:true,ttl:1});
  const token=await api('GET','accounts/'+accountId+'/cfd_tunnel/'+tunnel.id+'/token');return {tunnelId:tunnel.id,tunnelToken:token,dnsRecordId:dns.id,publicOrigin:'https://'+hostname};
 }catch(e){const cleanup=[];if(dns)try{await api('DELETE','zones/'+zoneId+'/dns_records/'+dns.id);}catch{cleanup.push('new DNS record');}if(tunnel)try{await api('DELETE','accounts/'+accountId+'/cfd_tunnel/'+tunnel.id);}catch{cleanup.push('new tunnel '+tunnel.id);}if(cleanup.length)e.message+=' Manual cleanup required for '+cleanup.join(', ');throw e;}
}
