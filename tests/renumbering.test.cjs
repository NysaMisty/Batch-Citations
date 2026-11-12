'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const live=require('../addon/content/live-core.js');
const state=require('../addon/content/citation-state.js');
const {item,field,ledger,snapshot,marker,ledgerEntry}=require('./helpers/citations.cjs');
const options={styleID:'ieee',locale:'en-US',zoteroVersion:'10',numeric:true};

function references(){
  const map={};
  for(let id=1;id<=8;id++)map[id]=item(id,String.fromCharCode(64+id));
  return map;
}
function baseDocument(){
  const r=references(),fields=[],entries={};
  for(let id=1;id<=7;id++){
    const start=(id-1)*10;
    const next=id===1?' [2]':'';
    fields.push(field({start,items:[r[id]],citationID:id===1?'a-old':`c${id}`,text:`[${id}]`,textAfter:next}));
    entries[id]=ledgerEntry(r[id],[id===1?'a-old':`c${id}`]);
  }
  return {references:r,fields,entries,s:snapshot(fields,[marker(8,4)],ledger(entries))};
}

test('T01 adjacent insert merges into the left field, keeps A first and allocates H a new label',()=>{
  const {references:r,s}=baseDocument();
  const plan=live.plan(s,['4:7'],{8:r[8]},options);
  assert.equal(plan.operations.length,1);
  const op=plan.operations[0];
  assert.equal(op.kind,'mergeAdjacent');
  assert.equal(op.citationID,'a-old');
  assert.deepEqual(op.sourceFields.map(source=>source.citationID),['a-old']);
  const citation=JSON.parse(op.code.split('CSL_CITATION ')[1]);
  assert.deepEqual(citation.citationItems.map(entry=>entry.itemData.title),['A','H']);
  assert.equal(citation.citationID,'a-old');
  const data=JSON.parse(plan.bindingData);
  assert.equal(data.version,2);
  assert.deepEqual(data.entries[1].citations,['a-old']);
  assert.equal(data.entries[8].uris[0],r[8].uris[0]);
  assert.deepEqual(data.entries[8].citations,['a-old']);
  assert.deepEqual(plan.preview.order.map(entry=>entry.title),['A','H','B','C','D','E','F','G']);
  assert.deepEqual(plan.preview.order.map(entry=>entry.number),[1,2,3,4,5,6,7,8]);
  assert.deepEqual(plan.expected.merges[0].order,[state.referenceKey(r[1]),state.referenceKey(r[8])]);
});

test('T01 post-commit verification accepts A,H and rejects a native order reversal',()=>{
  const {references:r,s}=baseDocument();
  const plan=live.plan(s,['4:7'],{8:r[8]},options);
  const merged=field({start:0,items:[r[1],r[8]],citationID:'a-old',text:'[1, 2]'});
  const others=[];
  for(let id=2;id<=7;id++)others.push(field({start:(id-1)*10,items:[r[id]],citationID:`c${id}`,text:`[${id+1}]`}));
  const after=snapshot([merged,...others],[],plan.bindingData);
  const verified=live.verifyCommit(s,after,plan);
  assert.equal(verified.ok,true,JSON.stringify(verified.issues));
  assert.equal(verified.entries[1].uris[0],r[1].uris[0]);
  assert.equal(verified.entries[8].uris[0],r[8].uris[0]);
  const reversed=field({start:0,items:[r[8],r[1]],citationID:'a-old',text:'[1, 2]'});
  const bad=live.verifyCommit(s,snapshot([reversed,...others],[],plan.bindingData),plan);
  assert.equal(bad.ok,false);
  assert.equal(bad.issues.some(issue=>issue.code==='item-order-inverted'),true);
});

test('T01 non-adjacent insert after A yields A=1,H=2,B=3 without touching B..G identities',()=>{
  const {references:r,entries}=baseDocument();
  const fields=[field({start:0,items:[r[1]],citationID:'a-old',text:'[1]',textAfter:' '})];
  for(let id=2;id<=7;id++)fields.push(field({start:id*10,items:[r[id]],citationID:`c${id}`,text:`[${id}]`}));
  const s=snapshot(fields,[marker(8,6)],JSON.stringify({version:2,entries}));
  const plan=live.plan(s,['6:9'],{8:r[8]},options);
  assert.equal(plan.operations.length,1);assert.equal(plan.operations[0].kind,'insert');
  assert.deepEqual(plan.preview.order.map(entry=>entry.title),['A','H','B','C','D','E','F','G']);
  const data=JSON.parse(plan.bindingData);
  assert.equal(data.entries[2].uris[0],r[2].uris[0]);
  assert.equal(data.entries[8].uris[0],r[8].uris[0]);
});

