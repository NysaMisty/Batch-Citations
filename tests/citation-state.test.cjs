'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const state=require('../addon/content/citation-state.js');
const live=require('../addon/content/live-core.js');
const {item,field,ledger,snapshot,marker,ledgerEntry}=require('./helpers/citations.cjs');

test('URI normalization merges only equivalent Zotero identities',()=>{
  assert.equal(state.normalizeUri('http://www.zotero.org/users/1/items/ABCD1234/'),'https://zotero.org/users/1/items/ABCD1234');
  assert.equal(state.normalizeUri('https://zotero.org/users/local/abc/items/ABCD1234'),'https://zotero.org/users/local/abc/items/ABCD1234');
  assert.equal(state.normalizeUri('not a uri'),'');
  assert.equal(state.sameRecord({uris:['http://www.zotero.org/users/1/items/ABCD1234/']},{uris:['https://zotero.org/users/1/items/ABCD1234']}),true);
  assert.equal(state.sameRecord({uris:['https://zotero.org/users/1/items/AAAA1111']},{uris:['https://zotero.org/users/1/items/BBBB2222']}),false);
  assert.equal(state.sameRecord({id:1,uris:[]},{id:1,uris:[]}),false);
});

test('two citation items with the same URI in one field are a duplicate citation, not a conflict',()=>{
  const a=item(1);
  const first=field({start:0,items:[a],text:'[1]',textAfter:' [2]'});
  const second=field({start:4,items:[a],text:'[2]'});
  const s=snapshot([first,second],[],ledger({1:ledgerEntry(a,['field-0','field-4'])}));
  const restored=live.restoreBindings(s);
  assert.deepEqual(restored.conflicts,[]);
  assert.equal(restored.mapping[1].id,1);
  assert.deepEqual(restored.entries[1].citations,['field-0','field-4']);
});

test('a changed citationID with the same URI is a carrier change with a non-blocking issue',()=>{
  const a=item(1);
  const f=field({start:0,items:[a],text:'[1]',citationID:'new-carrier'});
  const s=snapshot([f],[],ledger({1:ledgerEntry(a,['old-carrier'])}));
  const restored=live.restoreBindings(s);
  assert.equal(restored.conflicts.length,0);
  assert.deepEqual(restored.carrierChanges,[1]);
  assert.equal(restored.mapping[1].id,1);
  assert.equal(restored.requiresMigration,false);
  assert.equal(restored.issues.find(issue=>issue.code==='citation-carrier-changed').blocking,false);
});

test('a surviving citationID that now contains another reference is a blocking replacement',()=>{
  const a=item(1),b=item(2);
  const f=field({start:0,items:[b],text:'[1]',citationID:'same-id'});
  const s=snapshot([f],[],ledger({1:ledgerEntry(a,['same-id'])}));
  const restored=live.restoreBindings(s);
  assert.deepEqual(restored.conflicts,[1]);
  assert.equal(restored.requiresMigration,true);
  const conflict=restored.issues.find(issue=>issue.code==='reference-replaced');
  assert.match(conflict.message,/原为|现为/);
  assert.throws(()=>live.plan(s,['0:4'],{1:b},{styleID:'ieee',locale:'en-US'}),/恢复/);
});

test('duplicate citation IDs are blocking instead of silently binding one field',()=>{
  const a=item(1);
  const s=snapshot([field({start:0,items:[a],citationID:'dup',text:'[1]'}),field({start:4,items:[a],citationID:'dup',text:'[2]'})]);
  const restored=live.restoreBindings(s);
  assert.equal(restored.issues.some(issue=>issue.code==='duplicate-citation-id'&&issue.blocking),true);
  assert.throws(()=>live.plan(s,['0:3'],{1:a},{styleID:'ieee',locale:'en-US'}),/重复/);
});

