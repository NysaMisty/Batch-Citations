'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const live=require('../addon/content/live-core.js');
const state=require('../addon/content/citation-state.js');
const {Service}=require('../addon/content/live-service.js');
const {item,field,marker,snapshot,ledger,ledgerEntry}=require('./helpers/citations.cjs');
const a=item(1,'A'),b=item(2,'B'),h=item(8,'H');
const options={styleID:'ieee',locale:'en-US',numeric:true};
function f(record,id,start,text){return field({items:[record],citationID:id,start,text:text||'[1]'});}

test('current/history ambiguity requires an explicit source and keeps both old references',()=>{
  const s=snapshot([f(a,'a',0),f(h,'h',20,'[2]'),f(b,'b',30,'[3]')],[marker(2,10)],ledger({1:ledgerEntry(a,['a']),2:ledgerEntry(b,['b']),8:ledgerEntry(h,['h'])}));
  assert.throws(()=>live.plan(s,['10:13'],{2:h},options),/来源/);
  const p=live.plan(s,['10:13'],{2:h},{...options,labelResolutions:{2:{source:'current',uris:h.uris}}});
  const entries=JSON.parse(p.bindingData).entries;
  assert.equal(entries[2].uris[0],b.uris[0]);assert.equal(entries[8].citations.length,2);
  assert.throws(()=>live.plan(s,['10:13'],{2:h},{...options,labelResolutions:{2:{source:'current',uris:a.uris}}}),/确认信息/);
});

test('current-number conflict allocation reserves later original labels and stays within valid label bounds',()=>{
  const c=item(3,'C'),d=item(4,'D');
  for(const historical of [7,99999]){
    const before=snapshot([f(b,'b',0,'[1]'),f(a,'a',20,'[2]'),f(d,'d',40,'[3]')],[marker(1,10),marker(8,50)],ledger({1:ledgerEntry(a,['a']),[historical]:ledgerEntry(d,['d'])}));
    const p=live.plan(before,['10:13','50:53'],{1:b,8:c},{...options,labelResolutions:{1:{source:'current',uris:b.uris}}});
    const entries=JSON.parse(p.bindingData).entries,newLabel=historical===7?9:2;
    assert.deepEqual(entries[1].uris,a.uris);assert.deepEqual(entries[historical].uris,d.uris);
    assert.deepEqual(entries[8].uris,c.uris);assert.deepEqual(entries[newLabel].uris,b.uris);
    assert.equal(Object.keys(entries).length,4);
    assert.ok(Object.keys(entries).every(n=>Number(n)>=1&&Number(n)<=99999));
  }
});

test('replacing one repeated A preserves its other occurrence and original label',()=>{
  const s=snapshot([f(h,'first-a',0,'[1]'),f(a,'second-a',20,'[2]')],[],ledger({1:ledgerEntry(a,['first-a','second-a'])}));
  assert.deepEqual(live.restoreBindings(s).conflicts,[1]);
  const p=live.recoverBindings(s,{1:h}),entries=JSON.parse(p.bindingData).entries;
  assert.deepEqual(entries[1].citations,['second-a']);assert.equal(entries[1].uris[0],a.uris[0]);
  assert.deepEqual(entries[2].citations,['first-a']);assert.equal(entries[2].uris[0],h.uris[0]);
  assert.deepEqual(live.restoreBindings({...s,bindingData:p.bindingData}).conflicts,[]);
  assert.equal(live.verifyCommit(s,s,p).ok,true);
});

test('native citations without historical labels can be preserved without inventing labels',()=>{
  const s=snapshot([f(a,'a',0),f(b,'b',20,'[2]')],[marker(8,40)]);
  assert.equal(live.restoreBindings(s).requiresMigration,false);
  const p=live.plan(s,['40:43'],{8:h},options),after=snapshot([f(a,'a',0),f(b,'b',20,'[2]'),f(h,p.operations[0].citationID,40,'[3]')]);
  const verified=live.verifyCommit(s,after,p);assert.equal(verified.ok,true);
  const ledger=JSON.parse(verified.bindingData);assert.deepEqual(Object.keys(ledger.entries),['8']);assert.equal(Object.keys(ledger.references).length,3);
  assert.deepEqual(live.restoreBindings({...after,bindingData:verified.bindingData}).untracked,[]);
});

