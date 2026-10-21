// Private compatibility worker; authorization and snapshots live in the broker.
import readline from 'node:readline';
import {compatCatalog} from './compat-catalog.mjs';
import {createCompatEngine} from './compat-engine.mjs';
const engine=createCompatEngine(),emit=m=>process.stdout.write(JSON.stringify(m)+'\n');
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{void(async()=>{let m;try{m=JSON.parse(line);if(m.id===undefined)return;let result;if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,serverInfo:{name:'YGPT Local compatibility worker',version:'1.0.0-rc.3'},capabilities:{tools:{}}};else if(m.method==='tools/list')result={tools:compatCatalog};else if(m.method==='tools/call')result=await engine.invoke(m.params.name,m.params.arguments??{});else throw Error('Unsupported method');emit({jsonrpc:'2.0',id:m.id,result});}catch(e){emit({jsonrpc:'2.0',id:m?.id??null,error:{code:-32000,message:e.message}});}})();});
input.once('close',()=>{void engine.close().finally(()=>process.exit(0));});
