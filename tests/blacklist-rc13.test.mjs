// rc.13 fundamental blacklist upgrade (portable policy tests): no hard
// refusals remain in the access policy. ChatGPT Desktop Agent resources are
// ordinary targets; YGPT's own state and the vault are human gates, not
// denies; unclassified tools gate; developer tasks outside the trusted set
// gate; protected job/download targets gate.
import test from 'node:test';
import assert from 'node:assert/strict';

test('Access policy rc.13: nothing is hard-refused; risk becomes a human gate',async()=>{
  const {register}=await import('node:module');
  register('./fixtures/config-hook.mjs',import.meta.url);
  const {authorize}=await import('../runtime/access-policy.mjs');
  const decisions=[];
  const check=(name,args)=>{const d=authorize(name,args);decisions.push([name,d.decision]);return d;};

  // ChatGPT Desktop Agent resources are ordinary targets now (was TARGET_FOREIGN deny).
  assert.notEqual(check('write_file',{path:'C:\\Users\\Example\\AppData\\Local\\OpenAI\\state.json',content:'x'}).decision,'deny');
  assert.notEqual(check('move_file',{source:'C:\\Users\\Example\\AppData\\Roaming\\ChatGPT\\a',destination:'D:\\work\\a'}).decision,'deny');
  const agentJob=check('job_submit',{cwd:'C:\\Users\\Example\\AppData\\Local\\OpenAI',argv:['C:\\Windows\\System32\\cmd.exe','/c','echo hi']});
  assert.notEqual(agentJob.decision,'deny');assert.notEqual(agentJob.code,'TARGET_FOREIGN');

  // Killing any process by name is a high-risk signal -> human gate, whoever it is.
  const kill=check('job_submit',{cwd:'D:\\work',argv:['C:\\Windows\\System32\\taskkill.exe','/IM','ChatGPT.exe','/F']});
  assert.equal(kill.decision,'approve');

  // YGPT's own state and the vault: gates, never denies.
  assert.equal(check('write_file',{path:'C:\\YGPT\\data\\state\\ops.sqlite3',content:'x'}).decision,'approve');
  assert.equal(check('write_file',{path:'G:\\vault\\note.txt',content:'x'}).decision,'approve');
  assert.equal(check('y_download_file',{destination:'C:\\YGPT\\data\\state\\f.bin',url:'https://example.com/f'}).decision,'approve');
  assert.equal(check('job_submit',{cwd:'C:\\YGPT\\data\\state',argv:['C:\\Windows\\System32\\cmd.exe','/c','echo hi']}).decision,'approve');

  // Unclassified tools ask a human instead of being disabled.
  assert.equal(check('y_something_new',{}).decision,'approve');

  // Structured developer task outside the trusted set: gate (the executor's
  // plan no longer re-checks trust, so the approval is meaningful).
  assert.equal(check('y_dev_task',{cwd:'D:\\work',task:'git-status'}).decision,'approve');
  // An unknown task name is a malformed request, not a policy refusal.
  assert.equal(check('y_dev_task',{cwd:'D:\\work',task:'rm-everything'}).decision,'deny');

  // Ordinary work still flows without interruption.
  assert.equal(check('write_file',{path:'D:\\AI\\Projects\\app\\main.js',content:'x'}).decision,'allow');

  for(const [name,decision] of decisions)assert.ok(['allow','approve','deny'].includes(decision),name);
});
