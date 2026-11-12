const {test}=require('node:test');
const assert=require('node:assert/strict');
const live=require('../addon/content/live-core.js');
const core=require('../addon/content/core.js');
const record={id:7,uris:['http://zotero.org/users/local/abc/items/TEST1234'],itemData:{id:7,type:'book',title:'Live reference'}};
const snapshot=()=>({documentKey:'doc-a',fingerprint:'abc',documentData:'',path:'',candidates:[
  {start:4,end:7,raw:'[1]',context:'text[1]',eligible:true,reason:''},
  {start:20,end:23,raw:'[2]',context:'field [2]',eligible:false,reason:'已有域'}
]});
test('live scan reuses bounded marker grammar and preserves protected positions',()=>{
  const scan=live.scan(snapshot());assert.deepEqual(scan.numbers,[1]);assert.equal(scan.occurrences[1].eligible,false);
  const s=snapshot();s.candidates[0].raw='[1-1000]';const unsupported=live.scan(s);assert.equal(unsupported.occurrences[0].eligible,false);assert.match(unsupported.occurrences[0].reason,/不支持/);
});
test('plan binds document and snapshot, stores URIs and creates no automatic bibliography',()=>{
  const s=snapshot(),scan=live.scan(s);
  const p=live.plan(s,[scan.occurrences[0].key],{1:record},{styleID:'http://www.zotero.org/styles/ieee',locale:'en-US',zoteroVersion:'10.0.7'});
  assert.equal(p.documentKey,s.documentKey);assert.equal(p.fingerprint,s.fingerprint);
  assert.equal(p.operations.length,1);assert.ok(!p.operations[0].code.includes('ZOTERO_BIBL'));
  const c=JSON.parse(p.operations[0].code.split('CSL_CITATION ')[1]);
  assert.equal(c.citationItems[0].uris[0],record.uris[0]);assert.equal(c.citationItems[0].itemData.title,record.itemData.title);
  assert.equal(JSON.parse(p.documentData).prefs.fieldType,'Field');
  assert.throws(()=>live.plan(s,[scan.occurrences[1].key],{1:record},{}),/受保护/);
});
test('existing document settings and citation IDs survive incremental batch insertion',()=>{
  const s=snapshot();s.documentData=core.documentData('ieee','en-US','7.0.32');
  const p=live.plan(s,['4:7'],{1:record},{styleID:'other',locale:'zh-CN'});
  assert.equal(p.documentData,s.documentData);
  const a=JSON.parse(p.operations[0].code.split('CSL_CITATION ')[1]);
  const b=JSON.parse(live.plan(s,['4:7'],{1:record},{}).operations[0].code.split('CSL_CITATION ')[1]);
  assert.notEqual(a.citationID,b.citationID);
});
test('malformed and overlapping Word ranges cannot become a commit plan',()=>{
  for(const candidates of [[{start:-1,end:3,raw:'[1]',eligible:true}], [{start:1,end:4,raw:'[1]',eligible:true},{start:2,end:5,raw:'[2]',eligible:true}]]){
    const s=snapshot();s.candidates=candidates;assert.throws(()=>live.scan(s),/范围/);
  }
});
test('standard document data accepts JSON and legacy XML; bookmark/note documents fail before commit',()=>{
  assert.equal(live.documentSettings(core.documentData('ieee','en-US','10')).style.styleID,'ieee');
  assert.throws(()=>live.documentSettings(JSON.stringify({prefs:{fieldType:'Bookmark',noteType:0}})),/Field/);
  assert.throws(()=>live.documentSettings(JSON.stringify({prefs:{fieldType:'Field',noteType:1}})),/脚注/);
});
