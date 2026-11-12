const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const mapping=require('../addon/content/mapping.js'),core=require('../addon/content/core.js');
const citationState=require('../addon/content/citation-state.js');
const live=require('../addon/content/live-core.js');
const {field,snapshot,marker}=require('./helpers/citations.cjs');
const paper=n=>({id:n,uris:[`http://zotero.org/users/1/items/TEST000${n}`],itemData:{title:'Paper '+n,type:'book'}});
function adapter(answer){
  const calls=[],prompt={BUTTON_POS_0:1,BUTTON_POS_1:256,BUTTON_TITLE_IS_STRING:127,BUTTON_TITLE_CANCEL:2,BUTTON_POS_1_DEFAULT:16777216,
    confirmEx(...args){calls.push(args);return answer;}};
  const context={ZBMapping:mapping,Services:{prompt}};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/content/zotero-adapter.js'),'utf8'),context);
  return {api:new context.ZBAdapter({},{}),calls,prompt};
}
test('duplicate binding requires explicit continuation and defaults to cancel with original numbers and merge warning',()=>{
  const {api,calls,prompt}=adapter(1),base={3:paper(1),7:paper(1)},before=JSON.stringify(base),patch={8:paper(1)};
  assert.equal(api.confirmDuplicateBindings(base,patch),false);assert.equal(calls.length,1);
  const [,title,text,flags,continueLabel]=calls[0];
  assert.match(title,/重复绑定/);assert.match(text,/\[3\].*\[7\]/);assert.match(text,/\[8\]/);assert.match(text,/编号可能合并/);
  assert.equal(flags&prompt.BUTTON_POS_1_DEFAULT,prompt.BUTTON_POS_1_DEFAULT);assert.equal(continueLabel,'继续绑定');
  assert.equal(JSON.stringify(base),before);assert.deepEqual(patch,{8:paper(1)});
  const accepted=adapter(0);assert.equal(accepted.api.confirmDuplicateBindings(base,patch),true);assert.equal(accepted.calls.length,1);
});
test('same-number reselection and unrelated titles do not prompt while imported duplicates share the confirmation',()=>{
  const {api,calls}=adapter(1),sameTitle={...paper(2),itemData:{title:'Paper 1'}};
  assert.equal(api.confirmDuplicateBindings({3:paper(1)},{3:paper(1),8:sameTitle}),true);assert.equal(calls.length,0);
  assert.equal(api.confirmDuplicateBindings({},{3:paper(1),8:paper(1)}),false);assert.equal(calls.length,1);
});
test('library merge aliases prompt for newly shared labels and retain already confirmed relationships',()=>{
  const {api,calls}=adapter(1),base={3:paper(1),8:paper(2)},merged={...paper(1),uris:[...paper(1).uris,...paper(2).uris]};
  assert.equal(api.confirmDuplicateBindings(base,{8:merged}),false);assert.equal(calls.length,1);
  assert.match(calls[0][2],/\[3\]/);assert.match(calls[0][2],/\[8\]/);
  const confirmed={3:merged,8:merged};
  assert.equal(api.confirmDuplicateBindings(confirmed,{8:merged}),true);assert.equal(calls.length,1);
  assert.equal(api.confirmDuplicateBindings(confirmed,{3:paper(3),8:paper(3)}),false);assert.equal(calls.length,2);
});
test('field-backed references from other libraries do not conflict merely because their numeric IDs match',()=>{
  const {api,calls}=adapter(1),embedded={...paper(1),uris:['https://zotero.org/users/99/items/OTHER001']};
  assert.deepEqual(mapping.duplicateNumbers({3:embedded},8,paper(1)),[]);
  assert.equal(api.confirmDuplicateBindings({3:embedded},{8:paper(1)}),true);assert.equal(calls.length,0);
});
test('confirmed labels produce one reference per citation cluster and survive ordered partial changes',()=>{
  const base={3:paper(1)},session=new mapping.OrderedSession([3,4,5],base,[],{unique:false});
  session.edit(5);session.assign(paper(1));
  assert.deepEqual(session.changes(),{5:paper(1)});assert.deepEqual(Object.keys(session.finish()),['3','5']);
  const citation=core.citationFor({numbers:[3,5]},session.finish());
  assert.equal(citation.citationItems.length,1);assert.equal(citation.citationItems[0].uris[0],paper(1).uris[0]);
});
test('final citations deduplicate all shared aliases and transitive identities regardless of URI sort order',()=>{
  const z='https://zotero.org/users/1/items/ZZZZ0001',a='http://zotero.org/users/1/items/AAAA0002',c='https://zotero.org/users/1/items/CCCC0003';
  const record=(id,uris)=>({...paper(id),uris});
  for(const records of [
    {1:record(7,[z]),2:record(7,[z,a])},
    {1:record(7,[z]),2:record(8,[a]),3:record(7,[z,a])},
    {1:record(7,[z,a]),2:record(7,[z]),3:record(8,[c])}
  ]){
    const expected=records[3]?.uris.includes(c)?2:1,citation=core.citationFor({numbers:Object.keys(records)},records);
    assert.equal(citation.citationItems.length,expected);
    assert.ok(citation.citationItems[0].uris.includes(z));assert.ok(citation.citationItems[0].uris.includes(a));
  }
});

