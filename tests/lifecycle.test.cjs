const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('about:blank unload does not lose the live window; shutdown cleans up',async()=>{
  let unregister=false,closed=false,opens=0,focuses=0;const handlers={};
  const dialog={closed:false,addEventListener:(type,cb)=>handlers[type]=cb,removeEventListener:(type)=>delete handlers[type],focus:()=>focuses++,close:()=>closed=true};
  const registration={destruct:()=>unregister=true};
  const context={Components:{classes:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>registration})}},interfaces:{amIAddonManagerStartup:{}}},Services:{io:{newURI:x=>x}},Zotero:{initializationPromise:Promise.resolve(),getMainWindows:()=>[]}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../addon/bootstrap.js'),'utf8'),context);
  await context.startup({rootURI:'file:///test/'});
  const main={openDialog:()=>{opens++;return dialog;}};
  context.Zotero.BatchCitations.open(main);
  handlers.unload({target:{documentURI:'about:blank'}});
  context.Zotero.BatchCitations.open(main);
  assert.equal(opens,1);assert.equal(focuses,2);
  handlers.load({target:{documentURI:'chrome://zotero-batch-citations/content/dialog.xhtml'}});assert.equal(focuses,3);
  context.shutdown();assert.equal(closed,true);assert.equal(unregister,true);
});

test('completed and manually closed windows release their job association across repeated opens',async()=>{
  let opens=0;
  const registration={destruct(){}};
  const context={Components:{classes:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>registration})}},interfaces:{amIAddonManagerStartup:{}}},Services:{io:{newURI:x=>x},focus:{}},Zotero:{initializationPromise:Promise.resolve(),getMainWindows:()=>[]}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../addon/bootstrap.js'),'utf8'),context);await context.startup({rootURI:'file:///test/'});
  const owner=context.Zotero.BatchCitations;
  const main={openDialog(){opens++;const handlers={};return {document:{documentURI:'chrome://zotero-batch-citations/content/dialog.xhtml'},closed:false,windowState:2,restores:0,focuses:0,restore(){this.restores++;this.windowState=3;},focus(){this.focuses++;},addEventListener(t,fn){handlers[t]=fn;},removeEventListener(t){delete handlers[t];},close(){this.closed=true;handlers.unload?.({target:this.document});}};}};
  owner.liveService={jobs:new Map(),close(){},cancel(id){const job=this.jobs.get(id);if(job?.state==='pending')job.state='cancelled';}};
  for(let i=0;i<3;i++){
    const job={id:'job-'+i},window=owner.open(main,job);assert.equal(context.Services.focus.activeWindow,window);assert.equal(window.restores,1);
    assert.equal(owner.open(main,job),window);assert.equal(window.focuses,2);
    owner.liveService.jobs.set(job.id,{state:'pending'});owner.openWord(main);assert.equal(window.focuses,3);
    if(i===1)window.close();else owner.closeLive(job.id);
    assert.equal(owner.dialogs.size,0);assert.equal(owner.dialogJobs.size,0);
    assert.equal(owner.liveService.jobs.get(job.id).state,'cancelled');
  }
  assert.equal(opens,3);context.shutdown();
});

test('activation failure does not suppress focus; maximized windows remain maximized',async()=>{
  const registration={destruct(){}};
  const context={Components:{classes:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>registration})}},interfaces:{}},Services:{io:{newURI:x=>x},focus:{}},Zotero:{initializationPromise:Promise.resolve(),getMainWindows:()=>[],Utilities:{Internal:{activate(){throw new Error('native helper unavailable');}}},logError(){}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../addon/bootstrap.js'),'utf8'),context);await context.startup({rootURI:'file:///test/'});
  let focused=0,restored=0;
  const window={closed:false,windowState:1,restore(){restored++;},focus(){focused++;}};
  context.Zotero.BatchCitations.focus(window);
  assert.equal(focused,1);assert.equal(restored,0);assert.equal(context.Services.focus.activeWindow,window);
  window.windowState=2;context.Zotero.BatchCitations.focus(window);
  assert.equal(focused,2);assert.equal(restored,1);
  window.closed=true;context.Zotero.BatchCitations.focus(window);assert.equal(focused,2);
  context.shutdown();
});
