const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const mapping=require('../addon/content/mapping.js');
function fixture(){
  const callbacks={},scheduled=[];
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.style={getPropertyValue:()=>'',setProperty(){}};this.dataset={};this.attributes={};this.classList={add(){},remove(){}};}
    appendChild(child){child.parentNode=this;this.children.push(child);return child;}
    replaceChildren(){this.children=[];}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);}
    setAttribute(k,v){this.attributes[k]=v;}
    removeAttribute(k){delete this.attributes[k];}
    addEventListener(event,callback){(this.listeners??={})[event]=callback;}
    removeEventListener(event){if(this.listeners)delete this.listeners[event];}
    closest(selector){return this.className?.split(' ').includes(selector.slice(1))?this:this.parentNode?.closest(selector);}
    dispatch(type,options={}){const event={type,target:this,...options,preventDefault(){},stopPropagation(){this.stopped=true;}};for(let current=this;current&&!event.stopped;current=current.parentNode){event.currentTarget=current;current.listeners?.[type]?.(event);}return event;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){const all=this.children.flatMap(c=>[c,...c.querySelectorAll('*')]);return selector==='*'?all:all.filter(c=>selector.startsWith('[data-number=')?c.dataset.number===selector.match(/"(.*?)"/)[1]:selector.startsWith('[data-action=')?c.dataset.action===selector.match(/"(.*?)"/)[1]:selector.startsWith('.')?c.className===selector.slice(1):false);}
    getBoundingClientRect(){return {top:0,bottom:100,width:400,height:100};}
    scrollIntoView(){}
    focus(){}
  }
  const body=new Element('body'),nodes={};
  for(const id of ['zbc-reference-workspace','workspace','occurrences-tab','zotero-items-tree-container','zotero-items-pane-content','zotero-items-tree','zotero-tb-search']){nodes[id]=new Element('div');body.appendChild(nodes[id]);}
  const document={body,getElementById:id=>nodes[id]||body.querySelectorAll('*').find(n=>n.id===id),createElementNS:(_,tag)=>new Element(tag),createXULElement:tag=>new Element(tag),querySelector:selector=>body.querySelector(selector)};
  const parent={document,closed:false,addEventListener(name,fn){callbacks[name]=fn;},removeEventListener(name){delete callbacks[name];},setTimeout(fn){scheduled.push(fn);return scheduled.length;},clearTimeout(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},openDialog(){throw new Error('An embedded picker must not open a window');}};
  let fail=false,rejectNative,resolveNative;
  const native={ready:new Promise((resolve,reject)=>{resolveNative=resolve;rejectNative=reject;}),itemsView:{getSelectedItems:()=>[],getRow:index=>({ref:{id:index+1}}),selection:{clearSelection(){native.itemsView.getSelectedItems=()=>[];native.onSelect?.();}}}};
  const context={ZBMapping:mapping,ZBLibrary:{mount(){if(fail)throw new Error('native startup failed');return native;}}};vm.createContext(context);
  for(const file of ['picker.js','zotero-adapter.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/content',file),'utf8'),context);
  return {parent,nodes,callbacks,native,rejectNative,resolveNative,setFail:value=>fail=value,api:new context.ZBAdapter({},parent),api2:new context.ZBAdapter({},parent)};
}

