const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('release workflow rejects drift and tampering, preserves history, and rolls back failed publication',()=>{
  const result=spawnSync('python',[path.join(__dirname,'release-management.py')],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:90000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stderr,/Ran 11 tests/);
});
