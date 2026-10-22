// Test stub for runtime/config.mjs: the access policy canonicalizes Windows
// drive paths, so on a non-Windows host it can only be exercised with a
// Windows-shaped configuration. Values mirror the shipped owner defaults
// (autonomous, blacklist default-allow) from service/configuration.mjs.
export const INSTALL='C:\\YGPT\\install';
export const RUNTIME='C:\\YGPT\\install\\runtime';
export const config={
  version:'test',
  stateDir:'C:\\YGPT\\data\\state',
  configFile:'C:\\YGPT\\data\\ygpt.config.json',
  engineRoot:'D:\\',
  projectRoots:['D:\\AI\\Projects'],
  protectedRoots:['C:\\YGPT\\install','C:\\YGPT\\data'],
  python:'py',pythonArgs:[],port:17854,singleOwner:true,
  permissionMode:'autonomous',blacklistDefaultAllow:true,readOnlyAutoAllow:true,
  autoDevTasks:true,trustedDeveloperRoots:['D:\\AI\\Projects'],executables:{},
  deployment:'production',rc9Candidate:true,rc10Candidate:true,rc11Candidate:true,
  rc11Patch:true,rc11Patch2:true,rc11Patch3:true,rc11Patch4:true,popup:'0',
  approvalSurface:'chat',allowInlineDecisions:true,chatAppConsent:true,
  enableMcpUi:true,localApprovalDisabled:true,
  browser:{headless:true,allowedHosts:['127.0.0.1','localhost','[::1]'],interactiveOrigins:[]},
  desktopAllowedApps:[],agentProtectedRoots:undefined,
};
export function currentPermissionMode(){return config.permissionMode;}