test('T02 one reference preserves distinct original labels across several document positions',()=>{
  const {references:r,s}=baseDocument();
  s.bindingData=ledger({1:ledgerEntry(r[1],['a-old']),2:ledgerEntry(r[2],['c2']),3:ledgerEntry(r[3],['c3'])});
  s.citationFields=[field({start:0,items:[r[1]],citationID:'a-old',text:'[1]'}),field({start:10,items:[r[2]],citationID:'c2',text:'[2]'}),field({start:20,items:[r[3]],citationID:'c3',text:'[3]'})];
  s.candidates=[marker(4,30),marker(5,40)];
  const plan=live.plan(s,['30:33','40:43'],{4:r[3],5:r[3]},options);
  assert.equal(plan.operations.length,2);
  const data=JSON.parse(plan.bindingData);
  assert.equal(Object.keys(data.entries).filter(number=>data.entries[number].uris.includes(r[3].uris[0])).length,3);
  assert.equal(data.entries[3].citations.length,1);
  for(const number of [4,5]){assert.deepEqual(data.entries[number].uris,r[3].uris);assert.equal(data.entries[number].citations.length,1);}
  const preview=plan.preview.order.map(entry=>entry.title);
  assert.deepEqual(preview,['A','B','C']);
});

test('T03 citing C before A makes C first without renumbering the stored labels',()=>{
  const {references:r,entries}=baseDocument();
  const fields=[field({start:10,items:[r[1]],citationID:'a-old',text:'[1]'}),field({start:20,items:[r[2]],citationID:'c2',text:'[2]'}),field({start:30,items:[r[3]],citationID:'c3',text:'[3]'})];
  const s=snapshot(fields,[marker(3,0)],JSON.stringify({version:2,entries}));
  const plan=live.plan(s,['0:3'],{3:r[3]},options);
  assert.deepEqual(plan.preview.order.map(entry=>entry.title),['C','A','B']);
  assert.deepEqual(plan.preview.order.map(entry=>entry.number),[1,2,3]);
  assert.equal(JSON.parse(plan.bindingData).entries[3].citations.length,2);
});

test('T04 deleting duplicate carriers preserves identity until the last carrier is gone',()=>{
  const a=item(1,'A');
  const first=field({start:0,items:[a],citationID:'c1',text:'[1]'});
  const second=field({start:10,items:[a],citationID:'c2',text:'[2]'});
  const withBoth=live.restoreBindings(snapshot([first,second],[],ledger({1:ledgerEntry(a,['c1','c2'])})));
  assert.deepEqual(withBoth.conflicts,[]);assert.equal(withBoth.mapping[1].id,1);assert.deepEqual(withBoth.entries[1].citations,['c1','c2']);
  const one=live.restoreBindings(snapshot([second],[],ledger({1:ledgerEntry(a,['c1','c2'])})));
  assert.equal(one.mapping[1].id,1);assert.deepEqual(one.entries[1].citations,['c2']);
  const none=live.restoreBindings(snapshot([],[],ledger({1:ledgerEntry(a,['c1','c2'])})));
  assert.equal(none.mapping[1],undefined);assert.deepEqual(none.retired,[1]);
});

test('T05 rebinding an existing label is rejected until the replacement is explicit',()=>{
  const a=item(1,'A'),b=item(2,'B'),h=item(8,'H'),{references:r,entries}=baseDocument();
  entries[2]=ledgerEntry(b,['b-id']);
  const s=snapshot([field({start:10,items:[b],citationID:'b-id',text:'[2]'}),field({start:20,items:[r[3]],citationID:'c3',text:'[3]'})],
    [marker(4,0)],JSON.stringify({version:2,entries}));
  assert.throws(()=>live.plan(s,['0:3'],{4:r[4],2:h},options),/绑定/);
  assert.throws(()=>live.recoverBindings(s,{2:h}),/当前|不一致/);
  const replaced=snapshot([field({start:10,items:[h],citationID:'b-id',text:'[2]'}),field({start:20,items:[r[3]],citationID:'c3',text:'[3]'})],
    [marker(4,0)],JSON.stringify({version:2,entries}));
  assert.equal(live.restoreBindings(replaced).conflicts[0],2);
  const recovered=live.recoverBindings(replaced,{2:h});
  const restored=live.restoreBindings({...replaced,bindingData:recovered.bindingData});
  assert.equal(restored.mapping[2].id,8);
  assert.equal(restored.conflicts.length,0);
});

