const str={type:'string'},num={type:'integer'},shape=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const rows=[
 ['get_config',{},[]],['read_file',{path:str,offset:num,length:num},['path']],['read_multiple_files',{paths:{type:'array',items:str,maxItems:30}},['paths']],
 ['write_file',{path:str,content:str,mode:{type:'string',enum:['rewrite','append']}},['path','content']],['create_directory',{path:str},['path']],['list_directory',{path:str,depth:num},['path']],['move_file',{source:str,destination:str},['source','destination']],
 ['start_search',{path:str,pattern:str,searchType:{type:'string',enum:['files','content']},ignoreCase:{type:'boolean'},filePattern:str,maxResults:num,timeout_ms:num,literalSearch:{type:'boolean'},includeHidden:{type:'boolean'}},['path','pattern']],
 ['get_more_search_results',{sessionId:str,offset:num,length:num},['sessionId']],['stop_search',{sessionId:str},['sessionId']],['list_searches',{},[]],['get_file_info',{path:str},['path']],
 ['edit_block',{file_path:str,old_string:str,new_string:str,expected_replacements:num,origin:str},['file_path','old_string','new_string']],
 ['start_process',{command:str,shell:str,timeout_ms:num},['command']],['read_process_output',{pid:num,timeout_ms:num,offset:num,length:num},['pid']],['interact_with_process',{pid:num,input:str,timeout_ms:num},['pid','input']],['force_terminate',{pid:num},['pid']],['list_sessions',{},[]],['list_processes',{},[]],['kill_process',{pid:num},['pid']],['get_usage_stats',{},[]]
];
export const compatCatalog=rows.map(([name,p,r])=>({name,description:'Compatibility '+name+'. Prefer corresponding typed y_ file/search/process tools.',inputSchema:shape(p,r)}));
