const {test}=require('node:test');
const assert=require('node:assert/strict');
const layout=require('../addon/content/picker-layout.js');
test('side layout minimum derives from both component widths and the actual gap',()=>{assert.equal(layout.effective('side',619,280,330,10),'stacked');assert.equal(layout.effective('side',620,280,330,10),'side');assert.equal(layout.effective('stacked',1500,280,330,10),'stacked');});
test('manual preference survives temporary fallback and remount without rebuilding native views',()=>{
  let saved='side',width=800,writes=0;const events={},attrs={};
  const buttons=['stacked','side'].map(name=>({id:'layout-'+name,setAttribute(k,v){attrs[this.id+':'+k]=v;},addEventListener(k,fn){this[k]=fn;},removeEventListener(){}}));
  const host={dataset:{}},queue={scrollTop:84,scrollLeft:0},nativeScroll={scrollTop:96,scrollLeft:12},notice={};
  const container={getBoundingClientRect:()=>({width}),querySelectorAll:()=>[nativeScroll]};
  const document={getElementById:id=>({'zotero-items-tree-container':container,'zbc-reference-workspace':host,'layout-stacked':buttons[0],'layout-side':buttons[1],'layout-notice':notice,'zbc-picker-queue':queue}[id])};
  const win={document,getComputedStyle:()=>({getPropertyValue:key=>({'--zbc-library-min-width':'280px','--zbc-queue-min-width':'330px','--zbc-layout-gap':'10px'}[key])}),requestAnimationFrame(fn){fn();return 1;},cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},addEventListener(k,fn){events[k]=fn;},removeEventListener(){}};
  const api={window:win,Zotero:{Prefs:{get:()=>saved,set:(key,value)=>{assert.equal(key,'batchCitations.pickerLayout');saved=value;writes++;}}}};
  const view=layout.mount(api);assert.equal(host.dataset.layout,'side');assert.equal(layout.mount(api),view);
  width=400;view.apply();assert.equal(host.dataset.layout,'stacked');assert.equal(saved,'side');assert.equal(notice.hidden,false);assert.equal(writes,0);
  width=800;view.apply();assert.equal(host.dataset.layout,'side');assert.equal(queue.scrollTop,84);assert.equal(nativeScroll.scrollLeft,12);
  for(let i=0;i<10;i++){buttons[i%2].click({currentTarget:buttons[i%2]});}assert.equal(saved,'side');assert.equal(writes,10);assert.equal(attrs['layout-side:aria-pressed'],'true');
  events.unload({target:document});assert.notEqual(layout.mount(api),view);assert.equal(layout.mount(api).preference,'side');
});
