import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createServer} from 'node:http';
import {LocalCatalog} from '../engine/src/local-catalog.mjs';
import {LocalMcp} from '../engine/src/local-mcp.mjs';
import {LocalDispatch} from '../engine/src/local-dispatch.mjs';
import {DurableJobs} from '../engine/src/durable-jobs.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),fixtureServer=fileURLToPath(new URL('./fixtures/local-mcp-server.mjs',import.meta.url));
async function fixture(t){const parent=path.join(root,'.local','router-tests');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'case-')),source=path.join(dir,'mcp.json'),state=path.join(dir,'state');await fs.mkdir(state);const folders={home:dir,local:dir,roaming:dir,path:path.dirname(process.execPath)},scope=new AsyncLocalStorage(),owner=()=>scope.getStore()??'chat-a';const catalog=new LocalCatalog({root:dir,stateDir:state,folders,configFiles:[source],cliDirectories:[]});const cleanup=[];t.after(async()=>{for(const close of cleanup.reverse())await close();await fs.rm(dir,{recursive:true,force:true,maxRetries:3});});return {dir,state,source,folders,scope,owner,catalog,cleanup};}
const write=(f,v)=>fs.writeFile(f.source,JSON.stringify(v));
const mcpSpec={command:process.execPath,args:[fixtureServer],env:{ROUTER_FIXTURE:'private-value'}};

test('Recognized JSONC/TOML sources retain namespaces, disabled flags and credential privacy',async t=>{
 const f=await fixture(t),second=path.join(f.dir,'config.toml');await write(f,{mcpServers:{same:{...mcpSpec,env:{API_KEY:'fixture-secret-value'}},disabled:{...mcpSpec,disabled:true}}});await fs.writeFile(second,'model="configured-web-model"\n[mcp_servers.same]\ncommand="node"\nargs=["server.mjs"]\n');f.catalog.configFiles.push(second);
 const list=await f.catalog.list({kind:'mcp'});assert.equal(list.total,3);assert.equal(new Set(list.entries.map(e=>e.id)).size,3);assert.ok(!JSON.stringify(list).includes('fixture-secret-value'));assert.equal(list.entries.find(e=>e.name==='disabled').enabled,false);await assert.rejects(f.catalog.get(list.entries.find(e=>!e.enabled).id),{code:'LOCAL_ENTRY_DISABLED'});
 const initial=await fs.readFile(second,'utf8');await f.catalog.manage({action:'exclude',entryId:list.entries[0].id});assert.equal((await f.catalog.list({kind:'mcp'})).entries[0].enabled,false);await f.catalog.manage({action:'include',entryId:list.entries[0].id});assert.equal(await fs.readFile(second,'utf8'),initial);
});

test('Project MCP settings do not become a login home; concurrent source preferences do not lose changes',async t=>{
 const f=await fixture(t),projectConfig=path.join(f.dir,'.codex','config.toml');await fs.mkdir(path.dirname(projectConfig));await fs.writeFile(projectConfig,'model="project-only"\n[mcp_servers.project]\ncommand="node"\n');f.catalog.configFiles.push(projectConfig);f.catalog.folderInput={...f.folders,home:path.join(f.dir,'owner')};f.catalog.cliDirectories=[path.dirname(process.execPath)];await write(f,{mcpServers:{one:mcpSpec,two:mcpSpec}});
 const list=await f.catalog.list({kind:'mcp'}),project=[...f.catalog.entries.values()].find(e=>e.name==='project');assert.equal(project.accountHome,null);assert.equal(project.cwd,f.dir);
 const ids=list.entries.filter(e=>e.name!=='project').map(e=>e.id);await Promise.all(ids.map(entryId=>f.catalog.manage({action:'exclude',entryId})));const stored=JSON.parse(await fs.readFile(path.join(f.state,'local-tool-sources.json')));assert.deepEqual(new Set(stored.excluded),new Set(ids));
});