test('T06 add, append, delete and move keep reference identity after each operation',()=>{
  const a=item(1,'A'),b=item(2,'B'),c=item(3,'C'),h=item(8,'H');
  const aField=field({start:0,items:[a],citationID:'a',text:'[1]'}),bField=field({start:10,items:[b],citationID:'b',text:'[2]'}),cField=field({start:20,items:[c],citationID:'c',text:'[3]'});
  const initial=snapshot([aField,bField,cField],[marker(8,3)],JSON.stringify({version:2,entries:{1:ledgerEntry(a,['a']),2:ledgerEntry(b,['b']),3:ledgerEntry(c,['c'])}}));
  const add=live.plan(initial,['3:6'],{8:h},options);
  const merged=field({start:0,items:[a,h],citationID:'a',text:'[1, 2]'});
  assert.equal(live.verifyCommit(initial,snapshot([merged,bField,cField],[],add.bindingData),add).ok,true);
  assert.equal(JSON.parse(add.bindingData).entries[8].uris[0],h.uris[0]);
  let ledgerData=add.bindingData,fields=[merged,bField,cField];
  const appended=snapshot(fields,[marker(9,30)],ledgerData);
  const append=live.plan(appended,['30:33'],{9:b},options);
  assert.equal(JSON.parse(append.bindingData).entries[2].citations.length,1);
  assert.deepEqual(JSON.parse(append.bindingData).entries[9].uris,b.uris);
  const bNew=field({start:30,items:[b],citationID:append.operations[0].citationID,text:'[4]'});
  assert.equal(live.verifyCommit(appended,snapshot([...fields,bNew],[],append.bindingData),append).ok,true);
  const finalized=live.finalizePlan(append,appended,snapshot([...fields,bNew],[],append.bindingData));
  assert.equal(finalized.ok,true);ledgerData=finalized.bindingData;
  const deleted=live.restoreBindings(snapshot([merged,cField],[],ledgerData));
  assert.equal(deleted.mapping[2],undefined);assert.equal(deleted.retired.includes(2),true);
  assert.equal(deleted.mapping[9],undefined);assert.equal(deleted.retired.includes(9),true);
  const moved=live.restoreBindings(snapshot([bField,merged,cField],[],ledgerData));
  assert.equal(moved.mapping[2].id,2);assert.equal(moved.retired.includes(2),false);
  assert.equal(moved.mapping[9].id,2);
  assert.equal(moved.mapping[8].id,8);
});

test('T11 adjacent merge stops at paragraph breaks and preserves item attributes',()=>{
  const a=item(1,'A'),h=item(8,'H');
  const attributed={...a,citationItems:undefined,locator:'12',prefix:'see ',suffix:' pp.'};
  const entry={...a,locator:'12',prefix:'see ',suffix:' pp.'};
  const first=field({start:0,items:[entry],citationID:'a',text:'[1]',textAfter:'\r '});
  const s=snapshot([first],[marker(8,4)],ledger({1:ledgerEntry(a,['a'])}));
  const plan=live.plan(s,['4:7'],{8:h},options);
  assert.equal(plan.operations[0].kind,'insert');
  const near=snapshot([field({start:0,items:[entry],citationID:'a',text:'[1]',textAfter:'，'})],[marker(8,4)],ledger({1:ledgerEntry(a,['a'])}));
  const merged=live.plan(near,['4:7'],{8:h},options).operations[0];
  assert.equal(merged.kind,'mergeAdjacent');
  const citation=JSON.parse(merged.code.split('CSL_CITATION ')[1]);
  assert.equal(citation.citationItems[0].locator,'12');
  assert.equal(citation.citationItems[0].prefix,'see ');
  assert.equal(citation.citationItems[0].suffix,' pp.');
});

test('T11 duplicate adjacent reference is merged once, without a second identity',()=>{
  const a=item(1,'A');
  const s=snapshot([field({start:0,items:[a],citationID:'a',text:'[1]',textAfter:' [2]'})],[marker(8,3)],ledger({1:ledgerEntry(a,['a'])}));
  const plan=live.plan(s,['3:6'],{8:a},options);
  const op=plan.operations[0];
  assert.equal(op.kind,'mergeAdjacent');
  const citation=JSON.parse(op.code.split('CSL_CITATION ')[1]);
  assert.equal(citation.citationItems.length,1);
  assert.equal(JSON.parse(plan.bindingData).entries[2],undefined);
});

test('T15 preview numbers are only claimed for a verified numeric style',()=>{
  const {references:r,s}=baseDocument();
  const numeric=live.plan(s,['4:7'],{8:r[8]},{...options,numeric:true});
  assert.equal(numeric.preview.numeric,true);
  assert.equal(numeric.preview.limited,undefined);
  const authorDate=live.plan(s,['4:7'],{8:r[8]},{...options,numeric:false});
  assert.equal(authorDate.preview.numeric,false);
  assert.match(authorDate.preview.limited,/不是已确认的数字连续制式/);
  assert.deepEqual(authorDate.preview.order.map(entry=>entry.title),['A','H','B','C','D','E','F','G']);
});
