import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const RUNTIME=path.dirname(fileURLToPath(import.meta.url));
export const INSTALL=path.dirname(RUNTIME);
const configFile=process.env.YGPT_CONFIG??path.join(INSTALL,'ygpt.config.json');
const raw=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')):{};
const abs=v=>path.resolve(path.dirname(configFile),v);
export const config={
  version: '1.0.17',
  readOnlyAutoAllow:raw.rc11Patch3===true||raw.readOnlyAutoAllow===true,
  blacklistDefaultAllow:raw.blacklistDefaultAllow===true,
  chatAppConsent:raw.rc11Candidate===true&&raw.chatAppConsent===true,
  rc10Candidate:raw.rc10Candidate===true,
  deployment:raw.deployment??'isolated',
  engineRoot:raw.engineRoot?abs(raw.engineRoot):undefined,
  browser:raw.browser??{},
  desktopAllowedApps:raw.desktopAllowedApps??[],
  // Extra owner-listed ChatGPT Desktop Agent folders, beyond the built-in ones.
  agentProtectedRoots:Array.isArray(raw.agentProtectedRoots)?raw.agentProtectedRoots:[],
  // When true, only owner-enrolled executables (path + SHA-256) can be bound;
  // otherwise any non-protected window can be bound after Allow once.
  desktopRequireEnrollment:raw.desktopRequireEnrollment===true,
  // The config file is authoritative. An inherited YGPT_STATE_DIR (set for
  // YGPT's own workers) must never redirect another bridge to that state.
  stateDir:abs(raw.stateDir??process.env.YGPT_STATE_DIR??'state-rc'),
  projectRoots:(raw.projectRoots??['..']).map(abs),
  protectedRoots:[...(raw.protectedRoots??[]),...(raw.toolCacheDir?[raw.toolCacheDir]:[])].map(abs),
  toolCacheDir:raw.toolCacheDir?abs(raw.toolCacheDir):null,
  python:process.env.YGPT_PYTHON??raw.python??'py',
  pythonArgs:raw.pythonArgs??['-3.14'],
  port:Number(process.env.YGPT_APPROVAL_PORT??raw.port??17844),
  popup:process.env.YGPT_APPROVAL_POPUP??raw.popup??'1',
  singleOwner:raw.singleOwner!==false,
  ingressId:raw.ingressId??'private-stdio-owner',
  configFile,
  executables:raw.executables??{},
  engineModules:abs(raw.engineModules??'node_modules'),
  downloadProxy:raw.downloadProxy??null,
  approvalSurface:raw.approvalSurface??'chat',
  approvalNotifications:raw.approvalNotifications!==false,
  brandIcon:['plugin-icon-256.png','ygpt-local-green-y-256.png','ygpt-local-sky-y-256.png','ygpt-local-green-256.png','ygpt-local-signature-256.png'].includes(raw.brandIcon)?raw.brandIcon:'plugin-icon-256.png',
  approvalStyle:raw.approvalStyle==='legacy'?'legacy':'current',
  allowInlineDecisions:raw.allowInlineDecisions===true,
  enableMcpUi:raw.enableMcpUi===true,
  autoDevTasks:raw.autoDevTasks===true,
  trustedDeveloperRoots:raw.trustedDeveloperRoots??[],
  permissionMode:raw.permissionMode??'balanced',
  localApprovalDisabled:raw.rc10Candidate===true||raw.localApprovalDisabled===true,
  // RC9 stays opt-in until a candidate has passed staging and live host checks.
  rc9Candidate:raw.rc10Candidate===true||raw.rc9Candidate===true,
};
if(!['autonomous','balanced','secure'].includes(config.permissionMode)||!Array.isArray(config.trustedDeveloperRoots))throw Error('Invalid security mode/roots');
if(!config.singleOwner||!config.ingressId||!['chat','local'].includes(config.approvalSurface)||!Number.isInteger(config.port)||config.port<0||config.port>65535)
  throw Error('Only a private single-owner stdio deployment with a valid local port is supported');
// The owner may switch profiles locally without restarting the Tunnel.
// Only the protected on-disk config is authoritative; model call arguments
// cannot switch profiles or grant their own approvals.
export function currentPermissionMode(){
  try{const live=JSON.parse(fs.readFileSync(config.configFile,'utf8').replace(/^\uFEFF/,''));
      return ['autonomous','balanced','secure'].includes(live.permissionMode)?live.permissionMode:config.permissionMode;}
  catch{return config.permissionMode;}
}
export function cleanEnv(extra={}) {
  const allowed=['PATH','SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'];
  const env={};for(const k of allowed)if(process.env[k])env[k]=process.env[k];
  return {...env,USERPROFILE:path.join(config.stateDir,'engine-home'),HOME:path.join(config.stateDir,'engine-home'),
    APPDATA:path.join(config.stateDir,'engine-home','AppData','Roaming'),LOCALAPPDATA:path.join(config.stateDir,'engine-home','AppData','Local'),
    TEMP:path.join(config.stateDir,'tmp'),TMP:path.join(config.stateDir,'tmp'),PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',
    DESKTOP_COMMANDER_DISABLE_TELEMETRY:'1',DC_FLAG_URL:'http://127.0.0.1:1/disabled',
    ...(config.toolCacheDir?{BUN_INSTALL_CACHE_DIR:path.join(config.toolCacheDir,'bun')}:{}),
    YGPT_STATE_DIR:config.stateDir,YGPT_CONFIG:configFile,...extra};
}