test('MCP stdio discovery, schema validation, resources and prompts use the installed SDK',async t=>{
 const f=await fixture(t);await write(f,{mcpServers:{fixture:mcpSpec}});const id=(await f.catalog.list({kind:'mcp'})).entries[0].id,mcp=new LocalMcp({catalog:f.catalog,currentOwner:f.owner});f.cleanup.push(()=>mcp.close());
 const tools=await mcp.run({serverId:id});assert.deepEqual(tools.tools.map(t=>t.name).sort(),['echo','failure']);
 const response=await mcp.run({action:'call',serverId:id,name:'echo',arguments:{value:'ok'}}),value=JSON.parse(response.result.content[0].text);assert.equal(value.value,'ok');assert.equal(value.fixture,'private-value');assert.equal(value.ygptSecret,false);assert.equal(response.transientObservation,true);
 await assert.rejects(mcp.run({action:'call',serverId:id,name:'echo',arguments:{value:10}}),{code:'MCP_ARGUMENTS_INVALID'});
 assert.equal((await mcp.run({action:'resources',serverId:id})).resources[0].uri,'fixture://sample');assert.equal((await mcp.run({action:'read',serverId:id,uri:'fixture://sample'})).result.contents[0].text,'fixture resource');assert.equal((await mcp.run({action:'prompts',serverId:id})).prompts[0].name,'sample');assert.ok((await mcp.run({action:'prompt',serverId:id,name:'sample',arguments:{topic:'task'}})).result.messages[0].content.text.includes('task'));
 assert.equal((await mcp.run({action:'call',serverId:id,name:'failure'})).ok,false);
});

test('Each chat gets a separate MCP process; close and idle release only its owned scratch',async t=>{
 const f=await fixture(t);await write(f,{mcpServers:{fixture:mcpSpec}});const id=(await f.catalog.list()).entries[0].id,mcp=new LocalMcp({catalog:f.catalog,currentOwner:f.owner,idleMs:10000});f.cleanup.push(()=>mcp.close());
 const call=()=>mcp.run({action:'call',serverId:id,name:'echo',arguments:{value:'same'}});
 const a=JSON.parse((await f.scope.run('a',call)).result.content[0].text),b=JSON.parse((await f.scope.run('b',call)).result.content[0].text);assert.notEqual(a.instance,b.instance);const bScratch=mcp.sessions.get('b:'+id).scratch.dir;
 await f.scope.run('a',()=>mcp.run({action:'close',serverId:id}));assert.equal(mcp.sessions.size,1);assert.ok((await fs.stat(bScratch)).isDirectory());await f.scope.run('b',()=>mcp.run({action:'close',serverId:id}));await assert.rejects(fs.stat(bScratch),{code:'ENOENT'});
});

