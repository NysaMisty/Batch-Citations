const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Service}=require('../addon/content/live-service.js');
const core=require('../addon/content/core.js');
const {item,field,snapshot:snap,marker,ledger,ledgerEntry}=require('./helpers/citations.cjs');
const live=require('../addon/content/live-core.js');
const CAPABILITIES=live.capabilities();
function setup(){
  let i=0,clock=0;const calls=[],scheduled=[];
  class Data {constructor(text){Object.assign(this,JSON.parse(text));}serialize(){return JSON.stringify(this);}}
  const native={getDocumentData:async()=>native.data,cleanup:async()=>calls.push('cleanup'),complete:async()=>calls.push('complete'),setDocumentData:async()=>calls.push('data')};
  const session={data:new Data(core.documentData('ieee','en-US','10')),progressBar:{hide:()=>calls.push('hide')}};
  const z={version:'10.0.7',Styles:{init:async()=>{},getVisible:()=>[{styleID:'http://www.zotero.org/styles/ieee',hasBibliography:true,class:'in-text'}]},
    logError:()=>{},Promise:{defer:()=>({promise:Promise.resolve(),resolve:()=>calls.push('resolved')})},
    Integration:{DocumentData:Data,currentDoc:false,getApplication:()=>({getDocument:async()=>native}),getSession:async()=>[session,false],Interface:class {async refresh(){calls.push('refresh');}async addEditBibliography(){calls.push('bibliography');}}}};
  const service=new Service(z,{openLive:job=>calls.push(job),schedule:fn=>scheduled.push(fn)}, {token:'a'.repeat(64),randomID:()=>String(++i),now:()=>clock});
  const start=service.start.bind(service);service.start=args=>start({protocol:3,capabilities:CAPABILITIES,...args});
  const snapshot={documentKey:'doc',fingerprint:'hash',documentData:core.documentData('ieee','en-US','10'),candidates:[],bibliographyCount:0};
  return {service,z,calls,scheduled,native,snapshot,setTime:n=>clock=n};
}
test('live bridge rejects unauthenticated or browser-origin requests',async()=>{
  const {service}=setup();
  for(const headers of [{},{authorization:'Bearer '+service.token,origin:'http://evil.test'},{authorization:'Bearer '+service.token,'sec-fetch-site':'none'}]){
    const result=await service.request({headers,data:{protocol:1,action:'start'}});assert.equal(result[0],403);
  }
});
test('older Word clients cannot omit persistent binding metadata and silently accept new plans',async()=>{
  const {service,snapshot}=setup();
  const headers={authorization:'Bearer '+service.token};
  const data={protocol:3,action:'start',payload:{command:'batch',snapshot,protocol:3,capabilities:CAPABILITIES}};
  const old=await service.request({headers,data});assert.equal(old[0],400);assert.match(JSON.parse(old[2]).error,/同时更新/);assert.equal(service.jobs.size,0);
  const current=await service.request({headers,data:{...data,clientVersion:'1.1.4'}});assert.equal(current[0],200);
});
test('transactions are exclusive, authenticated, expiring and accept a commit only once',async()=>{
  const s=setup(),{service,snapshot}=s;
  const {id}=await service.start({command:'refresh',snapshot});
  await assert.rejects(service.start({command:'refresh',snapshot}),/尚未完成/);
  const plan=(await service.handle('poll',{id})).plan;
  assert.notEqual(plan.documentData,snapshot.documentData);assert.ok(JSON.parse(plan.documentData).prefs.zbcTransaction);
  await assert.rejects(service.handle('committed',{id,snapshot:{documentKey:'other',documentData:plan.documentData}}),/身份/);
  const ack={id,snapshot:{documentKey:'doc',documentData:plan.documentData}};
  await service.handle('committed',ack);await assert.rejects(service.handle('committed',ack),/重复/);
  assert.equal(s.scheduled.length,1);
  s.setTime(16*60*1000);service.expire();assert.throws(()=>service.job(id),/过期/);
});
test('protocol-3 completion waits for post-commit verification and a field-free finalization',async()=>{
  const s=setup(),{service,snapshot}=s;
  const {id}=await service.start({command:'refresh',snapshot,protocol:3,capabilities:CAPABILITIES});
  const job=service.job(id);
  assert.equal(job.legacy,false);assert.equal(job.plan.protocol,3);assert.equal(job.plan.staged,true);
  s.native.data=job.plan.documentData;
  await service.run(job);
  assert.equal(job.state,'verifying');
  const verified=await service.handle('verify',{id,snapshot:{...snapshot,documentData:job.plan.documentData,fingerprint:'after-fields'}});
  assert.equal(verified.state,'finalizing');
  assert.deepEqual(JSON.parse(verified.finalization.bindingData),{version:2,revision:1,entries:{},references:{},occurrences:[]});
  assert.equal(verified.finalization.fingerprint,'after-fields');
  const done=await service.handle('finalized',{id,documentKey:'doc',transactionId:job.plan.transactionId});
  assert.equal(done.state,'done');
  assert.equal(job.finalized,true);
});

