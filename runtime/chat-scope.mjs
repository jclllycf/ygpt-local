import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonical,route} from './access-policy.mjs';
import {stable,digest} from './durable.mjs';
export function chatScope(name,args){
  if(['read_file','get_file_info','list_directory','verify_checksum'].includes(name)){
    try{const r=route(args.path);if(!r.sensitive&&!['private','vault'].includes(r.permission)&&!r.system)return {eligible:true,key:digest(stable([name,args,canonical(args.path)])),explanation:'只限这个固定文件/目录的同一种读取；最长 2 小时，可随时关闭上下文。'};}catch{}
  }
  if(name==='run_trusted_workflow'||name==='job_submit'){
    try{
      const [exe,script,...rest]=args.argv;
      if(route(args.cwd).permission==='project'&&path.isAbsolute(exe)&&path.isAbsolute(script)&&route(script).permission==='project'&&/\.(mjs|cjs|js|py)$/i.test(script)){
        const hashes=[exe,script].map(p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
        return {eligible:true,key:digest(stable([name,args,hashes])),explanation:'只限固定目录、程序、参数和入口脚本哈希；最长 2 小时。代码仍按当前用户权限运行。'};
      }
    }catch{}
  }
  return {eligible:false,key:null,explanation:'这类命令、系统、磁盘或凭据操作必须逐次确认，不能按对话放行。'};
}
