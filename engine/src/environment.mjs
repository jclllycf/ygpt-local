import fs from 'node:fs/promises';
import path from 'node:path';
// An interpreter is not an OS sandbox. The outer RC9 broker owns permission decisions.
export async function cleanEnvironment(stateDir) {
  const env={};
  for(const k of ['PATH','SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']) if(process.env[k])env[k]=process.env[k];
  const home=path.join(stateDir,'home'), temp=path.join(stateDir,'tmp');
  for(const dir of [home,temp,path.join(home,'AppData','Roaming'),path.join(home,'AppData','Local')])await fs.mkdir(dir,{recursive:true});
  return {...env,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'AppData','Roaming'),LOCALAPPDATA:path.join(home,'AppData','Local'),TEMP:temp,TMP:temp,
    PATHEXT:'.COM;.EXE;.BAT;.CMD',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',GIT_TERMINAL_PROMPT:'0',
    DESKTOP_COMMANDER_DISABLE_TELEMETRY:'1',DC_FLAG_URL:'http://127.0.0.1:1/disabled'};
}
