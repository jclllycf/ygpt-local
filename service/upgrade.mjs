import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const inside=(p,r)=>{const rel=path.relative(r,p);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const plain=p=>{for(let q=path.resolve(p);;q=path.dirname(q)){if(fs.existsSync(q)&&fs.lstatSync(q).isSymbolicLink())throw Error('Linked migration path refused');if(q===path.dirname(q))break;}};
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const save=(p,v)=>{const tmp=p+'.upgrade-new';fs.writeFileSync(tmp,JSON.stringify(v,null,2));fs.renameSync(tmp,p);};

// Called only after the updater has drained and stopped this installation.
// Secrets, the vault key and SQLite files move byte for byte; no decryption.
export function upgradeData({install,data}){
  install=path.resolve(install);data=path.resolve(data);plain(install);plain(data);
  const dest=path.join(install,'data'),cfgPath=path.join(data,'ygpt.config.json');
  const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  if(cfg.product!=='YGPT Local')throw Error('Foreign data directory refused');
  if(cfg.engineModules&&path.resolve(cfg.engineModules).toLowerCase()!==path.join(install,'node_modules').toLowerCase())throw Error('Data belongs to a different installation');
  if(path.resolve(cfg.stateDir)!==path.join(data,'state'))throw Error('Review custom state directory before relocation');
  const migrating=data.toLowerCase()!==dest.toLowerCase();
  if(migrating&&(inside(install,data)||inside(data,install)||fs.existsSync(dest)))throw Error('Data migration destination already exists or overlaps');
  const links=[];
  const scan=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name),stat=fs.lstatSync(p);
    if(stat.isSymbolicLink()){
      const target=path.resolve(fs.readlinkSync(p));
      const rel=path.relative(data,p);
      if(!inside(target,data)||!/^state[\\/](?:home|engine-home)[\\/](?:\.bun[\\/]install[\\/]cache[\\/]|AppData[\\/]Local[\\/]Microsoft[\\/]Windows[\\/]INetCache[\\/]Content\.IE5$)/i.test(rel))throw Error('Unknown data link refused');
      links.push({relative:rel,target});
    }else if(stat.isDirectory())scan(p);
  }};
  if(migrating)scan(data);
  const original=fs.readFileSync(cfgPath);
  let moved=false;
  try{
    if(migrating){fs.renameSync(data,dest);moved=true;
      for(const link of links){const p=path.join(dest,link.relative);fs.unlinkSync(p);fs.symlinkSync(path.join(dest,path.relative(data,link.target)),p,'junction');}
    }
    const rebase=v=>typeof v==='string'&&(v.toLowerCase()===data.toLowerCase()||inside(v,data))&&path.isAbsolute(v)?path.join(dest,path.relative(data,v)):Array.isArray(v)?v.map(rebase):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rebase(x)])):v;
    const next=rebase(cfg);
    next.stateDir=path.join(dest,'state');next.startupDiagnostics=path.join(next.stateDir,'startup-error.json');
    next.protectedRoots=[...new Set([...(next.protectedRoots??[]),install,dest])];
    const fixture=path.join(install,'engine','build','YDesktop.exe');
    next.desktopAllowedApps=(next.desktopAllowedApps??[]).map(r=>path.resolve(r.path).toLowerCase()===fixture.toLowerCase()?{...r,sha256:hash(fixture)}:r);
    fs.mkdirSync(path.join(dest,'.migration'),{recursive:true});
    fs.writeFileSync(path.join(dest,'.migration','config-before-upgrade-'+Date.now()+'.json'),original,{flag:'wx'});
    save(path.join(dest,'ygpt.config.json'),next);
    save(path.join(dest,'migration-receipt.json'),{product:'YGPT Local',from:data,to:dest,at:new Date().toISOString(),linksRebased:links.length,credentialsCopiedWithoutDecryption:true});
    return {ok:true,data:dest,migrated:migrating,linksRebased:links.length};
  }catch(error){
    if(moved){
      for(const link of links){const p=path.join(dest,link.relative);try{fs.unlinkSync(p);fs.symlinkSync(link.target,p,'junction');}catch{}}
      fs.writeFileSync(path.join(dest,'ygpt.config.json'),original);fs.renameSync(dest,data);
    }
    throw error;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let input='';for await(const part of process.stdin)input+=part;
  try{console.log(JSON.stringify(upgradeData(JSON.parse(input))));}catch(e){console.log(JSON.stringify({ok:false,message:e.message}));process.exitCode=1;}
}