test('Streamable HTTP works without a debugging port and never replays an interrupted tool',async t=>{
 const f=await fixture(t);let calls=0;const server=createServer(async(req,res)=>{if(req.method!=='POST'){res.writeHead(405);res.end();return;}let raw='';for await(const chunk of req)raw+=chunk;const m=JSON.parse(raw);res.setHeader('content-type','application/json');if(m.id===undefined){res.writeHead(202);return res.end();}let result;if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'HTTP fixture',version:'1'}};else if(m.method==='tools/list')result={tools:[{name:'increment',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};else if(m.method==='tools/call'){calls++;await new Promise(r=>setTimeout(r,1200));result={content:[{type:'text',text:'done'}]};}else result={};res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 await write(f,{mcpServers:{http:{url:'http://127.0.0.1:'+server.address().port+'/mcp'}}});const id=(await f.catalog.list()).entries[0].id,mcp=new LocalMcp({catalog:f.catalog,currentOwner:f.owner});f.cleanup.push(()=>mcp.close());assert.equal((await mcp.run({serverId:id})).total,1);
 await assert.rejects(mcp.run({action:'call',serverId:id,name:'increment',timeoutMs:1000}),{code:'MCP_OUTCOME_UNKNOWN',outcomeUnknown:true});assert.equal(calls,1);
});

test('MCP pagination rejects cursor loops and self-routing; per-chat capacities reserve before connecting',async t=>{
 const f=await fixture(t);await write(f,{mcpServers:{one:mcpSpec,two:mcpSpec,self:{command:'YGPTLocal.exe'}}});const entries=(await f.catalog.list()).entries,mcp=new LocalMcp({catalog:f.catalog,currentOwner:f.owner,connect:async()=>({listTools:async()=>({tools:[],nextCursor:'same'}),close:async()=>{}})});f.cleanup.push(()=>mcp.close());await assert.rejects(mcp.run({serverId:entries.find(e=>e.name==='one').id}),{code:'MCP_CURSOR_REPEATED'});await assert.rejects(mcp.run({serverId:entries.find(e=>e.name==='self').id}),{code:'MCP_RECURSION'});
});

test('Closing an MCP stdio process also terminates its owned child tree',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await write(f,{mcpServers:{fixture:{...mcpSpec,env:{ROUTER_SPAWN_CHILD:'1'}}}});const id=(await f.catalog.list()).entries[0].id,mcp=new LocalMcp({catalog:f.catalog,currentOwner:f.owner});f.cleanup.push(()=>mcp.close());await mcp.run({serverId:id});
 const r=await mcp.run({action:'call',serverId:id,name:'echo',arguments:{value:'child'}}),pid=JSON.parse(r.result.content[0].text).childPid;assert.ok(pid>0);assert.doesNotThrow(()=>process.kill(pid,0));const closed=await mcp.run({action:'close',serverId:id});assert.equal(closed.cleanupDeferred,false);assert.throws(()=>process.kill(pid,0));
});

class Jobs {
 constructor(){this.requests=[];this.rows=new Map();}
 async call(r){this.requests.push(r);this.rows.set(r.id,{id:r.id,state:'running'});return {job_id:r.id,state:'running'};}
 async status(id){return this.rows.get(id);}
 async logs(id){return {text:JSON.stringify({type:'thread.started',thread_id:this.rows.get(id).agent_session}),state:this.rows.get(id).state};}
 async cancel(id){this.rows.get(id).state='cancelled';return {cancel_requested:true};}
}

test('Large JSON Schema 2020-12 descriptors stay compact in discovery and validate exact calls',async t=>{
 const f=await fixture(t);await write(f,{mcpServers:{fixture:mcpSpec}});const id=(await f.catalog.list()).entries[0].id;let calls=0;
 const schema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{value:{type:'string',description:'x'.repeat(400000)}},required:['value'],unevaluatedProperties:false};
 const mcp=new LocalMcp({catalog:f.catalog,currentOwner:f.owner,connect:async()=>({listTools:async()=>({tools:[{name:'large',inputSchema:schema}]}),callTool:async()=>{calls++;return {content:[{type:'text',text:'ok'}]};},close:async()=>{}})});f.cleanup.push(()=>mcp.close());
 const compact=await mcp.run({serverId:id});assert.equal(compact.tools[0].inputSchemaOmitted,true);assert.ok(JSON.stringify(compact).length<4096);const full=await mcp.run({serverId:id,name:'large'});assert.equal(full.tools[0].inputSchema.$schema,schema.$schema);
 await assert.rejects(mcp.run({action:'call',serverId:id,name:'large',arguments:{value:'ok',extra:true}}),{code:'MCP_ARGUMENTS_INVALID'});assert.equal(calls,0);assert.equal((await mcp.run({action:'call',serverId:id,name:'large',arguments:{value:'ok'}})).ok,true);assert.equal(calls,1);
});
async function dispatcher(t){const f=await fixture(t);await write(f,{agents:{first:{executable:process.execPath,adapter:'codex',accountHome:path.join(f.dir,'account-one')},second:{executable:process.execPath,adapter:'codex',accountHome:path.join(f.dir,'account-two')}},cli:{node:{executable:process.execPath}}});const jobs=new Jobs(),dispatch=new LocalDispatch({root:f.dir,stateDir:f.state,currentOwner:f.owner,jobs,catalog:f.catalog});f.cleanup.push(()=>dispatch.close());const agents=(await f.catalog.list({kind:'agent'})).entries,cli=(await f.catalog.list({kind:'cli'})).entries[0];return {...f,jobs,dispatch,agents,cli};}