test('both entrances share one embedded draft and pending native view without opening a window',async()=>{
  const {api,api2,parent,nodes}=fixture();
  assert.equal(api.chooseItem,undefined);assert.equal(api.chooseItemsInOrder,undefined);
  const first=api.chooseReferences([1,3],{},[]),second=api2.chooseReferences([1,3],{},[],{focusNumber:3});
  assert.equal(first,second);assert.equal(api.activePicker,api2.activePicker);assert.equal(api.activePicker.window,parent);
  assert.equal(api.activePicker.ZBCPicker.session.currentNumber,3);assert.equal(nodes['zbc-reference-workspace'].hidden,false);
  api.activePicker.close();assert.equal(await first,null);assert.equal(api.activePicker,null);assert.equal(api2.activePicker,null);
  assert.equal(parent.closed,false);assert.equal(nodes['zbc-reference-workspace'].hidden,true);
  const third=api.chooseReferences([1,3],{},[],{focusNumber:1});assert.equal(api.activePicker.ZBCPicker.session.currentNumber,1);api.activePicker.close();assert.equal(await third,null);
});
test('parent closure and native startup failure release the embedded draft for retry',async()=>{
  const {api,parent,nodes,callbacks,setFail}=fixture();
  const pending=api.chooseReferences([1],{},[]);callbacks.unload({target:parent.document});assert.equal(await pending,null);assert.equal(nodes['zbc-reference-workspace'].hidden,true);
  setFail(true);await assert.rejects(api.chooseReferences([1],{},[]),/native startup failed/);assert.equal(api.activePicker,null);
  setFail(false);const retry=api.chooseReferences([1],{},[]);api.activePicker.close();assert.equal(await retry,null);
});
test('native initialization rejection cannot leave the parent busy or an orphan draft',async()=>{
  const {api,rejectNative,nodes}=fixture();const pending=api.chooseReferences([1],{},[]);
  rejectNative(new Error('library initialization failed'));await assert.rejects(pending,/library initialization failed/);
  assert.equal(api.activePicker,null);assert.equal(nodes['zbc-reference-workspace'].hidden,true);
});

const paper=n=>({id:n,uris:[`https://zotero.org/users/1/items/TEST000${n}`],itemData:{title:'Paper '+n}});
async function automatic(numbers=[1,3],initial={}){
  const f=fixture(),applied=[],states=[];let saved={...initial};
  f.api.itemRecord=item=>paper(item.id);f.api.Zotero.Items={get:id=>({id})};
  f.api.validateMapping=async records=>records;f.api.confirmDuplicateBindings=()=>true;
  f.pending=f.api.chooseReferences(numbers,initial,[],{persistent:true,onApply:changes=>{applied.push(changes);saved={...saved,...changes};for(const [n,item]of Object.entries(saved))if(!item)delete saved[n];return saved;},onChange:s=>states.push(s)});
  f.resolveNative();await Promise.resolve();
  const intent=()=>f.nodes['zotero-items-tree'].dispatch('keydown',{key:'Enter'});
  return {...f,applied,states,intent,get saved(){return saved;},handle:f.api.activePicker,select(id){f.native.itemsView.getSelectedItems=()=>[id];intent();return f.native.onSelect();},async close(){f.api.activePicker?.close();await f.pending;}};
}

test('native selection automatically saves one mapping without confirmation buttons or a dirty draft',async()=>{
  const f=await automatic();await f.select(1);
  assert.equal(f.saved[1].id,1);assert.equal(f.applied.length,1);assert.equal(f.handle.ZBCPicker.session.currentNumber,3);
  for(const id of ['zbc-add','zbc-apply','zbc-cancel'])assert.equal(f.parent.document.getElementById(id),undefined);
  assert.equal(f.api.activePicker,f.handle);assert.equal(f.states.at(-1).working,false);await f.close();
});

test('number title and row whitespace share one target handler without child tab stops',async()=>{
  const f=await automatic();
  const row=()=>f.parent.document.getElementById('zbc-picker-queue').querySelector('[data-number="3"]');
  for(const selector of ['.zbc-picker-number','.zbc-picker-title',null]){
    f.api.chooseReferences([1,3],f.saved,[],{focusNumber:1});
    const control=selector?row().querySelector(selector):row();control.dispatch('click');
    assert.equal(f.handle.ZBCPicker.session.currentNumber,3);assert.equal(row().attributes['aria-pressed'],'true');
    if(selector){assert.equal(control.tabIndex,undefined);assert.equal(control.listeners?.click,undefined);}
  }
  assert.equal(f.applied.length,0);await f.select(2);assert.equal(f.saved[3].id,2);await f.close();
});

test('row keyboard activation ignores independent action buttons and action clicks do not bubble',async()=>{
  const f=await automatic([1,3],{3:paper(3)});
  const row=()=>f.parent.document.getElementById('zbc-picker-queue').querySelector('[data-number="3"]');
  row().querySelector('[data-action="clear"]').dispatch('keydown',{key:'Enter'});
  assert.equal(f.handle.ZBCPicker.session.currentNumber,1);
  row().querySelector('[data-action="clear"]').dispatch('click');assert.equal(f.handle.ZBCPicker.session.currentNumber,1);
  row().dispatch('keydown',{key:' '});assert.equal(f.handle.ZBCPicker.session.currentNumber,3);
  assert.equal(f.applied.length,0);await f.close();
});

