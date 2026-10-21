import {spawn} from 'node:child_process';
import {rgPath} from '@vscode/ripgrep';
import {EngineError} from './file-engine.mjs';
export class YSearchEngine {
  constructor(fileEngine){this.file=fileEngine;}
  async execute(args,{timeoutMs=15000,maxOutputBytes=4*1024*1024}={}) {
    return new Promise((resolve,reject)=>{
      const excluded=['.git/**','.env*','.ssh/**','.aws/**','.azure/**','.kube/**','.codex/**','.agents/**','credentials*','cookies*','*.pem','*.pfx','*.p12'];
      const guard=excluded.flatMap(g=>['--iglob','!'+(g.includes('/')?'**/':'')+g]),end=args.indexOf('--');
      // ripgrep's LAST matching glob wins. Owner exclusions must come after
      // caller globs, but before the -- pattern/path delimiter.
      const safeArgs=end<0?[...args,...guard]:[...args.slice(0,end),...guard,...args.slice(end)];
      const child=spawn(rgPath,['--no-config',...safeArgs],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot},stdio:['ignore','pipe','pipe']});
      const chunks=[];let length=0,stderr='',truncated=false,timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
      child.stdout.on('data',b=>{const room=maxOutputBytes-length;if(room>0){chunks.push(b.subarray(0,room));length+=Math.min(room,b.length);}if(b.length>room){truncated=true;child.kill();}});
      child.stderr.on('data',b=>{stderr=(stderr+b).slice(0,1500);});child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('close',code=>{clearTimeout(timer);if(code>1&&!truncated&&!timedOut)return reject(new EngineError('SEARCH_FAILED',stderr));resolve({text:Buffer.concat(chunks).toString('utf8'),truncated,timedOut});});
    });
  }
  async findText(directory,needle,{regex=false,maxMatches=100,maxDepth=20,maxBytes=5_000_000,offset=0,glob,caseSensitive=true,timeoutMs=15000}={}) {
    if(typeof needle!=='string'||!needle.length||needle.length>500)throw new EngineError('BAD_PATTERN','Pattern must have 1-500 characters');
    if(![maxMatches,maxDepth,maxBytes,offset,timeoutMs].every(Number.isInteger)||maxMatches<1||maxMatches>2000||maxDepth<0||maxDepth>30||maxBytes<1||maxBytes>32*1024*1024||offset<0||offset>5000||timeoutMs<100||timeoutMs>30000)throw new EngineError('BAD_LIMITS','Invalid search bounds');
    const root=await this.file.resolve(directory),args=['--json','--hidden','--max-depth',String(maxDepth+1),'--max-filesize',String(maxBytes),'--max-count',String(offset+maxMatches+1),'-g','!.git/**','-g','!.snapshots/**','-g','!node_modules/**'];
    if(!regex)args.push('--fixed-strings');if(!caseSensitive)args.push('-i');if(glob)args.push('-g',glob);args.push('--',needle,root);
    const result=await this.execute(args,{timeoutMs}),matches=[];const files=new Set();let statistics=null;
    for(const line of result.text.split('\n')){let row;try{row=JSON.parse(line);}catch{continue;}if(row.type==='summary'){statistics=row.data.stats;continue;}if(row.type!=='match')continue;const d=row.data,p=d.path.text;files.add(p);const first=d.submatches[0];matches.push({path:p.slice(root.length+1).replaceAll('\\','/'),line:d.line_number,column:[...Buffer.from(d.lines.text).subarray(0,first?.start??0).toString('utf8')].length+1,preview:d.lines.text.trimEnd().slice(0,500)});}
    return {engine:'ripgrep',regexEngine:'Rust regex; PCRE2 disabled',matches:matches.slice(offset,offset+maxMatches),visitedFiles:statistics?.searches??null,matchedFiles:files.size,statistics,offset,nextOffset:offset+maxMatches,truncated:result.truncated||matches.length>=offset+maxMatches,timedOut:result.timedOut};
  }
  async findFiles(directory,pattern='*',{offset=0,limit=100}={}) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>1000||typeof pattern!=='string'||pattern.length>300)throw new EngineError('BAD_LIMITS','Invalid file search');
    const root=await this.file.resolve(directory),got=await this.execute(['--files','--hidden','-g','!.git/**','-g','!node_modules/**','-g',pattern,root]);
    const all=got.text.split(/\r?\n/).filter(Boolean).map(p=>p.slice(root.length+1).replaceAll('\\','/'));
    return {engine:'ripgrep',paths:all.slice(offset,offset+limit),offset,nextOffset:offset+limit,truncated:got.truncated||all.length>offset+limit,timedOut:got.timedOut};
  }
}