test('a carrier-only sync verifies the ledger without running a native refresh',async()=>{
  const s=setup(),a=item(1,'A');
  const before=snap([field({start:0,items:[a],citationID:'new-carrier',text:'[1]'})],[],ledger({1:ledgerEntry(a,['old-carrier'])}));
  before.documentData=core.documentData('ieee','en-US','10');
  const {id}=await s.service.start({command:'batch',snapshot:before,protocol:3,capabilities:CAPABILITIES});
  const job=s.service.job(id);
  s.service.sync(id);
  assert.equal(job.plan.syncOnly,true);assert.deepEqual(job.plan.operations,[]);
  s.native.data=job.plan.documentData;
  await s.service.run(job);
  assert.equal(job.state,'verifying');
  assert.ok(!s.calls.includes('refresh')&&!s.calls.includes('complete'));
  const verified=await s.service.handle('verify',{id,snapshot:{...before,documentData:job.plan.documentData}});
  assert.equal(verified.state,'finalizing');
  const entries=JSON.parse(verified.finalization.bindingData).entries;
  assert.deepEqual(entries[1].citations,['new-carrier']);
});

test('a protocol-3 completion that loses a reference stops in needs-recovery instead of done',async()=>{
  const s=setup(),a=item(1,'A');
  const before=snap([field({start:0,items:[a],citationID:'c1',text:'[1]'})],[],ledger({1:ledgerEntry(a,['c1'])}));
  before.documentData=core.documentData('ieee','en-US','10');
  const {id}=await s.service.start({command:'refresh',snapshot:before,protocol:3,capabilities:CAPABILITIES});
  s.native.data=s.service.job(id).plan.documentData;
  await s.service.run(s.service.job(id));
  const result=await s.service.handle('verify',{id,snapshot:{...before,citationFields:[],citationCodes:[],fingerprint:'lost'}});
  assert.equal(result.state,'needs-recovery');
  assert.ok(result.issues.some(issue=>issue.code==='reference-lost'&&issue.blocking));
  assert.equal(s.service.job(id).state,'needs-recovery');
  await assert.rejects(s.service.handle('finalized',{id,documentKey:'doc'}),/尚未通过/);
});

test('a legacy Word client cannot receive a plan with adjacent merges',async()=>{
  const s=setup(),a=item(1,'A'),h=item(8,'H');
  const base=snap([field({start:0,items:[a],citationID:'a',text:'[1]',textAfter:'，'})],[marker(2,4)],ledger({1:ledgerEntry(a,['a'])}));
  base.documentData=core.documentData('ieee','en-US','10');
  await assert.rejects(s.service.start({command:'batch',snapshot:base,protocol:1,capabilities:[]}),/协议|能力|更新/);
  assert.equal(s.service.jobs.size,0);
});