test('rapid selections capture their targets and serially commit without losing neighboring mappings',async()=>{
  const f=await automatic();let release;const first=new Promise(resolve=>release=resolve);let calls=0;
  f.api.validateMapping=async records=>{if(++calls===1)await first;return records;};
  const a=f.select(1);await Promise.resolve();f.api.chooseReferences([1,3],{},[],{focusNumber:3});const b=f.select(2);
  assert.equal(f.applied.length,0);release();await Promise.all([a,b]);
  assert.equal(f.saved[1].id,1);assert.equal(f.saved[3].id,2);assert.equal(f.applied.length,2);await f.close();
});

test('selection plus activation of the same item cannot advance twice or duplicate a mapping',async()=>{
  const f=await automatic();let release;
  f.api.validateMapping=records=>new Promise(resolve=>release=()=>resolve(records));
  const selected=f.select(1),activated=f.native.onActivate();await Promise.resolve();release();await Promise.all([selected,activated]);
  assert.deepEqual(Object.keys(f.saved),['1']);assert.equal(f.applied.length,1);await f.close();
});

test('single click only browses while double click commits once to its captured number',async()=>{
  const f=await automatic();let confirmations=0;f.api.confirmDuplicateBindings=()=>{confirmations++;return true;};
  const tree=f.nodes['zotero-items-tree'],nativeRow=new (tree.constructor)('div');nativeRow.className='row';nativeRow.id='zbc-reference-workspace-row-0';tree.appendChild(nativeRow);
  f.native.itemsView.getSelectedItems=()=>[1];nativeRow.dispatch('mousedown',{button:0,detail:1});nativeRow.dispatch('mouseup',{button:0,detail:1});nativeRow.dispatch('click',{button:0,detail:1});await f.native.onSelect();await f.handle.ZBCPicker.idle;
  assert.equal(f.applied.length,0,'single click and selection notifications only update the highlight');assert.deepEqual(Object.keys(f.saved),[]);
  nativeRow.dispatch('dblclick',{button:0,detail:2});await f.native.onActivate?.();await f.handle.ZBCPicker.idle;
  assert.equal(f.saved[1].id,1);assert.equal(f.applied.length,1);assert.equal(confirmations,1);assert.deepEqual(Object.keys(f.saved),['1']);
  assert.equal(f.saved[3],undefined,'activation after a double click cannot apply the same item to the next number');await f.close();
});

test('native refresh notifications cannot assign a reference without a new input gesture',async()=>{
  const f=await automatic();await f.select(1);
  f.native.itemsView.getSelectedItems=()=>[1];await f.native.onSelect();await f.handle.ZBCPicker.idle;
  assert.equal(f.applied.length,1);assert.equal(f.saved[3],undefined);
  f.native.itemsView.getSelectedItems=()=>[2];await f.native.onSelect();await f.handle.ZBCPicker.idle;
  assert.equal(f.applied.length,1);assert.equal(f.saved[3],undefined);
  await f.select(2);assert.equal(f.saved[3].id,2);await f.close();
});

test('unmatched typing and boundary navigation expire before a later automatic reselection',async()=>{
  for(const key of ['x','ArrowUp']){
    const f=await automatic();f.nodes['zotero-items-tree'].dispatch('keydown',{key});
    await Promise.resolve();
    f.native.itemsView.getSelectedItems=()=>[2];await f.native.onSelect();await f.handle.ZBCPicker.idle;
    assert.equal(f.applied.length,0);assert.equal(f.saved[1],undefined);await f.close();
  }
});

