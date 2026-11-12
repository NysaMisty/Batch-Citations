const {test}=require('node:test');
const assert=require('node:assert/strict');
const live=require('../addon/content/live-core.js');
const core=require('../addon/content/core.js');
const {field,marker}=require('./helpers/citations.cjs');
const item=(id)=>({id,uris:[`http://zotero.org/users/1/items/ITEM000${id}`],itemData:{id,type:'book',title:'Item '+id}});
const code=(id,items)=>'ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify({citationID:id,properties:{},citationItems:items});
const ledger=entries=>JSON.stringify({version:1,entries});
const entry=(record,citations)=>({uris:record.uris,citations});
const options={styleID:'ieee',locale:'en-US',zoteroVersion:'10'};
function snapshot(){return {documentKey:'doc',fingerprint:'hash',documentData:core.documentData('ieee','en-US','10'),candidates:[{start:0,end:3,raw:'[2]',eligible:true,context:'[2]'}],citationCodes:[],bindingData:''};}

test('a surviving duplicate restores its original number independently of CSL output and position',()=>{
  const s=snapshot(),a=item(1);s.citationCodes=[code('second-copy',[a])];s.citationTexts=['[1]'];
  s.bindingData=ledger({2:entry(a,['deleted-copy','second-copy'])});
  const restored=live.restoreBindings(s);
  assert.equal(restored.mapping[2].uris[0],a.uris[0]);assert.deepEqual(restored.entries[2].citations,['second-copy']);
  assert.deepEqual(restored.untracked,[]);
  assert.throws(()=>live.plan(s,['0:3'],{2:item(3)},options),/绑定/);
  const plan=live.plan(s,['0:3'],{2:a},options),data=JSON.parse(plan.bindingData);
  const citation=JSON.parse(plan.operations[0].code.split('CSL_CITATION ')[1]);
  assert.deepEqual(data.entries[2].citations,['second-copy',citation.citationID]);
});

test('only deleting all bound positions releases the original number',()=>{
  const s=snapshot(),a=item(1);s.bindingData=ledger({2:entry(a,['removed'])});
  assert.deepEqual(live.restoreBindings(s).mapping,{});
  assert.doesNotThrow(()=>live.plan(s,['0:3'],{2:item(2)},options));
});

test('cross-number reuse is allowed for an insertion marker but an unselected label cannot be rebound',()=>{
  const a=item(1),b=item(2),s=snapshot();
  s.citationCodes=[code('old-a',[a]),code('old-b',[b])];s.citationTexts=['[1]','[2]'];
  s.citationFields=[field({start:10,items:[a],citationID:'old-a',text:'[1]'}),field({start:20,items:[b],citationID:'old-b',text:'[2]'})];
  s.candidates=[marker(8,0)];s.bindingData=ledger({1:entry(a,['old-a']),2:entry(b,['old-b'])});
  const insertion=live.plan(s,['0:3'],{8:item(3)},options),data=JSON.parse(insertion.bindingData);
  assert.equal(data.entries[1].uris[0],a.uris[0]);
  assert.equal(data.entries[2].uris[0],b.uris[0]);
  assert.equal(data.entries[8].uris[0],item(3).uris[0]);
  assert.throws(()=>live.plan(s,['0:3'],{8:item(3),2:item(4)},options),/绑定/);
  assert.throws(()=>live.mergeBindings({2:a},{2:item(2)},live.restoreBindings({...s,bindingData:ledger({2:entry(a,['old'])})})),/绑定/);
});

test('corrupt or inconsistent metadata fails closed without guessing display numbers',()=>{
  const s=snapshot(),a=item(1);s.citationCodes=[code('old',[a])];
  s.bindingData='{broken';assert.throws(()=>live.restoreBindings(s),/绑定/);
  s.bindingData=ledger({2:entry(item(2),['old'])});assert.deepEqual(live.restoreBindings(s).conflicts,[2]);
  assert.throws(()=>live.plan(s,['0:3'],{2:a},options),/恢复/);
  s.bindingData='';const state=live.restoreBindings(s);
  assert.equal(state.requiresMigration,false);assert.equal(state.legacyUnlabeled,true);assert.deepEqual(state.mapping,{});
  assert.doesNotThrow(()=>live.plan(s,['0:3'],{2:item(2)},options));
});

test('an explicit native replacement can be reconciled only by confirming the original number again',()=>{
  const s=snapshot(),a=item(1),b=item(2);s.citationCodes=[code('unchanged-id',[b])];s.bindingData=ledger({2:entry(a,['unchanged-id'])});
  assert.equal(live.restoreBindings(s).requiresMigration,true);
  assert.throws(()=>live.plan(s,['0:3'],{2:b},options),/恢复/);
  const recovered=live.recoverBindings(s,{2:b});s.bindingData=recovered.bindingData;
  assert.equal(live.restoreBindings(s).mapping[2].id,2);assert.doesNotThrow(()=>live.plan(s,['0:3'],{2:b},options));
});

test('a confirmed recovery is finalized from the verified document rather than reusing the stale ledger',()=>{
  const s=snapshot(),a=item(1),b=item(2),f=field({start:10,items:[b],citationID:'unchanged-id',text:'[1]'});
  s.citationCodes=[code('unchanged-id',[b])];s.citationFields=[f];s.bindingData=ledger({2:entry(a,['unchanged-id'])});
  const recovered=live.recoverBindings(s,{2:b});
  const after={...s,fingerprint:'after-refresh',citationFields:[{...f,text:'[1]'}]};
  const finalized=live.finalizePlan(recovered,s,after);
  assert.equal(finalized.ok,true,finalized.issues?.map(issue=>issue.message).join('\n'));
  const entries=JSON.parse(finalized.bindingData).entries;
  assert.equal(entries[2].uris[0],b.uris[0]);
  assert.equal(finalized.transactionId,recovered.transactionId||'');
});

test('explicit migration validates all existing items and records original numbers without rewriting fields',()=>{
  const s=snapshot(),a=item(1),b=item(2);s.citationCodes=[code('one',[a]),code('cluster',[a,b])];
  assert.throws(()=>live.recoverBindings(s,{2:a}),/全部|对应/);
  const plan=live.recoverBindings(s,{2:a,7:b});
  assert.deepEqual(plan.operations,[]);assert.equal(plan.documentData,s.documentData);
  s.bindingData=plan.bindingData;
  const restored=live.restoreBindings(s);assert.equal(restored.requiresMigration,false);
  assert.deepEqual(Object.keys(restored.mapping),['2','7']);assert.deepEqual(restored.entries[2].citations,['one','cluster']);
});

test('new native citations can serve a free label and cannot steal a bound number',()=>{
  const s=snapshot(),a=item(1),b=item(2);s.bindingData=ledger({1:entry(a,['old'])});s.citationCodes=[code('old',[a]),code('native',[b])];
  s.citationTexts=['[1]','[2]'];
  assert.throws(()=>live.plan(s,['0:3'],{1:b},options),/绑定/);
  const plan=live.plan(s,['0:3'],{2:b},options),data=JSON.parse(plan.bindingData);
  assert.equal(data.entries[1].uris[0],a.uris[0]);
  assert.equal(data.entries[2].uris[0],b.uris[0]);
  assert.deepEqual(live.restoreBindings({...s,bindingData:plan.bindingData}).untracked,[]);
});
