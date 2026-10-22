import path from 'node:path';
import {scrub} from './durable.mjs';
// Finite descriptions of structured executors. Never infer a shell action
// from keywords: unknown/compound scripts always use the honest generic text.
export function describeOperation(name,a={},context={}){
  const base={title:'运行自定义命令',purpose:'继续当前任务；具体效果尚未确认。',target:a.cwd??context.cwd??'当前目录及命令可能访问的其他位置',
    impact:'可能读写文件、联网或启动程序。具体命令见 Details。',denied:'跳过这次命令，现有文件不变。',risk:'需要确认',reversible:'部分修改可能无法撤销',administrator:'使用当前用户权限；不会自动提权。',
    technical:scrub(JSON.stringify({tool:name,arguments:a},null,2)),source:null};
  if(name==='y_download_file'){
    const url=new URL(a.url);const fido=url.hostname==='raw.githubusercontent.com'&&url.pathname.startsWith('/pbatard/Fido/');
    return {...base,title:fido?'下载 Windows 镜像辅助工具 Fido':'下载文件',purpose:fido?'为 Windows 安装镜像准备下载辅助工具。':'把指定来源的文件保存到本机。',target:a.destination,
      source:fido?'GitHub · pbatard/Fido':url.origin+url.pathname,impact:'保存文件并检查大小、校验值；不运行脚本，不改动磁盘分区。',
      denied:'跳过下载，原目标文件保持不变。',risk:/\.(ps1|exe|msi|cmd|bat|js)$/i.test(url.pathname)?'外部程序文件 · 下载后不会运行':'普通文件下载',
      reversible:'可以删除新下载的文件；替换已有文件会先保留到下载校验完成。'};
  }
  if(name==='y_verify_checksum')return {...base,title:'核对文件是否完整',purpose:'计算 SHA-256，检查文件是否与指定校验值一致。',target:a.path,impact:'只读取这个文件，不改变文件内容。',denied:'不计算校验值，文件保持原样。',risk:'只读检查',reversible:'不会修改文件'};
  if(context.device){
    const d=context.device;
    return {...base,title:'清空指定 U 盘并重建分区',purpose:'为这个 U 盘准备新的启动盘布局。',target:`${d.model} · ${d.capacityLabel} · 磁盘 ${d.number} · 序列号尾部 ${d.serialTail}`,
      impact:`将删除这个设备的分区和已有数据：${d.partitions.join('、')}。设备身份改变时，原批准失效。`,denied:'不更改这个 U 盘，原有数据和分区保持不变。',risk:'高风险 · 数据可能永久丢失',reversible:'不可可靠撤销；需要先备份',administrator:'通常需要 Windows 管理员权限；仍需单独通过 UAC。'};
  }
  if(name==='y_job_submit')return {...base,title:'运行项目任务',purpose:'在固定文件夹内启动一项可在后台持续执行的任务。',target:a.cwd,impact:'运行指定程序；它可能读取或更新项目文件。允许后，仅持有本任务结果凭据的调用可查看日志和取消任务。',denied:'不启动这个任务；项目文件保持原样。',reversible:'取决于程序的实际修改；可以停止任务，停止不会撤销已完成的修改。'};
  if(['y_file_write','y_file_edit','y_file_patch','y_file_move','y_file_mkdir'].includes(name)){
    const target=a.path??`${a.source} → ${a.destination}`;
    return {...base,title:({y_file_write:'保存文件',y_file_edit:'修改文件内容',y_file_patch:'修改文件内容',y_file_move:'移动文件或文件夹',y_file_mkdir:'新建文件夹'})[name],purpose:'完成当前任务要求的文件操作。',target,impact:name==='y_file_move'?'将原位置的内容移至目标位置；原路径将改变。':name==='y_file_mkdir'?'创建指定文件夹。':'写入请求提供的内容；原有内容可能被替换。',denied:'跳过本次文件修改，现有内容保持原样。',reversible:name==='y_file_mkdir'?'空文件夹可以删除':'需要原文件备份才能撤销修改'};
  }
  if(['y_file_read','y_file_read_many','y_file_list','y_file_info','y_search_text','y_search_files'].includes(name))return {...base,title:'读取文件信息',purpose:'读取当前任务需要的文件信息。',target:a.path??(a.paths??[]).join('、'),impact:'把指定内容返回对话，可能含私人信息；不修改文件。',denied:'不读取，相关步骤暂停。',risk:'私人信息读取',reversible:'读取不会改写文件'};
  return base;
}