test('native document mismatch stops before session update and releases all integration locks',async()=>{
  const s=setup();const {id}=await s.service.start({command:'refresh',snapshot:s.snapshot});
  s.native.data='another document';
  await s.service.run(s.service.job(id));
  assert.equal(s.service.job(id).state,'needs-recovery');assert.ok(!s.calls.includes('refresh'));
  assert.deepEqual(s.calls,['cleanup','complete','resolved']);assert.equal(s.z.Integration.currentDoc,false);
});

test('saved document refresh avoids stale path monikers and still validates the transaction nonce',async()=>{
  const s=setup();s.snapshot.path='D:\\saved document.docx';
  s.z.Integration.getApplication=()=>({getDocument:async name=>{
    if(name!=='__zbc_active__')throw new Error('stale saved-document ROT entry');
    return s.native;
  }});
  const {id}=await s.service.start({command:'refresh',snapshot:s.snapshot});
  s.native.data=s.service.job(id).plan.documentData;
  await s.service.run(s.service.job(id));assert.equal(s.service.job(id).state,'verifying');assert.ok(s.calls.includes('refresh'));
});

test('native bibliography completion wakes one deferred open without a timer or stale snapshot',async()=>{
  const s=setup();let release,wakes=0;
  s.z.Integration.currentDoc=true;s.z.Integration.currentCommandPromise=new Promise(r=>release=r);
  s.service.owner.notifyWord=()=>wakes++;
  for(let i=0;i<3;i++)assert.deepEqual(await s.service.start({command:'batch',snapshot:s.snapshot}),{waitingForNative:true});
  assert.equal(s.service.jobs.size,0);assert.equal(s.calls.length,0);
  s.z.Integration.currentDoc=false;release();await s.z.Integration.currentCommandPromise;assert.equal(wakes,1);
  const fresh={...s.snapshot,fingerprint:'after bibliography',bibliographyCount:1};
  const {id}=await s.service.start({command:'batch',snapshot:fresh});assert.equal(s.service.job(id).snapshot,fresh);
});

test('Zotero 7 native completion is tracked without currentCommandPromise and restored on shutdown',async()=>{
  const s=setup();let finish,wakes=0;const pending=new Promise(r=>finish=r);
  const native=function(){this.currentDoc=true;return pending;};s.z.Integration.execCommand=native;
  delete s.z.Integration.currentCommandPromise;
  const observed=new Service(s.z,{notifyWord(){wakes++;},openLive(){}},{token:'b'.repeat(64),randomID:()=> 'native-seven'});
  assert.equal(s.z.Integration.execCommand(),pending);
  assert.deepEqual(await observed.start({command:'batch',snapshot:s.snapshot,protocol:3,capabilities:CAPABILITIES}),{waitingForNative:true});
  s.z.Integration.currentDoc=false;finish();await pending;assert.equal(wakes,1);
  assert.ok((await observed.start({command:'batch',snapshot:s.snapshot,protocol:3,capabilities:CAPABILITIES})).id);
  observed.close();assert.equal(s.z.Integration.execCommand,native);
});
test('existing bibliography is refreshed instead of being inserted again',async()=>{
  const s=setup();s.snapshot.bibliographyCount=1;
  const {id}=await s.service.start({command:'bibliography',snapshot:s.snapshot});
  s.native.data=s.service.job(id).plan.documentData;
  await s.service.run(s.service.job(id));
  assert.equal(s.service.job(id).state,'verifying');assert.ok(s.calls.includes('refresh'));assert.ok(!s.calls.includes('bibliography'));
});
test('native refresh failure is reported and does not leave Zotero busy',async()=>{
  const s=setup();s.z.Integration.Interface=class{async refresh(){throw new Error('real refresh failure');}};
  const {id}=await s.service.start({command:'refresh',snapshot:s.snapshot});s.native.data=s.service.job(id).plan.documentData;
  await s.service.run(s.service.job(id));assert.equal(s.service.job(id).message,'real refresh failure');assert.equal(s.z.Integration.currentDoc,false);
  assert.ok(s.calls.includes('complete'));
});
test('stopping service cancels uncommitted jobs and refuses further requests',async()=>{
  const s=setup();const {id}=await s.service.start({command:'refresh',snapshot:s.snapshot});s.service.close();
  assert.equal(s.service.job(id).state,'cancelled');
  const result=await s.service.request({headers:{authorization:'Bearer '+s.service.token},data:{protocol:1,action:'poll',payload:{id}}});
  assert.equal(result[0],400);
});

