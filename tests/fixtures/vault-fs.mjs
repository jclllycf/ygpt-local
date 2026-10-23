import fs from 'node:fs';
// G: is a policy fixture, not the workstation owner's mounted Drive account.
export function isolateVault(t){const exists=fs.existsSync;t.mock.method(fs,'existsSync',p=>/^g:[\\/]/i.test(String(p))?false:exists(p));}
