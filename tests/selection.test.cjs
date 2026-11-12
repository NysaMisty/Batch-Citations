const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const selection=require('../addon/content/selection.js');
const core=require('../addon/content/core.js');
const record=n=>({id:n,uris:[`http://zotero.org/users/1/items/ITEM000${n}`],itemData:{type:'book',title:'Book '+n}});
const occurrence=(key,raw,eligible=true)=>({key,raw,eligible,numbers:core.parseMarker(raw),reason:eligible?'':'protected field'});
const scan={occurrences:[occurrence('one','[1]'),occurrence('pair','[1,2]'),occurrence('range','[2-4]'),occurrence('protected','[1]',false)]};

test('bulk selection requires valid bindings for every number in a compound citation',()=>{
  let result=selection.reconcile(scan,{1:record(1)},null);
  assert.deepEqual([...result.selected],['one']);
  assert.deepEqual(result.skipped.find(o=>o.key==='pair').missing,[2]);
  assert.deepEqual(result.skipped.find(o=>o.key==='range').missing,[2,3,4]);
  result=selection.reconcile(scan,{1:record(1),2:record(2),3:record(3)},null);
  assert.deepEqual([...result.selected],['one','pair']);
  assert.deepEqual([...selection.reconcile(scan,{1:record(1),2:record(2),3:record(3),4:record(4)},null).selected],['one','pair','range']);
});

test('cleared, malformed and invalidated bindings prune whole selected positions',()=>{
  const mapping={1:record(1),2:record(2),3:record(3),4:record(4)};
  const selected=new Set(['one','pair','range','stale']);
  delete mapping[2];
  assert.deepEqual([...selection.reconcile(scan,mapping,selected).selected],['one']);
  mapping[1]={uris:[],itemData:{}};
  assert.equal(selection.reconcile(scan,mapping,selected).selected.size,0);
  mapping[1]=record(1);mapping[2]=record(2);
  const options={valid:r=>r.id!==3};
  assert.deepEqual([...selection.reconcile(scan,mapping,selected,options).selected],['one','pair']);
  assert.equal(selected.size,4,'policy must not mutate the caller selection');
});

test('ambiguous source labels and protected ranges remain blocked with complete mappings',()=>{
  const mapping={1:record(1),2:record(2),3:record(3),4:record(4)};
  const result=selection.reconcile(scan,mapping,null,{ambiguous:n=>n===2});
  assert.deepEqual([...result.selected],['one']);
  assert.deepEqual(result.skipped.find(o=>o.key==='range').ambiguous,[2]);
  assert.equal(selection.state(scan.occurrences[3],mapping).selectable,false);
  assert.equal(selection.state({eligible:true,numbers:[]},mapping).selectable,false);
});

function adapter(items){
  const context={};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/content/zotero-adapter.js'),'utf8'),context);
  return new context.ZBAdapter({Items:{get:id=>items.get(id)},URI:{getItemURI:item=>record(item.id).uris[0]}},{});
}
test('local record validity checks deletion, regular item type and URI identity',()=>{
  const items=new Map([[1,{id:1,deleted:false,isRegularItem:()=>true}]]),api=adapter(items);
  assert.equal(api.mappingRecordValid(record(1)),true);
  assert.equal(api.mappingRecordValid({...record(2),id:1}),false);
  items.get(1).deleted=true;assert.equal(api.mappingRecordValid(record(1)),false);
  items.get(1).deleted=false;items.get(1).isRegularItem=()=>false;
  assert.equal(api.mappingRecordValid(record(1)),false);
  items.clear();assert.equal(api.mappingRecordValid(record(1)),false);
});
test('a field-backed embedded reference remains valid without a local library item',()=>{
  const api=adapter(new Map()),embedded=record(9);
  assert.equal(api.mappingRecordValid(embedded,{existing:{ref:embedded}}),true);
  assert.equal(api.mappingRecordValid(record(8),{existing:{ref:embedded}}),false);
  assert.equal(api.mappingRecordValid({uris:embedded.uris},{existing:{ref:embedded}}),false);
});
