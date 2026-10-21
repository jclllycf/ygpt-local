import fs from 'node:fs';
const file='evidence/release-gates.json';if(!fs.existsSync(file))throw Error('Release gates have not been recorded');const r=JSON.parse(fs.readFileSync(file));
const required=['freshInstaller','remoteTunnel','chatgptPlugin','fileRestore','approvalDeny','securityReview','cleanPublicHistory'];
const missing=required.filter(k=>r[k]?.status!=='passed'||!r[k]?.evidence);if(missing.length)throw Error('Public release blocked by unverified gates: '+missing.join(', '));
console.log('Prepublication gates passed. Verify the final uploaded release download and SHA-256 separately.');
