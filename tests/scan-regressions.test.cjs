'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const live=require('../addon/content/live-core.js');
const {Service}=require('../addon/content/live-service.js');
const {snapshot,marker}=require('./helpers/citations.cjs');
const core=require('../addon/content/core.js');
const citationState=require('../addon/content/citation-state.js');
const emptyData='<data data-version="3"><session id="cancelled"/><style id=""/><prefs/></data>';
const parseLegacy=()=>({sessionID:'cancelled',style:{styleID:''},prefs:{}});
test('unfinished legacy preferences are new-document settings only with positive evidence of no native references',()=>{
  const s=snapshot([],[marker(1,0)],'',{documentData:emptyData,hasZoteroBookmarks:false});
  assert.equal(live.documentSettings(s.documentData,parseLegacy,s),null);
  assert.equal(s.documentData,emptyData);
  for(const extra of [{hasZoteroBookmarks:true},{hasZoteroBookmarks:undefined},{bibliographyCount:1},{bindingData:'{"version":2,"entries":{}}'},{pendingTransaction:'interrupted'},{citationCodes:['ADDIN ZOTERO_ITEM CSL_CITATION {}']},{unsupportedCitationStories:[2]}]){
    assert.throws(()=>live.documentSettings(s.documentData,parseLegacy,{...s,...extra}),/Field|设置/);
  }
});
test('a confirmed insertion initializes empty legacy preferences without rewriting the source snapshot',()=>{
  const s=snapshot([],[marker(1,0)],'',{documentData:emptyData,hasZoteroBookmarks:false});
  const record={id:1,uris:['https://zotero.org/users/local/test/items/AAAA1111'],itemData:{id:1,type:'book',title:'Test'}};
  const plan=live.plan(s,['0:3'],{1:record},{styleID:'ieee',locale:'en-US',zoteroVersion:'10',parseLegacy});
  assert.equal(JSON.parse(plan.documentData).prefs.fieldType,'Field');
  assert.equal(JSON.parse(plan.documentData).style.styleID,'ieee');
  assert.equal(s.documentData,emptyData);
  assert.throws(()=>live.plan(s,['0:3'],{1:record},{parseLegacy}),/选择引用格式/);
  const standard=snapshot([],[marker(1,0)],'',{documentData:core.documentData('ieee','en-US','10')});
  assert.equal(live.plan(standard,['0:3'],{1:record},{styleID:'other'}).documentData,standard.documentData);
});
test('one unsupported marker remains visible and cannot hide valid neighboring candidates',()=>{
  const s=snapshot([],[marker(1,0),marker(0,5,'[0]'),marker(2,10),marker(3,15,'[3-999]')]);
  const scan=live.scan(s);
  assert.deepEqual(scan.numbers,[1,2]);assert.equal(scan.occurrences.length,4);
  assert.equal(scan.occurrences[1].eligible,false);assert.deepEqual(scan.occurrences[1].numbers,[]);
  assert.match(scan.occurrences[1].reason,/不支持/);
  assert.equal(scan.unsupportedCount,2);
});
test('duplicate or overlapping Word ranges still stop safely instead of being silently deduplicated',()=>{
  assert.throws(()=>live.scan(snapshot([],[marker(1,0),marker(1,0)])),/重叠/);
  assert.throws(()=>live.scan(snapshot([],[marker(1,0),marker(2,1)])),/重叠/);
});
test('candidate limits fail explicitly without truncating the original snapshot',()=>{
  const candidates=Array.from({length:2001},(_,i)=>marker(i+1,i*10)),s=snapshot([],candidates);
  assert.throws(()=>live.scan(s),/超过限制/);
  assert.equal(s.candidates.length,2001);assert.equal(s.candidates.at(-1).raw,'[2001]');
});
test('verification retains all text around non-affine Word object offsets and still detects unrelated edits',()=>{
  const before={bodySegments:[{kind:'text',start:0,end:100,text:'Text with an object '},{kind:'text',start:100,end:103,text:'[1]'},{kind:'text',start:103,end:110,text:' end.\r'}]};
  const operations=[{start:100,end:103}];
  const after={bodySegments:[{kind:'text',start:0,end:100,text:'Text with an object '},{kind:'citation',start:100,end:500},{kind:'text',start:500,end:507,text:' end.\r'}]};
  assert.equal(citationState.skeletonOf(before,operations),citationState.skeletonOf(after));
  const edited=structuredClone(after);edited.bodySegments[0].text='Unexpected edit ';
  assert.notEqual(citationState.skeletonOf(before,operations),citationState.skeletonOf(edited));
});
test('entry failures log their stage and counts without raw document text, then allow retry',async()=>{
  const logs=[],errors=[];let i=0;
  const service=new Service({Integration:{},debug:line=>logs.push(line),logError:e=>errors.push(e)}, {openLive(){},randomID:()=>String(++i)}, {token:'a'.repeat(64)});
  const headers={authorization:'Bearer '+service.token};
  const request=s=>service.request({headers,data:{protocol:3,clientVersion:'1.1.4',action:'start',payload:{command:'batch',snapshot:s,protocol:3,capabilities:live.capabilities()}}});
  const s=snapshot([],[{...marker(1,0),context:'PRIVATE DOCUMENT TEXT'},marker(2,0)]);
  const failed=await request(s);
  assert.equal(failed[0],400);assert.equal(service.jobs.size,0);
  assert.match(JSON.parse(failed[2]).error,/编号识别/);
  assert.ok(logs.some(line=>line.includes('candidate-scan')&&line.includes('candidates=2')));
  assert.ok(errors.length);assert.ok(!JSON.stringify(logs).includes('PRIVATE DOCUMENT TEXT'));
  const valid=await request(snapshot([],[marker(1,0)]));
  assert.equal(valid[0],200);assert.equal(service.jobs.size,1);
});