test('a confirmed URI replacement relation joins identities but a bare local id does not',()=>{
  const changed={...a,uris:['https://zotero.org/users/1/items/NEW00001']};
  const s=snapshot([f(changed,'a',0)],[],ledger({1:ledgerEntry(a,['a'])}));
  assert.deepEqual(live.restoreBindings(s).conflicts,[1]);
  const proven={...s,uriAliases:[{uris:[...a.uris,...changed.uris]}]};
  assert.deepEqual(live.restoreBindings(proven).conflicts,[]);
  assert.equal(live.restoreBindings(proven).mapping[1].uris[0],changed.uris[0]);
});

test('postflight detects unrelated body edits while allowing citation rendering changes',()=>{
  const base=snapshot([f(a,'a',4)],[],ledger({1:ledgerEntry(a,['a'])}),{bodySegments:[{kind:'text',start:0,end:4,text:'Text'},{kind:'citation',start:4,end:7}]});
  const p=live.syncPlan(base),after={...base,citationFields:[f(a,'new-id',4,'[99]')]};
  assert.equal(live.verifyCommit(base,after,p).ok,true);
  assert.equal(live.verifyCommit(base,{...after,bodySegments:[{kind:'text',start:0,end:4,text:'Lost'},{kind:'citation',start:4,end:7}]},p).ok,false);
});

test('two different locators are preserved as two items of one reference',()=>{
  const one={...a,locator:'12',label:'page'},two={...a,locator:'36',label:'page'};
  const s=snapshot([field({start:0,items:[one,two],citationID:'a',text:'[1]'})],[],ledger({1:ledgerEntry(a,['a'])}));
  const p=live.syncPlan(s);
  const bad={...s,citationFields:[f(one,'a',0)]};
  assert.equal(live.verifyCommit(s,bad,p).ok,false);assert.equal(live.restoreBindings(s).state.references.length,1);
});

test('manual result editing is detected before an adjacent merge',()=>{
  const s=snapshot([field({start:0,items:[a],citationID:'a',text:'[edited]',extra:{properties:{plainCitation:'[1]'}}})],[marker(8,8)],ledger({1:ledgerEntry(a,['a'])}));
  assert.throws(()=>live.plan(s,['8:11'],{8:h},options),/手工编辑/);
});

test('new adjacent markers separated by spaces become one ordered insertion',()=>{
  const first={...marker(1,0),textAfter:', [2]'};
  const s=snapshot([],[first,marker(2,5)]),p=live.plan(s,['0:3','5:8'],{1:a,2:b},options);
  assert.equal(p.operations.length,1);assert.equal(p.operations[0].raw,'[1], [2]');
  assert.deepEqual(state.parseCitation(p.operations[0].code).citationItems.map(x=>x.itemData.title),['A','B']);
});

test('recovery preserves approved new labels without inserting fields a second time',()=>{
  const before=snapshot([f(a,'a',0)],[marker(8,20)],ledger({1:ledgerEntry(a,['a'])}));
  const planned=live.plan(before,['20:23'],{8:h},options);
  const after=snapshot([f(a,'a',0),f(h,planned.operations[0].citationID,20,'[2]')],[],before.bindingData,
    {pendingTransaction:'unfinished',transaction:{id:'unfinished',phase:'committed',beforeGraph:planned.expected.beforeGraph,expectedGraph:planned.expected.graph,labels:[{number:8,uris:h.uris}]}});
  const recovery=live.recoveryPlan(after);assert.equal(recovery.resume,true);assert.equal(recovery.syncOnly,false);assert.deepEqual(recovery.operations,[]);
  const verified=live.verifyCommit(after,after,recovery);assert.equal(verified.ok,true);
  assert.equal(JSON.parse(verified.bindingData).entries[8].uris[0],h.uris[0]);
});

test('metadata-only replacement recovery retains the approved scope',()=>{
  const s=snapshot([f(h,'a',0)],[],ledger({1:ledgerEntry(a,['a'])}));
  const graph=state.graphOf(live.documentState(s));
  s.transaction={id:'metadata',metadataOnly:true,phase:'committed',beforeGraph:graph,expectedGraph:graph,labels:[{number:1,uris:h.uris}]};s.pendingTransaction='metadata';
  const recovery=live.recoveryPlan(s),result=live.verifyCommit(s,s,recovery);
  assert.equal(result.ok,true);assert.equal(JSON.parse(result.bindingData).entries[1].uris[0],h.uris[0]);
});

