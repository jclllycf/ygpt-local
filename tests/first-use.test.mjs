import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {firstUseRecorder,validateFirstUseProof} from '../service/first-use.mjs';
test('First-use proof requires the exact marker result on an authenticated transport; fixture is not real ChatGPT acceptance',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ygpt-proof-')),marker=path.join(dir,'marker.txt'),generation='FIXTURE_GENERATION',key='fixture-only-key-'.repeat(4);fs.writeFileSync(marker,'YGPT_MARKER_FIXTURE');fs.writeFileSync(path.join(dir,'first-use-challenge.json'),JSON.stringify({generation,path:marker,sha256:createHash('sha256').update(fs.readFileSync(marker)).digest('hex')}));
 const proof=path.join(dir,'first-use-proof.json'),result={content:[{type:'text',text:'YGPT_MARKER_FIXTURE'}]};
 firstUseRecorder({data:dir,key,transport:'local-health'})('y_file_read',{path:marker},result);assert.equal(fs.existsSync(proof),false);
 const record=firstUseRecorder({data:dir,key,transport:'official-secure-tunnel',clientName:()=> 'fixture, not an attested ChatGPT identity'});
 record('y_ping',{},result);record('y_file_read',{path:marker},{isError:true,...result});record('y_file_read',{path:marker},{content:[{type:'text',text:'wrong marker'}]});assert.equal(fs.existsSync(proof),false);
 record('y_file_read',{path:marker},result);const value=JSON.parse(fs.readFileSync(proof));assert.equal(validateFirstUseProof(value,key,generation),true);assert.equal(validateFirstUseProof(value,key,'other'),false);assert.equal(validateFirstUseProof(value,'other-key',generation),false);
 fs.writeFileSync(marker,'CHANGED');fs.unlinkSync(proof);record('y_file_read',{path:marker},result);assert.equal(fs.existsSync(proof),false);
});