test('completion acknowledgement closes only the completed window and permits the next operation',async()=>{
  const s=setup(),closed=[];s.service.owner.closeLive=id=>closed.push(id);
  const first=await s.service.start({command:'refresh',snapshot:s.snapshot});
  await assert.rejects(s.service.handle('completed',{id:first.id}),/尚未完成/);
  s.native.data=s.service.job(first.id).plan.documentData;await s.service.run(s.service.job(first.id));
  await s.service.handle('verify',{id:first.id,snapshot:{...s.snapshot,documentData:s.service.job(first.id).plan.documentData}});
  await s.service.handle('finalized',{id:first.id,documentKey:s.snapshot.documentKey,transactionId:s.service.job(first.id).plan.transactionId});
  await assert.rejects(s.service.handle('completed',{id:first.id,snapshot:{...s.snapshot,documentKey:'other'}}),/文档不匹配/);
  const snapshot={...s.snapshot,candidates:[],citationTexts:['[1]','[2]']};
  await s.service.handle('completed',{id:first.id,snapshot});await s.service.handle('completed',{id:first.id});
  assert.deepEqual(s.service.job(first.id).snapshot.citationTexts,['[1]','[2]']);assert.deepEqual(s.service.job(first.id).scan.numbers,[]);
  assert.deepEqual(closed,[first.id]);
  const second=await s.service.start({command:'refresh',snapshot:s.snapshot});assert.notEqual(second.id,first.id);
  s.service.cancel(second.id);assert.equal(s.service.job(second.id).state,'cancelled');
});

test('a closed dialog cancels its orphan job and focus reports cancellation instead of trapping Word',async()=>{
  const s=setup();s.service.owner.findDialog=()=>null;
  const first=await s.service.start({command:'batch',snapshot:s.snapshot});
  assert.deepEqual(await s.service.handle('focus',{id:first.id}),{state:'cancelled',open:false});
  const second=await s.service.start({command:'batch',snapshot:s.snapshot});
  const third=await s.service.start({command:'batch',snapshot:s.snapshot});
  assert.equal(s.service.job(second.id).state,'cancelled');assert.notEqual(third.id,second.id);
});


test('saved UI mappings survive reopening the unchanged document without modifying a Word snapshot',async()=>{
  const {service,snapshot}=setup(),before=JSON.stringify(snapshot),records={1:item(1,'Chosen')};
  const first=await service.start({command:'batch',snapshot});service.saveReferenceSelection(first.id,{fingerprint:snapshot.fingerprint,mapping:records});service.cancel(first.id);
  const reopened=await service.start({command:'batch',snapshot});assert.equal(service.job(reopened.id).referenceSelection.mapping[1].itemData.title,'Chosen');assert.equal(JSON.stringify(snapshot),before);
  service.saveReferenceSelection(reopened.id,{fingerprint:snapshot.fingerprint,mapping:{}});service.cancel(reopened.id);
  const cleared=await service.start({command:'batch',snapshot});assert.deepEqual(service.job(cleared.id).referenceSelection.mapping,{});service.cancel(cleared.id);
  const changed=await service.start({command:'batch',snapshot:{...snapshot,fingerprint:'changed'}});assert.equal(service.job(changed.id).referenceSelection,undefined);
  assert.throws(()=>service.saveReferenceSelection(changed.id,{fingerprint:'hash',mapping:records}),/编号已变化/);service.cancel(changed.id);
  const other=await service.start({command:'batch',snapshot:{...snapshot,documentKey:'other'}});assert.equal(service.job(other.id).referenceSelection,undefined);service.close();assert.equal(service.referenceSelections.size,0);
});