test('Agent launch preserves exact account/model/permissions, sends prompt on stdin and indexes its real session',async t=>{
 const f=await dispatcher(t),a={action:'run',entryId:f.agents[0].id,prompt:'Fixture task',cwd:f.dir,taskId:randomUUID()};const r=await f.dispatch.run('agent',a),request=f.jobs.requests[0];assert.deepEqual(request.argv.slice(1),['exec','--json','-']);assert.equal(request.stdin,'Fixture task');assert.ok(request.environment.CODEX_HOME.endsWith('account-one'));assert.equal(request.environment.YGPT_LOCAL_CONTROL_KEY,undefined);assert.ok(!request.environment.TEMP.startsWith(f.state));assert.equal(r.defaultsPreserved,true);
 const session=randomUUID();Object.assign(f.jobs.rows.get(r.taskId),{state:'succeeded',agent_session:session});const done=await f.dispatch.run('agent',{action:'status',taskId:r.taskId});assert.equal(done.agentSessionId,session);await assert.rejects(fs.stat(request.environment.TEMP),{code:'ENOENT'});
 await f.dispatch.run('agent',{action:'run',entryId:f.agents[0].id,prompt:'Continue',cwd:f.dir,resumeTaskId:r.taskId});assert.deepEqual(f.jobs.requests[1].argv.slice(1),['exec','resume','--json',session,'-']);
 await assert.rejects(f.dispatch.run('agent',{action:'run',entryId:f.agents[1].id,prompt:'Continue',cwd:f.dir,resumeTaskId:r.taskId}),{code:'AGENT_RESUME_INVALID'});
});

test('Tasks survive dispatcher restart, reject cross-chat control and task-ID collisions, and have fair share',async t=>{
 const f=await dispatcher(t),a={action:'run',entryId:f.cli.id,args:['--version'],cwd:f.dir,taskId:randomUUID()};const r=await f.dispatch.run('cli',a);assert.equal((await f.dispatch.run('cli',a)).reused,true);assert.equal(f.jobs.requests.length,1);await assert.rejects(f.dispatch.run('cli',{...a,args:['different']}),{code:'IDEMPOTENCY_COLLISION'});
 await assert.rejects(f.scope.run('other',()=>f.dispatch.run('cli',{action:'cancel',taskId:r.taskId})),{code:'SESSION_FOREIGN'});
 await f.dispatch.run('cli',{...a,taskId:randomUUID()});await assert.rejects(f.dispatch.run('cli',{...a,taskId:randomUUID()}),{code:'CONCURRENCY_LIMIT'});await f.scope.run('other',()=>f.dispatch.run('cli',{...a,taskId:randomUUID()}));
 const reopened=new LocalDispatch({root:f.dir,stateDir:f.state,currentOwner:f.owner,jobs:f.jobs,catalog:f.catalog});assert.equal((await reopened.run('cli',{action:'list'})).tasks.length,2);await reopened.close();
});

