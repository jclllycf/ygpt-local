// Fixed Windows shim launcher. No eval, generated shell text or user config.
import spawn from 'cross-spawn';
const [executable,...args]=process.argv.slice(2);
const child=spawn(executable,args,{env:process.env,cwd:process.cwd(),shell:false,windowsHide:true,stdio:'inherit'});
child.once('error',()=>{process.exitCode=1;});child.once('exit',(code)=>{process.exitCode=code??1;});
