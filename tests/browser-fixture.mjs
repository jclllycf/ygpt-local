import {chromium} from 'playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileP=promisify(execFile);
// Own the test browser through BrowserServer so cleanup kills only its
// disposable process, even if graceful browser.close waits indefinitely.
export async function launchFixtureBrowser(options={}){
 if(process.platform!=='win32')return chromium.launch(options);
 const server=await chromium.launchServer({...options,host:'127.0.0.1'});
 const child=server.process(),closed=new Promise(resolve=>child.once('close',resolve));
 let closing;
 const close=()=>closing??=(async()=>{
  // Playwright releases its websocket server on the child's close event, not
  // exit. Kill the exact disposable tree with a bounded asynchronous utility;
  // inherited stdout/stderr must not keep the test worker alive afterwards.
  if(child.exitCode===null&&child.signalCode===null){
   try{await execFileP('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000});}
   catch{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  }
  for(const stream of child.stdio)stream?.destroy?.();
  let timer;
  try{await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Disposable browser did not close after bounded cleanup')),10000);})]);}
  finally{clearTimeout(timer);}
 })();
 let browser;try{browser=await chromium.connect(server.wsEndpoint(),{timeout:10000});}catch(e){await close();throw e;}
 return new Proxy(browser,{get(target,key){if(key==='close')return close;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}