test('keyboard navigation only browses while Enter accepts the highlighted item',async()=>{
  const f=await automatic();f.nodes['zotero-items-tree'].dispatch('keydown',{key:'ArrowDown',repeat:true});
  f.native.itemsView.getSelectedItems=()=>[1];await Promise.resolve();await f.handle.ZBCPicker.idle;
  await f.native.onSelect();assert.equal(f.applied.length,0,'arrow navigation does not commit a mapping');
  f.nodes['zotero-items-tree'].dispatch('keydown',{key:'Enter',repeat:true});await Promise.resolve();await f.handle.ZBCPicker.idle;
  assert.equal(f.applied.length,0,'held Enter does not repeatedly confirm the advancing selection');
  f.nodes['zotero-items-tree'].dispatch('keydown',{key:'Enter'});await Promise.resolve();await f.handle.ZBCPicker.idle;
  assert.equal(f.saved[1].id,1);assert.equal(f.applied.length,1);
  f.native.itemsView.getSelectedItems=()=>[2];f.nodes['zotero-items-tree'].dispatch('keydown',{key:'Enter'});
  await Promise.resolve();await f.handle.ZBCPicker.idle;assert.equal(f.saved[3].id,2);assert.equal(f.applied.length,2);await f.close();
});

test('navigation immediately after enqueue preserves the explicitly chosen number',async()=>{
  const f=await automatic([1,3,8]);const selecting=f.select(1);
  f.api.chooseReferences([1,3,8],{},[],{focusNumber:8});await selecting;
  assert.equal(f.saved[1].id,1);assert.equal(f.handle.ZBCPicker.session.currentNumber,8);await f.close();
});

test('failed validation and failed mapping submission preserve applied data with visible errors and allow retry',async()=>{
  const f=await automatic([1,3],{1:paper(1)});f.api.chooseReferences([1,3],f.saved,[],{focusNumber:1});
  f.api.validateMapping=async()=>{throw Error('URI unavailable');};await f.select(2);
  assert.equal(f.handle.ZBCPicker.session.mapping[1].id,1);assert.equal(f.applied.length,0);assert.match(f.handle.ZBCPicker.error,/URI unavailable/);
  f.api.validateMapping=async records=>records;await f.select(2);assert.equal(f.saved[1].id,2);
  await f.close();
  const g=fixture();g.api.itemRecord=item=>paper(item.id);g.api.Zotero.Items={get:id=>({id})};g.api.validateMapping=async x=>x;g.api.confirmDuplicateBindings=()=>true;
  const pending=g.api.chooseReferences([1],{1:paper(1)},[],{persistent:true,onApply(){throw Error('commit failed');}});g.resolveNative();await Promise.resolve();
  g.nodes['zotero-items-tree'].dispatch('keydown',{key:'Enter'});g.native.itemsView.getSelectedItems=()=>[2];await g.native.onSelect();assert.equal(g.api.activePicker.ZBCPicker.session.mapping[1].id,1);assert.match(g.api.activePicker.ZBCPicker.error,/commit failed/);g.api.activePicker.close();await pending;
});

test('snapshot replacement invalidates delayed success and delayed rejection without overwriting current state',async()=>{
  for(const reject of [false,true]){
    const f=await automatic();let complete;
    f.api.validateMapping=records=>new Promise((resolve,fail)=>complete=()=>reject?fail(Error('obsolete')):resolve(records));
    const selecting=f.select(1);await Promise.resolve();f.handle.update({numbers:[3,8],mapping:{3:paper(3)}});const status=f.handle.ZBCPicker.error;
    complete();await selecting;assert.equal(f.applied.length,0);assert.deepEqual(Array.from(f.handle.ZBCPicker.session.numbers),[3,8]);assert.equal(f.handle.ZBCPicker.error,status);await f.close();
  }
});

test('closing during validation prevents stale confirmation and submission',async()=>{
  const f=await automatic();let complete,confirmations=0;
  f.api.validateMapping=records=>new Promise(resolve=>complete=()=>resolve(records));f.api.confirmDuplicateBindings=()=>{confirmations++;return true;};
  const selecting=f.select(1);await Promise.resolve();await f.close();complete();await selecting;
  assert.equal(f.applied.length,0);assert.equal(confirmations,0);
});

