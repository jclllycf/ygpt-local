import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const file='evidence/release-gates.json';if(!fs.existsSync(file))throw Error('Release gates have not been recorded');const r=JSON.parse(fs.readFileSync(file));
const version=JSON.parse(fs.readFileSync('package.json')).version;if(r.version!==version)throw Error('Release gates belong to another candidate version');
const required=['freshInstaller','remoteTunnel','chatgptPlugin','fileRestore','approvalDeny','securityReview','cleanPublicHistory','guiExit','logonRecovery','networkRecovery','hostCleanupBeforeAfter','maintenanceAfterCleanup','visualAccessibility','cleanWindowsVm'];
const missing=required.filter(k=>r[k]?.status!=='passed'||!r[k]?.evidence);if(missing.length)throw Error('Public release blocked by unverified gates: '+missing.join(', '));
if(!/^[a-f0-9]{40}$/.test(r.candidateCommit??'')||!Array.isArray(r.artifacts)||r.artifacts.length<2)throw Error('Tested candidate provenance is missing');
for(const a of r.artifacts){if(path.basename(a.file)!==a.file)throw Error('Unsafe candidate asset path');const p=path.join('dist',a.file);if(!fs.existsSync(p)||createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==a.sha256)throw Error('Asset differs from the tested installer: '+a.file);}
console.log('Prepublication gates passed. Verify the final uploaded release download and SHA-256 separately.');