test('same local id with different URIs stays two references; same URI with another id stays one',()=>{
  const a1=item(1,'A',['https://zotero.org/users/1/items/AAAA1111']);
  const shared1=item(1,'Shared',['https://zotero.org/users/1/items/SHAR0001']);
  const shared2=item(2,'Shared again',['https://zotero.org/users/1/items/SHAR0001']);
  const s=snapshot([field({start:0,items:[a1],citationID:'a'}),field({start:4,items:[shared1],citationID:'b'}),
    field({start:8,items:[shared2],citationID:'c'})]);
  const restored=live.restoreBindings(s);
  assert.equal(restored.untracked.length,2);
  assert.equal(restored.untracked.find(group=>group.record.uris.includes(shared1.uris[0])).citations.length,2);
});

test('first-use order follows document position and in-cluster order, not old labels',()=>{
  const a=item(1),b=item(2),c=item(3),h=item(8);
  const fields=[field({start:10,items:[a],text:'[1]'}),field({start:20,items:[b],text:'[2]'}),field({start:30,items:[c],text:'[3]'})];
  const s=snapshot(fields,[marker(3,0)],ledger({1:ledgerEntry(a,['field-10']),2:ledgerEntry(b,['field-20']),3:ledgerEntry(c,['field-30'])}));
  const restored=live.restoreBindings(s);
  assert.equal(restored.mapping[3].id,3);
  const scan=live.scan(s);
  const preview=live.plan(s,[scan.occurrences[0].key],{3:c},{styleID:'ieee',locale:'en-US',numeric:true}).preview;
  assert.deepEqual(preview.order.map(entry=>entry.title),['Item 3','Item 1','Item 2']);
  assert.deepEqual(preview.order.map(entry=>entry.number),[1,2,3]);
});

test('verification catches lost references, unexpected references and merge order inversion',()=>{
  const a=item(1),b=item(2),h=item(8);
  const before=live.documentState(snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'}),
    field({start:10,items:[b],citationID:'b-id',text:'[2]'})],[]));
  const missing=live.documentState(snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'})],[]));
  const result=live.verifyCommit(snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'}),
    field({start:10,items:[b],citationID:'b-id',text:'[2]'})],[]),
    snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'})],[]),{expected:{merges:[]}});
  assert.equal(result.ok,false);assert.equal(result.issues.some(issue=>issue.code==='reference-lost'),true);
  const unexpected=live.verifyCommit(snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'})],[]),
    snapshot([field({start:0,items:[a,h],citationID:'a-id',text:'[1, 2]'})],[]),{expected:{merges:[]}});
  assert.equal(unexpected.ok,false);assert.equal(unexpected.issues.some(issue=>issue.code==='unexpected-reference'),true);
  const plan={expected:{merges:[{citationID:'a-id',references:[a,h],order:[state.referenceKey(a),state.referenceKey(h)]}]}};
  const inverted=live.verifyCommit(snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'})],[]),
    snapshot([field({start:0,items:[h,a],citationID:'a-id',text:'[1, 2]'})],[]),plan);
  assert.equal(inverted.ok,false);assert.equal(inverted.issues.some(issue=>issue.code==='item-order-inverted'),true);
  const correct=live.verifyCommit(snapshot([field({start:0,items:[a],citationID:'a-id',text:'[1]'})],[]),
    snapshot([field({start:0,items:[a,h],citationID:'a-id',text:'[1, 2]'})],[]),plan);
  assert.equal(correct.ok,true);assert.match(correct.bindingData,/"version":2/);
});

test('carrier sync rewrites the ledger identity without moving or renumbering references',()=>{
  const a=item(1);
  const s=snapshot([field({start:0,items:[a],citationID:'new-carrier',text:'[1]'})],[],ledger({1:ledgerEntry(a,['old-carrier'])}));
  const restored=live.restoreBindings(s);
  assert.equal(restored.carrierChanges.length,1);
  const plan=live.syncPlan(s);
  assert.deepEqual(plan.operations,[]);
  assert.equal(plan.syncOnly,true);
  const entries=JSON.parse(plan.bindingData).entries;
  assert.deepEqual(entries[1].citations,['new-carrier']);
  assert.deepEqual(entries[1].aliases,['old-carrier']);
  const finalized=live.finalizePlan(plan,s,s);
  assert.equal(finalized.ok,true);
  assert.deepEqual(JSON.parse(finalized.bindingData).entries[1].citations,['new-carrier']);
});
