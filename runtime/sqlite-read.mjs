import {DatabaseSync} from 'node:sqlite';
export function sqliteRead(args){
 const sql=String(args.sql??'').trim(),limit=args.maxRows??200;
 if(!Number.isInteger(limit)||limit<1||limit>1000||sql.length>20000)throw Error('Invalid read limit or SQL length');
 const pragma=/^PRAGMA\s+(?:main\.)?(?:table_info|table_xinfo|table_list|index_list|index_info|index_xinfo|foreign_key_list|database_list|compile_options)(?:\s*\([^;]*\))?\s*;?$/i;
 if(!/^(?:SELECT|WITH|EXPLAIN)\b/i.test(sql)&&!pragma.test(sql))throw Error('Only read-only SQL queries or schema inspection are accepted');
 const db=new DatabaseSync(args.path,{readOnly:true,enableLoadExtension:false});
 try{
  db.exec('PRAGMA query_only=ON');
  const statement=db.prepare(sql);statement.setReadBigInts(true);
  const rows=[];let truncated=false;
  for(const row of statement.iterate(...(args.params??[]))){if(rows.length>=limit){truncated=true;break;}rows.push(Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?String(v):v instanceof Uint8Array?{binaryBytes:v.length}:typeof v==='string'&&v.length>16000?{text:v.slice(0,16000),truncated:true}:v])));}
  return {readOnly:true,path:args.path,rows,rowCount:rows.length,truncated,maxRows:limit};
 }finally{db.close();}
}