test('duplicate rejection and snapshot change during confirmation leave the old mapping intact',async()=>{
  const f=await automatic([1,3],{1:paper(1)});f.api.confirmDuplicateBindings=()=>false;await f.select(1);
  assert.deepEqual(Object.keys(f.saved),['1']);assert.match(f.handle.ZBCPicker.error,/取消/);
  f.api.confirmDuplicateBindings=()=>{f.handle.update({numbers:[8],mapping:{}});return true;};await f.select(1);
  assert.deepEqual(Object.keys(f.handle.ZBCPicker.session.mapping),[]);assert.equal(f.applied.length,0);await f.close();
});

test('clear and reorder immediately commit sparse changes while retaining unrelated numbered references',async()=>{
  const f=await automatic([1,3,8],{1:paper(1),3:paper(2),8:paper(3)});
  const row=n=>f.parent.document.getElementById('zbc-picker-queue').querySelector(`[data-number="${n}"]`);
  await row(3).querySelector('[data-action="clear"]').listeners.command();assert.equal(f.saved[3],undefined);assert.equal(f.saved[8].id,3);
  await row(8).querySelector('[data-action="up"]').listeners.command();assert.equal(f.saved[3].id,3);assert.equal(f.saved[8],undefined);assert.equal(f.saved[1].id,1);await f.close();
});

test('repeated same-number selection is idempotent and replacement keeps other references',async()=>{
  const f=await automatic([1,3],{1:paper(1),3:paper(3)});f.api.chooseReferences([1,3],f.saved,[],{focusNumber:1});await f.select(1);
  assert.equal(f.applied.length,0);await f.select(2);assert.equal(f.saved[1].id,2);assert.equal(f.saved[3].id,3);await f.close();
});

test('an empty queue stays browsable until an updated scan supplies actual numbers',async()=>{
  const f=await automatic([]);await f.select(1);assert.equal(f.applied.length,0);
  f.handle.update({numbers:[3,8],mapping:{}});await f.select(1);assert.equal(f.saved[3].id,1);await f.close();
});


test('reordering into an empty slot checks the complete patch including deletions',async()=>{
  const f=await automatic([1,3],{1:paper(1)});let received;
  f.api.confirmDuplicateBindings=(base,patch)=>{received=patch;return mapping.duplicateNumbers({...base,...patch},3,patch[3]).length===0;};
  const row=f.parent.document.getElementById('zbc-picker-queue').querySelector('[data-number="1"]');
  await row.querySelector('[data-action="down"]').listeners.command();
  assert.equal(received[1],null);assert.equal(f.saved[3].id,1);assert.equal(f.saved[1],undefined);await f.close();
});

test('clearing a completed slot targets it and permits reselecting the same item through external entry',async()=>{
  const f=await automatic([1]);await f.select(1);assert.equal(f.handle.ZBCPicker.session.currentNumber,null);
  f.api.chooseReferences([1],f.saved,[],{focusNumber:1});
  const row=f.parent.document.getElementById('zbc-picker-queue').querySelector('[data-number="1"]');
  await row.querySelector('[data-action="clear"]').listeners.command();assert.equal(f.handle.ZBCPicker.session.currentNumber,1);
  await f.select(1);assert.equal(f.saved[1].id,1);assert.equal(f.applied.length,3);await f.close();
});

test('clear and move retain their established target behavior unless the user explicitly navigates during validation',async()=>{
  const f=await automatic([1,3,8],{1:paper(1),3:paper(3),8:paper(8)});f.api.chooseReferences([1,3,8],f.saved,[],{focusNumber:1});
  const row=n=>f.parent.document.getElementById('zbc-picker-queue').querySelector(`[data-number="${n}"]`);
  await row(3).querySelector('[data-action="clear"]').listeners.command();assert.equal(f.handle.ZBCPicker.session.currentNumber,3);
  f.api.chooseReferences([1,3,8],f.saved,[],{focusNumber:1});await row(1).querySelector('[data-action="down"]').listeners.command();assert.equal(f.handle.ZBCPicker.session.currentNumber,3);
  let release;f.api.validateMapping=records=>new Promise(resolve=>release=()=>resolve(records));
  const moving=row(3).querySelector('[data-action="down"]').listeners.command();await Promise.resolve();
  f.api.chooseReferences([1,3,8],f.saved,[],{focusNumber:1});release();await moving;assert.equal(f.handle.ZBCPicker.session.currentNumber,1);await f.close();
});
