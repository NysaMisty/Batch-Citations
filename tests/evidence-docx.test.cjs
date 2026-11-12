// SPDX-License-Identifier: MIT
// T07: exercise citation recovery with synthetic identifiers and bibliography data.
// The original files are opened read-only and must remain byte-identical.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const live=require('../addon/content/live-core.js');
const {readEvidence,snapshotFromFixture}=require('./helpers/docx-evidence.cjs');

const fixtures=path.join(__dirname,'fixtures','citation-renumbering');
const load=name=>JSON.parse(fs.readFileSync(path.join(fixtures,name),'utf8'));
const evidenceDirectory=process.env.BATCH_CITATIONS_EVIDENCE_DIR;
const evidence=evidenceDirectory ? {
  normal:path.join(evidenceDirectory,'normal.docx'),
  abnormal:path.join(evidenceDirectory,'abnormal.docx')
} : {};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('T07 new-reference evidence keeps all seven original labels and fields',()=>{
  const fixture=load('new-before.json');
  assert.equal(JSON.parse(fixture.ledger).version,1);
  assert.equal(fixture.fields.length,7);
  const state=live.restoreBindings(snapshotFromFixture(fixture));
  assert.deepEqual(Object.keys(state.mapping).map(Number),[1,2,3,4,5,6,7]);
  assert.deepEqual(state.conflicts,[]);
  assert.deepEqual(state.untracked,[]);
  assert.deepEqual(state.carrierChanges,[]);
  assert.equal(state.requiresMigration,false);
  for(const citation of state.state.citations)assert.equal(citation.items.length,1);
});

test('T07 abnormal evidence keeps A as label 1 after its citationID changed',()=>{
  const fixture=load('abnormal.json');
  const ledger=JSON.parse(fixture.ledger);
  assert.equal(ledger.entries['1'].uris[0].split('/').at(-1),'DEMO0002');
  assert.equal(ledger.entries['8'].uris[0].split('/').at(-1),'DEMO0001');
  const state=live.restoreBindings(snapshotFromFixture(fixture));
  // The merged field keeps H's citationID. A's old ID is gone. The old ledger
  // must not drop label 1: URI identity proves A is still cited.
  assert.equal(state.mapping['1'].uris[0].split('/').at(-1),'DEMO0002');
  assert.equal(state.mapping['8'].uris[0].split('/').at(-1),'DEMO0001');
  assert.deepEqual(state.conflicts,[]);
  assert.deepEqual(state.untracked,[]);
  assert.deepEqual(state.carrierChanges,[1]);
  assert.equal(state.requiresMigration,false);
  assert.equal(state.entries['1'].uris[0].split('/').at(-1),'DEMO0002');
  assert.ok(state.entries['1'].citations.includes('demo-citation-08'));
  assert.ok(state.entries['1'].aliases.includes('demo-citation-03'));
  assert.deepEqual(state.issues.map(issue=>issue.code),['citation-carrier-changed']);
  assert.equal(state.issues[0].blocking,false);
});

test('T07 merged abnormal field stays in native H,A order and is not auto-fixed',()=>{
  const fixture=load('abnormal.json');
  const state=live.restoreBindings(snapshotFromFixture(fixture));
  const first=state.state.citations[0];
  assert.equal(first.text,'[1,2]');
  assert.deepEqual(first.items.map(item=>item.record.itemData.title),['Synthetic reference H','Synthetic reference A']);
  // First-use order of the document is H,A. The ledger labels remain A=1,H=8;
  // no plan may silently renumber the old ledger to hide the historical anomaly.
  const order=live.documentState(snapshotFromFixture(fixture));
  assert.ok(order);
  assert.equal(state.mapping['1'].uris[0].split('/').at(-1),'DEMO0002');
  assert.equal(state.mapping['8'].uris[0].split('/').at(-1),'DEMO0001');
});

test('T07 evidence DOCX remain byte-identical after offline inspection',()=>{
  for(const [name,file] of Object.entries(evidence)){
    if(!fs.existsSync(file)){assert.ok(true,`${name} evidence not present in this environment`);continue;}
    const before=sha(file);
    const read=readEvidence(file);
    assert.equal(read.fields.length,7);
    assert.ok(read.ledger.length>0);
    assert.equal(sha(file),before);
  }
});
