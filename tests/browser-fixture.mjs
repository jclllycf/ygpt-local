import {chromium} from 'playwright';
// Own the test browser through BrowserServer so cleanup kills only its
// disposable process, even if graceful browser.close waits indefinitely.
export async function launchFixtureBrowser(options={}){
 if(process.platform!=='win32')return chromium.launch(options);
 const server=await chromium.launchServer({...options,host:'127.0.0.1'});
 const close=async()=>{const child=server.process();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;} }; // Exact fixture PID; avoids the local Windows taskkill /T teardown hang.
 let browser;try{browser=await chromium.connect(server.wsEndpoint(),{timeout:10000});}catch(e){await close();throw e;}
 return new Proxy(browser,{get(target,key){if(key==='close')return close;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}
