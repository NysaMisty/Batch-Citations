const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sequenceStatus,assertUnique,assignUnique,assignPlain,duplicateNumbers,OrderedSession}=require('../addon/content/mapping.js');
const paper=n=>({id:n,uris:[`http://zotero.org/users/1/items/TEST000${n}`],itemData:{title:`Paper ${n}`}});
test('ordered matching skips committed numbers and refuses ordinary edit or clear',()=>{
  const session=new OrderedSession([1,2,3],{1:paper(1),2:paper(2)},[1,2]);
  assert.equal(session.currentNumber,3);assert.throws(()=>session.edit(2),/绑定/);assert.throws(()=>session.clear(1),/绑定/);
  session.assign(paper(3));assert.equal(session.currentNumber,null);assert.equal(session.finish()[2].id,2);
});
test('sequence check sorts distinct numbers, reports gaps and accepts continuous excerpts',()=>{
  const input=[3,1,2,1],s=sequenceStatus(input);
  assert.deepEqual(s.numbers,[1,2,3]);assert.equal(s.consecutive,true);assert.deepEqual(input,[3,1,2,1]);
  assert.deepEqual(sequenceStatus([1,3,6]).missingRanges,[[2,2],[4,5]]);
  assert.equal(sequenceStatus([5,6]).consecutive,true);assert.equal(sequenceStatus([5,6]).startsAtOne,false);
  assert.deepEqual(sequenceStatus([1,99999]).missingRanges,[[2,99998]]);
  assert.equal(sequenceStatus([]).consecutive,false);assert.throws(()=>sequenceStatus([0]));
});
test('duplicate current item IDs or normalized Zotero URIs are blocked atomically',()=>{
  const base={1:paper(1)};
  assert.throws(()=>assignUnique(base,2,paper(1)),/\[1\]/);
  assert.throws(()=>assignUnique({1:paper(1),2:paper(2)},1,paper(2)),/已分配给编号 \[2\].*\[1\]/);
  assert.deepEqual(Object.keys(base),['1']);
  assert.throws(()=>assertUnique({1:paper(1),2:{id:2,uris:['https://www.zotero.org/users/1/items/TEST0001/']}}),/\[1\]/);
  assert.throws(()=>assertUnique({1:paper(1),2:{id:1,uris:['http://zotero.org/users/1/items/OTHER']}}));
});
test('reselecting the same numbered item is allowed; identical titles do not identify an item',()=>{
  assert.equal(assignUnique({1:paper(1)},1,paper(1))[1].id,1);
  const second=paper(2);second.itemData.title='Paper 1';
  assert.doesNotThrow(()=>assertUnique({1:paper(1),2:second}));
});
test('ordered assignment preserves actual add order and does not mutate the source mapping',()=>{
  const base={},session=new OrderedSession([1,2,3],base);
  for(const n of [3,1,2])session.assign(paper(n));
  assert.equal(session.currentNumber,null);assert.equal(session.complete,true);
  assert.deepEqual([1,2,3].map(n=>session.finish()[n].id),[3,1,2]);assert.deepEqual(base,{});
});
test('duplicate batch choice stays at the same number and retains the previous draft',()=>{
  const session=new OrderedSession([1,2,3]);session.assign(paper(1));
  assert.throws(()=>session.assign(paper(1)),/\[1\]/);
  assert.equal(session.currentNumber,2);assert.equal(session.count,1);
  assert.equal(session.finish()[1].id,1);
});
test('queue edit and clear preserve unrelated mappings and accept sparse original numbers',()=>{
  const base={1:paper(1),2:paper(2),9:paper(9)},session=new OrderedSession([1,2],base);
  session.edit(2);assert.throws(()=>session.assign(paper(1)));session.assign(paper(3));
  session.clear(1);assert.equal(session.complete,false);session.assign(paper(2));
  assert.equal(session.finish()[9].id,9);assert.equal(session.finish()[1].id,2);assert.equal(base[2].id,2);
  assert.deepEqual(new OrderedSession([1,3]).numbers,[1,3]);
});
test('live ordered session allows one reference at multiple labels while legacy stays unique',()=>{
  const live=new OrderedSession([1,2],{},[],{unique:false});
  live.assign(paper(7));live.assign(paper(7));
  assert.deepEqual([1,2].map(n=>live.finish()[n].id),[7,7]);
  assert.equal(assignPlain({1:paper(7)},2,paper(7))[2].id,7);
  const legacy=new OrderedSession([1,2]);legacy.assign(paper(7));assert.throws(()=>legacy.assign(paper(7)),/\[1\]/);
  const locked=new OrderedSession([1,2],{1:paper(1)},[1],{unique:false});
  assert.throws(()=>locked.edit(1),/绑定/);
});
test('moving a draft slot updates its numbered records atomically and follows the editing target',()=>{
  const base={1:paper(1),2:paper(2),3:paper(3),9:paper(9)},before=JSON.stringify(base);
  const session=new OrderedSession([1,2,3],base);session.edit(2);
  session.move(3,1);
  assert.deepEqual([1,2,3].map(n=>session.mapping[n].id),[3,1,2]);
  assert.equal(session.currentNumber,3);
  session.move(1,2);
  assert.deepEqual([1,2,3].map(n=>session.finish()[n].id),[1,3,2]);
  assert.equal(session.finish()[9].id,9);assert.equal(JSON.stringify(base),before);
  assert.deepEqual([1,2,3].map(n=>new OrderedSession([1,2,3],base).mapping[n].id),[1,2,3]);
});
test('invalid moves and locked barriers cannot partially rebind a draft',()=>{
  const session=new OrderedSession([1,2,3,4],{1:paper(1),2:paper(2),3:paper(3),4:paper(4)},[2]);
  const before=JSON.stringify(session.mapping),target=session.currentNumber;
  for(const [from,to]of [[1,0],[4,5],[2,3],[1,3],[4,1],[1.5,1]]){
    assert.equal(session.canMove(from,to),false);assert.throws(()=>session.move(from,to));
    assert.equal(JSON.stringify(session.mapping),before);assert.equal(session.currentNumber,target);
  }
  assert.equal(session.canMove(3,4),true);session.move(3,4);
  assert.deepEqual([1,2,3,4].map(n=>session.mapping[n].id),[1,2,4,3]);
});
test('partial drafts reorder holes without loss and remain compatible with clear and replacement',()=>{
  const session=new OrderedSession([5,6,7],{5:paper(1),7:paper(2)});
  session.move(7,5);
  assert.deepEqual([5,6,7].map(n=>session.mapping[n]?.id),[2,1,undefined]);
  assert.equal(session.currentNumber,7);assert.equal(session.count,2);assert.equal(session.finish()[7],undefined);
  assert.equal(session.canMove(7,6),false);session.assign(paper(3));
  session.clear(6);session.assign(paper(4));session.move(6,7);
  assert.deepEqual([5,6,7].map(n=>session.finish()[n].id),[2,3,4]);
});
test('live repeated references survive moves while the legacy uniqueness rule remains intact',()=>{
  const session=new OrderedSession([1,2,3],{1:paper(1),2:paper(1),3:paper(2)},[],{unique:false});
  session.move(3,1);session.move(2,3);
  assert.deepEqual([1,2,3].map(n=>session.finish()[n].id),[2,1,1]);
  assert.throws(()=>new OrderedSession([1,2,3],session.mapping),/已分配/);
});