test('number preview and final citations agree on bridging aliases while preserving earliest use and unrelated references',()=>{
  const z='https://zotero.org/users/1/items/ZZZZ0001',a='http://zotero.org/users/1/items/AAAA0002',c='https://zotero.org/users/1/items/CCCC0003';
  for(const bridge of [[z,a],[a,z]])for(const leading of [[z],[a]]){
    const other=leading[0]===z?a:z;
    const records={1:{...paper(7),uris:leading},2:{...paper(7),uris:[c]},3:{...paper(8),uris:[other]},4:{...paper(9),uris:bridge},5:{...paper(10),uris:[other]}};
    const state={citations:[{start:0,items:[{record:records[1]}]}]},markers=[{start:1,numbers:[2,3,4,5]}];
    const before=JSON.stringify({state,markers,records});
    const preview=citationState.deriveFirstUseOrder(state,markers,records).order;
    const final=core.citationFor({numbers:[1,2,3,4,5]},records).citationItems;
    assert.equal(preview.length,2);assert.equal(final.length,2);
    assert.deepEqual(preview.map(entry=>entry.number),[1,2]);
    assert.equal(preview[0].title,'Paper 7');assert.equal(preview[0].via,'existing');
    assert.equal(preview[0].referenceId,citationState.referenceKey(records[1]));
    assert.equal(preview[1].via,'inserted');assert.deepEqual(preview[1].uris,[c]);
    assert.deepEqual(preview.map(entry=>citationState.uriKeys(entry).sort()),final.map(entry=>citationState.uriKeys(entry).sort()));
    assert.equal(JSON.stringify({state,markers,records}),before);
  }
});

test('confirmed shared references retain every original label through planning finalization and reopen',()=>{
  const a=paper(1),options={styleID:'ieee',locale:'en-US',numeric:true};
  for(const candidates of [[marker(1,0),marker(3,20)],[{...marker(1,0),raw:'[1,3]',end:5}],[marker(1,0),marker(3,3)]]){
    const before=snapshot([],candidates,''),plan=live.plan(before,candidates.map(c=>`${c.start}:${c.end}`),{1:a,3:a},options);
    assert.deepEqual(Object.keys(JSON.parse(plan.bindingData).entries),['1','3']);
    assert.deepEqual(plan.expected.newNumbers.map(label=>label.number),[1,3]);
    assert.equal(plan.preview.order.length,1);
    const after=snapshot([...plan.operations].reverse().map(op=>field({start:op.start,items:coreCitation(op).citationItems,citationID:op.citationID,text:'[1]'})),[],plan.bindingData);
    const finalized=live.finalizePlan(plan,before,after);
    assert.equal(finalized.ok,true,JSON.stringify(finalized.issues));
    const reopened=live.restoreBindings({...after,bindingData:finalized.bindingData});
    assert.deepEqual(Object.keys(reopened.mapping),['1','3']);
    assert.equal(reopened.mapping[1].uris[0],reopened.mapping[3].uris[0]);
  }
  function coreCitation(operation){return JSON.parse(operation.code.split('CSL_CITATION ')[1]);}
});
