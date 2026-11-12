'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const status=require('../addon/content/reference-status.js');
const record=id=>({uris:[`https://zotero.org/users/1/items/TEST000${id}`],itemData:{title:`Paper ${id}`}});
test('citation status uses distinct native citation IDs and all eligible manual positions',()=>{
  const a=record(1),b=record(2),state={references:[{record:a,occurrences:[{citation:{citationID:'c1'}},{citation:{citationID:'c1'}},{citation:{citationID:'c2'}}]}]};
  const scan={occurrences:[{key:'p1',eligible:true,numbers:[1,1,3]},{key:'p2',eligible:true,numbers:[3]},{key:'p3',eligible:false,numbers:[1]},{key:'p4',eligible:true,numbers:[2]}]};
  const mapping={1:a,2:b,3:{...a,uris:[a.uris[0].replace('https:','http:')+'/']}};
  const before=JSON.stringify({state,scan,mapping});
  assert.deepEqual(status.count(a,null,state,scan,mapping),{existing:2,pending:2});
  assert.deepEqual(status.count(b,2,state,scan,mapping),{existing:0,pending:1});
  assert.equal(status.format(status.count(a,null,state,scan,mapping)),'已引用 2 · 待转换 2');
  assert.equal(JSON.stringify({state,scan,mapping}),before);
});
test('unassigned labels retain their own real marker counts and empty status is a dash',()=>{
  const scan={occurrences:[{eligible:true,numbers:[4,4]},{eligible:true,numbers:[4]},{eligible:false,numbers:[4]}]};
  assert.deepEqual(status.count(null,4,null,scan,{}),{existing:0,pending:2});
  assert.equal(status.format({existing:0,pending:2}),'待转换 2 处');
  assert.equal(status.format({existing:3,pending:0}),'已引用 3 处');
  assert.equal(status.format({existing:0,pending:0}),'—');
});