test('partial application emits only explicit changes and preserves untouched and outside bindings',()=>{
  const base={2:paper(2),9:paper(9)},session=new OrderedSession([1,2,3],base,[],{unique:false});
  session.assign(paper(1));
  assert.equal(session.complete,false);assert.deepEqual(session.changes(),{1:paper(1)});
  assert.deepEqual(session.finish(),{1:paper(1),2:paper(2),9:paper(9)});
  session.clear(2);assert.deepEqual(session.changes(),{1:paper(1),2:null});
  assert.deepEqual(base,{2:paper(2),9:paper(9)});
});

test('focused queue starts at the requested sparse number while retaining all other editing and sorting',()=>{
  const base={1:paper(1),8:paper(2)},session=new OrderedSession([1,3,8],base,[],{unique:false,focusNumber:8});
  assert.equal(session.currentNumber,8);session.assign(paper(3));
  assert.equal(session.currentNumber,3);assert.deepEqual(session.changes(),{8:paper(3)});
  assert.equal(session.finish()[1],base[1]);session.edit(1);session.clear(1);
  assert.equal(session.currentNumber,1);assert.equal(session.canMove(8,3),true);session.move(8,3);
  assert.deepEqual(session.changes(),{1:null,3:paper(3),8:null});assert.equal(base[1].id,1);
});

test('skip advances without assigning or deleting a numbered slot and partial order remains applicable',()=>{
  const session=new OrderedSession([1,2,3]);session.skip();assert.equal(session.currentNumber,2);
  session.assign(paper(2));assert.equal(session.currentNumber,3);
  assert.deepEqual(session.changes(),{2:paper(2)});assert.deepEqual(session.finish(),{2:paper(2)});
  session.move(2,1);assert.deepEqual(session.changes(),{1:paper(2)});
});

test('ordinary selection advances through actual sparse numbers without filling missing labels',()=>{
  const session=new OrderedSession([1,3,8],{},[],{unique:false,focusNumber:1});
  session.assign(paper(1));assert.equal(session.currentNumber,3);
  session.assign(paper(3));assert.equal(session.currentNumber,8);
  assert.deepEqual(session.changes(),{1:paper(1),3:paper(3)});
  session.assign(paper(8));assert.equal(session.currentNumber,null);
  assert.deepEqual(Object.keys(session.finish()),['1','3','8']);
});

test('duplicate checks list every other original label by identity and ignore equal titles',()=>{
  const normalized={id:90,uris:['https://www.zotero.org/users/1/items/TEST0001/'],itemData:{title:'Different title'}};
  const sameTitle={...paper(2),itemData:{title:'Paper 1'}};
  assert.deepEqual(duplicateNumbers({3:paper(1),8:normalized,9:sameTitle},12,paper(1)),[3,8]);
  assert.deepEqual(duplicateNumbers({3:paper(1)},3,paper(1)),[]);
  assert.deepEqual(duplicateNumbers({3:paper(1)},8,sameTitle),[]);
});
