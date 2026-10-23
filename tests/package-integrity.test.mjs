import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Release version changes preserve installed dependency and tarball versions',()=>{
 const pkg=JSON.parse(fs.readFileSync('package.json')),lock=JSON.parse(fs.readFileSync('package-lock.json'));
 assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 for(const [dir,entry] of Object.entries(lock.packages)){
  if(!dir)continue;
  const manifest=dir+'/package.json';
  if(fs.existsSync(manifest))assert.equal(JSON.parse(fs.readFileSync(manifest)).version,entry.version,dir+' differs from the installed dependency');
  else assert.ok(entry.optional,dir+' required dependency is absent');
  if(entry.resolved?.startsWith('https://registry.npmjs.org/'))assert.ok(new URL(entry.resolved).pathname.endsWith('-'+entry.version+'.tgz'),dir+' tarball version differs from the lock entry');
 }
});
