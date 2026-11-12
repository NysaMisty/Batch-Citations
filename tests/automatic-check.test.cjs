const {test}=require('node:test');
const assert=require('node:assert/strict');
const live=require('../addon/content/live-core.js');
const {sequenceStatus}=require('../addon/content/mapping.js');
const {Service}=require('../addon/content/live-service.js');
const core=require('../addon/content/core.js');
const candidate=(n,start=0)=>({start,end:start+3,raw:`[${n}]`,eligible:true,context:`Reference [${n}].`});
function fixture(){
  let n=0;class Data{constructor(s){Object.assign(this,JSON.parse(s));}serialize(){return JSON.stringify(this);}}
  const z={Integration:{DocumentData:Data},logError:()=>{}};
  const service=new Service(z,{openLive(){},schedule(){}},{token:'x'.repeat(64),randomID:()=>String(++n)});
  const start=service.start.bind(service);service.start=args=>start({protocol:3,capabilities:live.capabilities(),...args});
  const snapshot={documentKey:'original',fingerprint:'one',documentData:core.documentData('ieee','en-US','10'),candidates:[candidate(1)],citationTexts:[]};
  return {service,snapshot};
}
test('continuity combines manual markers and native numeric citation results, excluding other fields',()=>{
  const snapshot={documentKey:'a',fingerprint:'a',candidates:[candidate(3),{...candidate(9,9),eligible:false}],citationTexts:['[1, 2]','Author (2023)','[2]–[4]']};
  assert.deepEqual(live.checkNumbers(snapshot),[1,2,3,4]);
  assert.equal(sequenceStatus(live.checkNumbers(snapshot)).consecutive,true);
});
test('reconciling an edited document keeps mappings for surviving numbers and checks only unchanged occurrences',()=>{
  const oldScan=live.scan({documentKey:'a',fingerprint:'a',candidates:[candidate(1),candidate(2,8)]});
  const nextScan=live.scan({documentKey:'a',fingerprint:'b',candidates:[candidate(1),candidate(3,8)]});
  const a={uris:['uri:a']},b={uris:['uri:b']};
  const result=live.reconcileScan(oldScan,nextScan,{1:a,2:b},new Set(['0:3','8:11']));
  assert.deepEqual(result.mapping,{1:a});assert.deepEqual([...result.selected],['0:3']);
});
test('pending snapshot changes notify immediately and atomically, with no cross-document rebinding',async()=>{
  const {service,snapshot}=fixture();const {id}=await service.start({command:'batch',snapshot});
  const job=service.job(id),events=[],unsubscribe=service.subscribe(id,event=>events.push(event.type));
  const next={...snapshot,fingerprint:'two',candidates:[candidate(1),candidate(3,8)]};
  await service.handle('snapshot',{id,snapshot:next});
  assert.deepEqual(job.scan.numbers,[1,3]);assert.deepEqual(events,['snapshot']);
  await assert.rejects(service.handle('snapshot',{id,snapshot:{...next,documentKey:'other'}}),/文档/);
  await assert.rejects(service.handle('snapshot',{id,snapshot:{...next,candidates:[candidate(1),candidate(2)]}}),/重叠/);
  assert.equal(job.snapshot,next);assert.equal(events.length,1);
  unsubscribe();service.cancel(id);assert.equal(events.length,1);
});
test('an empty current document remains observable; submitted jobs refuse updates',async()=>{
  const {service,snapshot}=fixture();snapshot.candidates=[];
  const {id}=await service.start({command:'batch',snapshot});
  assert.deepEqual(service.job(id).scan.numbers,[]);
  await service.handle('snapshot',{id,snapshot:{...snapshot,fingerprint:'new',candidates:[candidate(1)]}});
  const current=service.job(id).snapshot,validData=current.documentData;
  current.documentData=JSON.stringify({...JSON.parse(validData),prefs:{fieldType:'Bookmark',noteType:0}});
  assert.throws(()=>service.submit(id,['0:3'],{1:{id:1,uris:['http://zotero.org/users/1/items/AAAA'],itemData:{id:1,type:'book',title:'A'}}},{styleID:'ieee',locale:'en-US',zoteroVersion:'10'}),/Field/);
  assert.equal(service.job(id).state,'pending');current.documentData=validData;
  service.submit(id,['0:3'],{1:{id:1,uris:['http://zotero.org/users/1/items/AAAA'],itemData:{id:1,type:'book',title:'A'}}},{styleID:'ieee',locale:'en-US',zoteroVersion:'10'});
  await assert.rejects(service.handle('snapshot',{id,snapshot}),/提交/);
});
test('listeners receive completion and cancellation transitions and are isolated from listener errors',async()=>{
  const {service,snapshot}=fixture();const {id}=await service.start({command:'batch',snapshot});
  const seen=[];service.subscribe(id,()=>{throw Error('UI disposed');});service.subscribe(id,e=>seen.push(e.type));
  service.nativeRun=async()=>{};service.sync(id);await service.run(service.job(id));
  await service.handle('verify',{id,snapshot});
  await service.handle('finalized',{id,documentKey:snapshot.documentKey,transactionId:service.job(id).plan.transactionId});
  assert.deepEqual(seen,['ready','verifying','finalizing','done']);
  const second=await service.start({command:'batch',snapshot});service.subscribe(second.id,e=>seen.push(e.type));
  service.close();assert.deepEqual(seen,['ready','verifying','finalizing','done','cancelled']);assert.equal(service.job(second.id).listeners.size,0);
});