test('automatic refresh reacts to first-use changes and leaves the matching window reusable',async()=>{
  class Data{constructor(s){Object.assign(this,JSON.parse(s));}serialize(){return JSON.stringify(this);}}
  let i=0,closed=0;const service=new Service({Integration:{DocumentData:Data,currentDoc:false},logError:()=>{}},{openLive(){},schedule(){},closeLive(){closed++;}},{token:'x'.repeat(64),randomID:()=>String(++i)});
  const base=snapshot([f(a,'a',0),f(b,'b',20,'[2]')],[],ledger({1:ledgerEntry(a,['a']),2:ledgerEntry(b,['b'])}));
  const {id}=await service.start({command:'batch',snapshot:base,protocol:3,capabilities:live.capabilities()});
  await service.handle('snapshot',{id,snapshot:{...base,fingerprint:'text-change',citationFields:[f(a,'a',0),f(b,'b',25,'[2]')]}});
  assert.equal(service.job(id).state,'pending');
  const moved={...base,fingerprint:'moved',citationFields:[f(b,'b',0,'[2]'),f(a,'a',20)]};
  await service.handle('snapshot',{id,snapshot:moved});const job=service.job(id);
  assert.equal(job.state,'ready');assert.equal(job.plan.autoRefresh,true);
  service.nativeRun=async()=>{};await service.run(job);
  const after={...moved,documentData:job.plan.documentData,citationFields:[f(b,'b',0),f(a,'a',20,'[2]')]};
  await service.handle('verify',{id,snapshot:after});
  await service.handle('finalized',{id,documentKey:base.documentKey,transactionId:job.plan.transactionId});
  const reply=await service.handle('completed',{id,snapshot:after});
  assert.equal(reply.keepOpen,true);assert.equal(job.state,'pending');assert.equal(closed,0);
});

test('style capability distinguishes first-use numbering from bibliography sorting',async()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/content/zotero-adapter.js'),'utf8'),context);
  const {DOMParser}=require('@xmldom/xmldom');
  let sort='';const style={class:'in-text',getXML:()=>'<style xmlns="http://purl.org/net/xbiblio/csl"><macro name="number"><text variable="citation-number"/></macro><citation><layout><text macro="number"/></layout></citation><bibliography>'+sort+'<layout><text variable="title"/></layout></bibliography></style>'};
  const adapter=new context.ZBAdapter({Styles:{get:()=>style}},{DOMParser});
  assert.equal((await adapter.styleCapabilities('test')).firstUse,true);
  sort='<sort><key variable="author"/></sort>';assert.equal((await adapter.styleCapabilities('test')).firstUse,false);
});

test('CSL preview cannot mutate the commit graph with engine-owned item data',async()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/content/zotero-adapter.js'),'utf8'),context);
  const base=snapshot([f(a,'a',0)],[],ledger({1:ledgerEntry(a,['a'])}));
  const plan=live.syncPlan(base);plan.preview={numeric:true,order:[{uris:a.uris}]};
  const graph=JSON.stringify(plan.expected.graph);
  const engine={appendCitationCluster(c){c.citationItems[0].item={id:1,title:'engine-owned'};},makeBibliography(){return [{entry_ids:[[1]]},[]];},free(){}};
  let independent=false;
  class Style{constructor(xml){assert.equal(xml,'independent XML');independent=true;}getCiteProc(){return engine;}}
  const adapter=new context.ZBAdapter({Style,Styles:{get:()=>({getXML:()=> 'independent XML',getCiteProc(){throw new Error('Installed session cache must not be used');}})}},{});
  await adapter.previewLive(plan,'en-US');
  assert.equal(independent,true);assert.equal(plan.preview.verifiedCSL,true);assert.equal(JSON.stringify(plan.expected.graph),graph);
  plan.expected.graph.citations[0].items[0].item={id:1,title:'old engine-owned'};
  assert.equal(live.verifyCommit(base,base,plan).ok,true);
});
