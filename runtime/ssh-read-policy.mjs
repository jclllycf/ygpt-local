import path from 'node:path';
const plainReads=new Set(['uname','id','df','free','ls','cat','head','tail','grep','stat','wc','readlink','realpath']);
function readCommand(command){
 if(typeof command!=='string'||!command.trim()||command.length>12000||/[\r\n;$`\\<>()[\]{}&]/.test(command))return false;
 const pipelines=command.split('|');if(pipelines.some(p=>!p.trim())||pipelines.length>8)return false;
 return pipelines.every(part=>{
  const text=part.trim(),tokens=[],pattern=/\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"']+))(?=\s|$)/gy;let offset=0;
  while(offset<text.length){pattern.lastIndex=offset;const match=pattern.exec(text);if(!match)return false;tokens.push(match[1]??match[2]??match[3]);offset=pattern.lastIndex;}
  const [name,...args]=tokens;
  if(!name||name.includes('/')||name.includes('=')||/^\w+=/.test(part.trim()))return false;
  if(plainReads.has(name))return true;
  if(['pwd','whoami','uptime'].includes(name))return args.every(a=>['-L','-P','-p','-s','--pretty','--since'].includes(a));
  if(name==='hostname')return args.every(a=>['-f','-s','-d','-i','-I','-A','--fqdn','--short','--domain','--ip-address','--all-ip-addresses','--all-fqdns'].includes(a));
  if(name==='systemctl'){
   const words=args.filter(a=>!['--no-pager','--plain','--all','--full','--quiet'].includes(a));
   return ['status','show','is-active','is-enabled','list-units','list-unit-files'].includes(words[0])&&words.slice(1).every(a=>!a.startsWith('-'));
  }
  return false;
 });
}
export function isReadOnlySshInvocation({executable,argv:fullArgv,args}={}){
 const name=path.win32.basename(String(executable??fullArgv?.[0]??'')).toLowerCase();
 if(!['ssh','ssh.exe','plink','plink.exe'].includes(name))return false;
 const argv=args??fullArgv?.slice(1)??[];if(!Array.isArray(argv)||argv.some(a=>typeof a!=='string'))return false;
 const noValue=new Set(['-batch','-ssh','-no-antispoof','-T','-4','-6']),value=new Set(['-i','-l','-p','-P','-hostkey']);
 let i=0;for(;i<argv.length;i++){
  const flag=argv[i];if(noValue.has(flag))continue;
  if(value.has(flag)){if(!argv[++i]||argv[i].startsWith('-')||/[\r\n\0]/.test(argv[i]))return false;continue;}
  if(flag.startsWith('-'))return false;break;
 }
 const host=argv[i++];if(!host||!/^[\w.@:\[\]-]+$/.test(host)||host.startsWith('-'))return false;
 if(i>=argv.length)return false;
 return readCommand(argv.slice(i).join(' '));
}
