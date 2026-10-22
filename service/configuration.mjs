import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export function makeConfig({installDir,dataDir,projectRoots,python,pythonArgs=[],port=17854,headless=true}){
 if(!Array.isArray(projectRoots)||!projectRoots.length||projectRoots.some(p=>!path.isAbsolute(p)))throw Error('Choose at least one absolute authorized working folder');
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose an available port between 1024 and 65535');
 const fixture=path.join(installDir,'engine/build/YDesktop.exe');
 return {product:'YGPT Local',stateDir:path.join(dataDir,'state'),startupDiagnostics:path.join(dataDir,'state','startup-error.json'),engineRoot:path.parse(projectRoots[0]).root,projectRoots,protectedRoots:[installDir,dataDir],python,pythonArgs,engineModules:path.join(installDir,'node_modules'),port,singleOwner:true,ingressId:'ygpt-owner-'+randomUUID(),permissionMode:'autonomous',blacklistDefaultAllow:true,readOnlyAutoAllow:true,autoDevTasks:true,trustedDeveloperRoots:projectRoots,executables:{},deployment:'production',rc9Candidate:true,rc10Candidate:true,rc11Candidate:true,rc11Patch:true,rc11Patch2:true,rc11Patch3:true,rc11Patch4:true,popup:'0',approvalSurface:'chat',allowInlineDecisions:true,chatAppConsent:true,enableMcpUi:true,localApprovalDisabled:true,browser:{headless,channel:'chrome',allowedHosts:[],blockedHosts:[],interactiveOrigins:[],existing:{port:9222,groupName:'YGPT',endpoints:[]}},desktopAllowedApps:fs.existsSync(fixture)?[{path:fixture,sha256:createHash('sha256').update(fs.readFileSync(fixture)).digest('hex')}]:[]};
}