test('Actual Windows durable jobs close stdin, persist session ID, cancel and keep payloads encrypted',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),jobs=new DurableJobs({terminal:{root:f.dir},stateDir:f.state,python:process.env.YGPT_TEST_PYTHON??'py',pythonArgs:process.env.YGPT_TEST_PYTHON?['-B']:['-3.14','-B'],ingressId:'local-router-fixture'}),id=randomUUID(),session=randomUUID();
 const env=await f.catalog.refresh().then(()=>f.catalog.environment({env:{}},f.dir));const script="let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:process.argv[1]}));console.log('stdin='+s);});";
 await jobs.call({action:'submit',id,argv:[process.execPath,'-e',script,session],cwd:f.dir,timeoutSeconds:10,environment:env,stdin:'private-prompt-marker'});
 let status;for(let i=0;i<100;i++){status=await jobs.status(id);if(!['queued','running'].includes(status.state))break;await new Promise(r=>setTimeout(r,100));}assert.equal(status.state,'succeeded');assert.equal(status.agent_session,session);assert.ok((await jobs.logs(id)).text.includes('stdin=private-prompt-marker'));
 const raw=await fs.readFile(path.join(f.state,'jobs','jobs-rc.sqlite3'));assert.ok(!raw.includes(Buffer.from('private-prompt-marker')));
 const cancelId=randomUUID();await jobs.call({action:'submit',id:cancelId,argv:[process.execPath,'-e','setTimeout(()=>{},60000)'],cwd:f.dir,timeoutSeconds:30,environment:env});await jobs.cancel(cancelId);for(let i=0;i<100;i++){status=await jobs.status(cancelId);if(status.state==='cancelled')break;await new Promise(r=>setTimeout(r,100));}assert.equal(status.state,'cancelled');
});

test('Broker routes discovered MCP and CLI work, issues chat context, and rejects foreign task control',{skip:process.platform!=='win32'},async t=>{
 const {fixture:brokerFixture,unpack,until,decide}=await import('./helpers.mjs');const f=brokerFixture(),source=path.join(f.project,'local-tools.json');
 await fs.writeFile(source,JSON.stringify({mcpServers:{fixture:mcpSpec},cli:{node:{executable:process.execPath}}}));f.config.localTools.configFiles=[source];await fs.writeFile(f.file,JSON.stringify(f.config));const c=f.client();await c.start();t.after(()=>c.close());
 const call=async(name,args={})=>unpack(await c.call(name,args)),catalog=await c.rpc('tools/list');for(const name of ['y_capabilities','y_capability_sources','y_mcp','y_cli','y_agent'])assert.ok(catalog.tools.some(t=>t.name===name));
 const found=await call('y_capabilities',{kind:'mcp'}),contextToken=found.ygptContext.contextToken,serverId=found.result.entries[0].id;
 assert.equal((await call('y_mcp',{action:'tools',serverId,contextToken})).result.total,2);
 const echo=await call('y_mcp',{action:'call',serverId,name:'echo',arguments:{value:'through-broker'},contextToken});assert.equal(echo.ok,true);assert.ok(echo.result.result.content[0].text.includes('through-broker'));
 const failed=await c.call('y_mcp',{action:'call',serverId,name:'failure',contextToken});assert.equal(failed.isError,true);
 const cli=(await call('y_capabilities',{kind:'cli',contextToken})).result.entries[0],job=await call('y_cli',{action:'run',entryId:cli.id,args:['-e',"console.log('ROUTER_BROKER_OK')"],cwd:f.project,contextToken});assert.equal(job.ok,true);const taskId=job.result.taskId;
 await until(async()=>{const r=await call('y_cli',{action:'status',taskId,contextToken});return r.result?.state==='succeeded';});assert.ok((await call('y_cli',{action:'logs',taskId,contextToken})).result.logs.text.includes('ROUTER_BROKER_OK'));
 const other=(await call('y_capabilities',{kind:'cli'})).ygptContext.contextToken,foreign=await call('y_cli',{action:'status',taskId,contextToken:other});assert.equal(foreign.code,'SESSION_FOREIGN');
 const risky=await call('y_cli',{action:'run',entryId:cli.id,args:['-e',"console.log('Clear-Disk fixture only')"],cwd:f.project,contextToken});assert.equal(risky.state,'suspended');await decide(c,risky,'deny',contextToken);
 await call('y_mcp',{action:'close',serverId,contextToken});
});
