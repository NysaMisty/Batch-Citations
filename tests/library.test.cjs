const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('embedded native selection completes Zotero select listeners and releases both views with its parent',async()=>{
  let itemOptions,collectionOptions,selectEvents=0,itemDisposals=0,collectionDisposals=0,collectionSelectEvents=0;
  const row={id:'L1',ref:{libraryID:1},setSearch(){}};
  const items={collectionTreeRow:row,runListeners(event){if(event==='select')selectEvents++;},unregister(){itemDisposals++;}};
  const collections={selection:{count:1,focused:0},getRow:()=>row,async makeVisible(){},runListeners(event){if(event==='select')collectionSelectEvents++;},unregister(){collectionDisposals++;}};
  const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(){},removeEventListener(){}});return elements.get(id);}};
  const callbacks={},window={document,addEventListener(name,callback){callbacks[name]=callback;},removeEventListener(name){delete callbacks[name];},require(name){
    if(name==='zotero/collectionTree')return {async init(_,options){collectionOptions=options;return collections;}};
    if(name==='zotero/collectionViewItemTree')throw new Error('Zotero 7 uses ItemTree');
    return {async init(_,options){itemOptions=options;return items;}};
  }};
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../addon/content/library.js'),'utf8'),context);
  const adapter={window,Zotero:{UIProperties:{registerRoot(){}},getString:()=>'',updateQuickSearchBox(){},logError(error){throw error;}}};
  const view=context.ZBLibrary.mount(adapter);assert.equal(context.ZBLibrary.mount(adapter),view);await view.ready;
  const previous=collectionSelectEvents;await collectionOptions.onSelectionChange();assert.equal(collectionSelectEvents,previous+1,'unchanged collection reselection must release native notification waits');let changed=0;view.onSelect=()=>changed++;itemOptions.onSelectionChange();
  assert.equal(selectEvents,1,'Zotero 7 selectItems awaits this native completion event');assert.equal(changed,1);
  assert.equal(itemOptions.multiSelect,false);assert.equal(itemOptions.regularOnly,true);assert.equal(collectionOptions.hideSources.includes('trash'),true);
  callbacks.unload({target:document});assert.equal(itemDisposals,1);assert.equal(collectionDisposals,1);
});
