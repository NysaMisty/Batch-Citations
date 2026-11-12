'use strict';
// Independent acceptance probes. This file is outside the project source tree.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const live=require(root+'/addon/content/live-core.js');
const state=require(root+'/addon/content/citation-state.js');
const literature=require(root+'/addon/content/literature.js');
const core=require(root+'/addon/content/core.js');
const {Service}=require(root+'/addon/content/live-service.js');
const {item,field,ledger,snapshot,marker,ledgerEntry}=require(root+'/tests/helpers/citations.cjs');
const options={styleID:'ieee',locale:'en-US',zoteroVersion:'10.0.7',numeric:true};
const caps=live.capabilities();
const a=item(1,'A'),b=item(2,'B'),c=item(3,'C'),h=item(8,'H');
const f=(record,id,start,text='[1]',extra={})=>field({start,items:[record],citationID:id,text,...extra});
const data=()=>ledger({1:ledgerEntry(a,['a']),2:ledgerEntry(b,['b']),3:ledgerEntry(c,['c'])});
const {test}=require('node:test');
function check(id,name,fn){test(id+' '+name,fn);}
function serviceFixture(){
  let n=0;
  class Data{constructor(text){Object.assign(this,JSON.parse(text));}serialize(){return JSON.stringify(this);}}
  const z={version:'10.0.7',logError:()=>{},Styles:{init:async()=>{},getVisible:()=>[]},Integration:{currentDoc:false,DocumentData:Data}};
  return new Service(z,{openLive:()=>{},schedule:()=>{}},{token:'a'.repeat(64),randomID:()=>`review-${++n}`});
}
check('R01','new label 8 + new H preserves A,H,B,C first-use preview',()=>{
  const s=snapshot([f(a,'a',0),f(b,'b',20,'[2]'),f(c,'c',30,'[3]')],[marker(8,10)],data());
  const p=live.plan(s,['10:13'],{8:h},options);
  assert.deepEqual(p.preview.order.map(x=>x.title),['A','H','B','C']);
});
check('R02','new label 8 shares B identity and preserves both historical labels',()=>{
  const s=snapshot([f(a,'a',0),f(b,'b',10,'[2]')],[marker(8,30)],data());
  const p=live.plan(s,['30:33'],{8:b},options);
  const entries=JSON.parse(p.bindingData).entries;
  assert.equal(Object.values(entries).filter(x=>state.sameRecord(x,b)).length,2);
  assert.deepEqual(entries[2].uris,b.uris);assert.deepEqual(entries[8].uris,b.uris);
});
check('R03','unambiguous old label 2 cannot be assigned H in selected service input',()=>{
  const s=snapshot([f(a,'a',0),f(b,'b',20,'[2]')],[marker(2,10)],data());
  assert.throws(()=>live.plan(s,['10:13'],{2:h},options),/绑定|歧义|确认/);
});
check('R04','unselected old label 2 is protected (control)',()=>{
  const s=snapshot([f(a,'a',0),f(b,'b',20,'[2]')],[marker(8,10)],data());
  assert.throws(()=>live.plan(s,['10:13'],{8:h,2:h},options),/绑定/);
});
check('R05','postflight rejects loss of one original repeated occurrence',()=>{
  const before=snapshot([f(a,'a',0),f(a,'a2',10)],[marker(8,30)],ledger({1:ledgerEntry(a,['a','a2'])}));
  const p=live.plan(before,['30:33'],{8:h},options);
  const after=snapshot([f(a,'a',0),f(h,p.operations[0].citationID,30,'[2]')],[],before.bindingData);
  assert.equal(live.verifyCommit(before,after,p).ok,false);
});
check('R06','postflight rejects field-to-reference swaps with unchanged unique URI set',()=>{
  const before=snapshot([f(a,'a',0),f(b,'b',10,'[2]')],[marker(8,30)],data());
  const p=live.plan(before,['30:33'],{8:h},options);
  const after=snapshot([f(b,'a',0),f(a,'b',10,'[2]'),f(h,p.operations[0].citationID,30,'[3]')],[],before.bindingData);
  assert.equal(live.verifyCommit(before,after,p).ok,false);
});
check('R07','actual abnormal fixture restores all eight labels by URI',()=>{
  const {snapshotFromFixture}=require(root+'/tests/helpers/docx-evidence.cjs');
  const fixture=JSON.parse(fs.readFileSync(root+'/tests/fixtures/citation-renumbering/abnormal.json','utf8'));
  const restored=live.restoreBindings(snapshotFromFixture(fixture));
  assert.deepEqual(Object.keys(restored.mapping).map(Number),[1,2,3,4,5,6,7,8]);
});
check('R08','verified earlier duplicate records both carriers in document order',()=>{
  const before=snapshot([f(a,'a',20)],[marker(8,0)],ledger({1:ledgerEntry(a,['a'])}));
  const p=live.plan(before,['0:3'],{8:a},options);
  const after=snapshot([f(a,p.operations[0].citationID,0),f(a,'a',20)],[],before.bindingData);
  const verified=live.finalizePlan(p,before,after);
  assert.equal(verified.ok,true);
  assert.deepEqual(JSON.parse(verified.bindingData).entries[1].citations,[p.operations[0].citationID,'a']);
});
check('R09','postflight rejects missing planned new H',()=>{
  const before=snapshot([f(a,'a',0)],[marker(8,20)],ledger({1:ledgerEntry(a,['a'])}));
  const p=live.plan(before,['20:23'],{8:h},options);
  assert.equal(live.verifyCommit(before,snapshot([f(a,'a',0)],[],before.bindingData),p).ok,false);
});
check('R10','postflight rejects unexpected extra occurrence of an already cited reference',()=>{
  const before=snapshot([f(a,'a',0)],[marker(8,20)],ledger({1:ledgerEntry(a,['a'])}));
  const p=live.plan(before,['20:23'],{8:h},options);
  const after=snapshot([f(a,'a',0),f(h,p.operations[0].citationID,20,'[2]'),f(a,'extra-a',40)],[],before.bindingData);
  assert.equal(live.verifyCommit(before,after,p).ok,false);
});
check('R11','postflight rejects changed locator rather than treating it as success',()=>{
  const paged={...a,locator:'12',label:'page',prefix:'see '};
  const before=snapshot([f(paged,'a',0)],[marker(8,20)],ledger({1:ledgerEntry(a,['a'])}));
  const p=live.plan(before,['20:23'],{8:h},options);
  const after=snapshot([f(a,'a',0),f(h,p.operations[0].citationID,20,'[2]')],[],before.bindingData);
  assert.equal(live.verifyCommit(before,after,p).ok,false);
});
check('R12','adjacent multi-source merge copies every source field item',()=>{
  const before=snapshot([f(a,'a',0,'[1]'),f(b,'b',3,'[2]')],[marker(8,6)],data());
  const p=live.plan(before,['6:9'],{8:h},options);
  const op=p.operations.find(x=>x.kind==='mergeAdjacent');
  assert.deepEqual(op.sourceFields.map(x=>x.citationID),['a','b']);
  assert.deepEqual(JSON.parse(op.code.split('CSL_CITATION ')[1]).citationItems.map(x=>x.itemData.title),['A','B','H']);
});
check('R13','custom/dontUpdate source fields fail before a merge is planned',()=>{
  const before=snapshot([f(a,'a',0,'[1]',{extra:{properties:{noteIndex:0,dontUpdate:true,custom:'custom text'}}})],[marker(8,3)],ledger({1:ledgerEntry(a,['a'])}));
  assert.throws(()=>live.plan(before,['3:6'],{8:h},options),/手工|自定义|custom|核对|支持/i);
});
check('R14','live CSV route accepts different free labels using the same reference',()=>{
  const csv='number,uri,title\r\n8,'+a.uris[0]+',A\r\n9,'+a.uris[0]+',A\r\n';
  assert.doesNotThrow(()=>literature.parse(csv,'csv',{live:true}));
});
check('R15','historical label/current display ambiguity blocks automatic B selection',()=>{
  const before=snapshot([f(a,'a',0),f(h,'h',20,'[2]'),f(b,'b',30,'[3]')],[marker(2,10)],ledger({1:ledgerEntry(a,['a']),2:ledgerEntry(b,['b']),8:ledgerEntry(h,['h'])}));
  const mapping={...live.restoreBindings(before).mapping};
  assert.throws(()=>live.plan(before,['10:13'],mapping,options),/歧义|确认|当前编号/);
});
check('R16','all-new adjacent markers reject native H,A reversal',()=>{
  const before=snapshot([],[marker(1,0),marker(2,3)],'');
  const p=live.plan(before,['0:3','3:6'],{1:a,2:h},options);
  const after=snapshot([field({start:0,items:[h,a],citationID:p.operations[0].citationID,text:'[1,2]'})],[],'');
  assert.equal(live.verifyCommit(before,after,p).ok,false);
});
check('R17','refresh protocol-3 plan contains a staged ledger',async()=>{
  const service=serviceFixture(),s=snapshot([],[],'');
  const {id}=await service.start({command:'refresh',snapshot:s,protocol:3,capabilities:caps});
  const p=service.job(id).plan;
  assert.equal(p.staged,true);
  assert.equal(typeof p.bindingData,'string');
});
check('R18','legacy client with matching version is rejected before writes',async()=>{
  const service=serviceFixture(),s=snapshot([],[marker(1,0)],'');
  await assert.rejects(service.start({command:'batch',snapshot:s,protocol:1,capabilities:[]}),/更新|能力|协议/);
});
check('R19','URI alias ordering does not turn a valid reference into loss/new identity',()=>{
  const u1='https://zotero.org/users/1/items/AAAA1111',u2='https://zotero.org/users/1/items/BBBB2222';
  const before=snapshot([f(item(1,'A',[u1,u2]),'a',0)],[],ledger({1:{uris:[u1,u2],citations:['a']}}));
  const after=snapshot([f(item(1,'A',[u2,u1]),'a',0)],[],before.bindingData);
  assert.equal(live.verifyCommit(before,after,{expected:{}}).ok,true);
});
check('R20','bridge alias joins yield one reference or a blocking ambiguity',()=>{
  const u1='https://zotero.org/users/1/items/AAAA1111',u2='https://zotero.org/users/1/items/BBBB2222';
  const s=snapshot([f(item(1,'A',[u1]),'a',0),f(item(2,'A',[u2]),'b',10),f(item(1,'A',[u1,u2]),'joined',20)],[],'');
  const graph=live.documentState(s);
  assert.ok(graph.references.length===1||graph.issues.some(x=>x.blocking));
});
check('R21','valid embedded existing record does not need to resolve in the current library',async()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(root+'/addon/content/zotero-adapter.js','utf8'),context);
  const z={URI:{getURIItem:async uri=>uri===h.uris[0]?{id:h.id,deleted:false,isRegularItem:()=>true}:null,getItemURI:()=>h.uris[0]},Cite:{System:class{retrieveItem(){return h.itemData;}}}};
  const adapter=new context.ZBAdapter(z,{});
  await assert.doesNotReject(adapter.validateLiveMapping({1:a,8:h},['1','8'],{existing:{1:a}}));
});
check('R22','postflight preserves native suppress-author and author-only attributes',()=>{
  const before=snapshot([f({...a,'suppress-author':true,'author-only':true},'a',0)],[],ledger({1:ledgerEntry(a,['a'])}));
  const after=snapshot([f(a,'a',0)],[],before.bindingData);
  assert.equal(live.verifyCommit(before,after,{expected:{}}).ok,false);
});
