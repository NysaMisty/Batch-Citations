const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const live=require('../addon/content/live-core.js');
const source=fs.readFileSync(require.resolve('../addon/content/dialog.js'),'utf8');

function fixture(){
  const job={state:'pending',snapshot:{fingerprint:'initial',path:'test.docx',name:'test.docx'},scan:{numbers:[1,3],occurrences:[]},bindings:{mapping:{},untracked:[]}};
  const model={liveJob:job,mapping:{},selected:new Set(),labelResolutions:{},initialized:true};
  const resets=[];let revision=0;
  const context={model,ZBLiveCore:live,$:()=>({}),renderMapping(){},renderOccurrences(){},updateControls(){},invalidatePreview(){},
    referenceState:()=>({numbers:model.archive?.scan.numbers||[]}),adapter:{activePicker:{update(state){revision++;resets.push(state.numbers);}}},
    ensureReferences(options){assert.equal(options.reset,true);revision++;resets.push(model.archive.scan.numbers);}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function applyLiveSnapshot()'),source.indexOf('async function loadDocument(')),context);
  return {model,job,context,resets,get revision(){return revision;}};
}

test('initial live snapshot synchronizes the already mounted empty draft',()=>{
  const f=fixture();f.context.applyLiveSnapshot();
  assert.equal(f.revision,1);assert.deepEqual(f.resets[0],[1,3]);
});

test('idle and busy live snapshot events invalidate any pending picker application',()=>{
  const f=fixture();f.context.applyLiveSnapshot();const first=f.revision;
  f.job.snapshot.fingerprint='changed';f.job.scan={numbers:[3,8],occurrences:[]};
  f.context.jobChanged({type:'snapshot',job:f.job});
  assert.equal(f.revision,first+1);assert.deepEqual(f.resets.at(-1),[3,8]);
  f.model.busy=true;f.context.jobChanged({type:'snapshot',job:f.job});
  assert.equal(f.revision,first+2);assert.equal(f.model.pendingSnapshot,true);
});

test('confirming a number source synchronizes the persistent queue and waits for pending mapping saves',async()=>{
  const a={uris:['a']},b={uris:['b']},model={mapping:{1:a},labelResolutions:{},fingerprint:'original'};let synchronized,prompts=0;
  const context={model,window:{},Services:{prompt:{select(){prompts++;return true;}}},adapter:{confirmDuplicateBindings:()=>true},assertCurrentScan(){},invalidatePreview(){},renderMapping(){},ensureReferences(){synchronized=model.mapping[1];}};
  vm.createContext(context);const start=source.indexOf('async function confirmNumberSource(');
  assert.notEqual(start,-1);vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),context);
  await context.confirmNumberSource(1,{historical:a,current:b});assert.equal(model.mapping[1],b);assert.equal(synchronized,b);
  model.mappingWorking=true;await assert.rejects(context.confirmNumberSource(1,{historical:a,current:b}),/正在保存/);assert.equal(prompts,1);
});


test('parent mapping submission rolls back if refreshing related views fails',()=>{
  const original={1:{id:1}},model={mapping:original,busy:false,bindings:{mapping:{}}};let renders=0;
  const context={model,disposed:false,applyMappingChanges:changes=>model.mapping={...model.mapping,...changes},invalidatePreview(){},rememberReferences(){},renderMapping(){if(++renders===1)throw Error('view refresh failed');}};
  vm.createContext(context);const start=source.indexOf('function commitReferenceChanges(');
  assert.notEqual(start,-1);vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),context);
  assert.throws(()=>context.commitReferenceChanges({3:{id:3}},{isCurrent:()=>true}),/view refresh failed/);
  assert.equal(model.mapping,original);assert.equal(renders,2);
  assert.throws(()=>context.commitReferenceChanges({3:{id:3}},{isCurrent:()=>false}),/编号已变化/);assert.equal(model.mapping,original);
});

test('removing details keeps source confirmation reachable for an ambiguous locked number',async()=>{
  const controls=[],body={replaceChildren(){},appendChild(){}},model={archive:{scan:{occurrences:[{key:'one',numbers:[1],raw:'[1]',context:'test',paragraph:0}]}},mapping:{},selected:new Set()};
  const context={model,$:()=>body,reconcileSelection(){},selectionOptions:()=>({}),referenceState:()=>({lockedNumbers:[1]}),ambiguousNumber:()=>({historical:{},current:{}}),ZBSelection:{state:()=>({selectable:false,reason:'确认来源'})},node:()=>({children:[],appendChild(child){this.children.push(child);},addEventListener(){},setAttribute(){},dataset:{}}),targetButton(n){controls.push(n);return {};}};
  vm.createContext(context);const start=source.indexOf('function renderOccurrences(');vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),context);context.renderOccurrences();
  assert.deepEqual(controls,[1]);
  let confirmed=0,picked=0;const listeners={},c={model:{labelResolutions:{}},node:()=>({dataset:{},addEventListener(type,fn){listeners[type]=fn;}}),ambiguousNumber:()=>({}),action:fn=>fn(),confirmNumberSource:async()=>{confirmed++;c.model.labelResolutions[1]={};},referenceState:()=>({lockedNumbers:[1]}),chooseReferences(){picked++;}};
  vm.createContext(c);const buttonStart=source.indexOf('function targetButton(');vm.runInContext(source.slice(buttonStart,source.indexOf('\nfunction ',buttonStart+1)),c);c.targetButton(1,'[1]');
  await listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(confirmed,1);assert.equal(picked,0);
});
