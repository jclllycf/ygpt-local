import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonical,route} from './access-policy.mjs';
import {stable,digest} from './durable.mjs';
// Conversation grants for the local-review surface: only a fixed file or
// directory read. Process and job grants use reviewScope (exact hashes).
export function chatScope(name,args){
  if(['y_file_read','y_file_info','y_file_list','y_verify_checksum'].includes(name)){
    try{const r=route(args.path);if(!r.sensitive&&!['private','vault'].includes(r.permission)&&!r.system)return {eligible:true,key:digest(stable([name,args,canonical(args.path)])),explanation:'只限这个固定文件/目录的同一种读取；最长 2 小时，可随时关闭上下文。'};}catch{}
  }
  return {eligible:false,key:null,explanation:'这类命令、系统、磁盘或凭据操作必须逐次确认，不能按对话放行。'};
}
