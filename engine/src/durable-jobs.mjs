import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cleanEnvironment} from './environment.mjs';
import {EngineError} from './file-engine.mjs';
// Reuse RC8/RC9 SQLite, DPAPI and Job Object worker. No separate task queue.
export class DurableJobs {
  constructor({terminal,stateDir,python,pythonArgs=[],ingressId='ygpt-native-candidate'}){Object.assign(this,{terminal,stateDir,python,pythonArgs,ingressId});}
  async call(request) {
    // submit() has already validated this exact cwd and broker authorization.
    // Pass that scope to the worker instead of reintroducing a root allowlist.
    const env={...await cleanEnvironment(this.stateDir),YGPT_STATE_DIR:this.stateDir,YGPT_INGRESS_ID:this.ingressId,YGPT_PROJECT_ROOTS:JSON.stringify([request.action==='submit'?request.cwd:this.terminal.root])};
    return new Promise((resolve,reject)=>{
      const child=spawn(this.python,[...this.pythonArgs,fileURLToPath(new URL('./workers/y_jobs.py',import.meta.url))],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
      const timer=setTimeout(()=>{child.kill();reject(new EngineError('JOB_CONTROL_TIMEOUT','Worker timed out; reconcile using the same job ID'));},15000);
      child.stdin.on('error',()=>{}); // early worker exit is reported by close/error
      child.stdout.on('data',b=>{out+=b;if(out.length>4*1024*1024)child.kill();});child.stderr.on('data',b=>{err=(err+b).slice(0,1000);});child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('close',code=>{clearTimeout(timer);try{const got=JSON.parse(out);if(code||got.error)throw new EngineError('JOB_FAILED',got.error??err);resolve(got);}catch(e){reject(e);}});child.stdin.end(JSON.stringify(request));
    });
  }
  async submit({id,executable,args=[],cwd,timeoutMs=21600000}){const spec=await this.terminal.validate({executable,args,cwd,timeoutMs});return this.call({action:'submit',id,argv:[spec.executable,...spec.args],cwd:spec.cwd,timeoutSeconds:Math.ceil(spec.timeoutMs/1000)});}
  status(id){return this.call({action:'status',id});}
  logs(id){return this.call({action:'tail',id});}
  cancel(id){return this.call({action:'cancel',id});}
  list(){return this.call({action:'list'});}
}
