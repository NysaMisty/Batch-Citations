/* SPDX-License-Identifier: MIT */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBPickerLayout=api;})(globalThis,function(){
  'use strict';
  const views=new WeakMap(),key='batchCitations.pickerLayout';
  function effective(preference,available,libraryMin,queueMin,gap){return preference==='side'&&available>=libraryMin+queueMin+gap?'side':'stacked';}
  function mount(adapter){
    const win=adapter.window,cached=views.get(win);if(cached)return cached;
    const doc=win.document,container=doc.getElementById('zotero-items-tree-container'),host=doc.getElementById('zbc-reference-workspace');
    const buttons=['stacked','side'].map(name=>doc.getElementById('layout-'+name)),notice=doc.getElementById('layout-notice');
    let preference=adapter.Zotero.Prefs.get(key)==='side'?'side':'stacked',frame;
    function apply(){
      frame=null;const style=win.getComputedStyle(container),width=container.getBoundingClientRect().width;
      if(width<=0)return;
      const queueMin=parseFloat(style.getPropertyValue('--zbc-queue-min-width'));
      container.style?.setProperty('--zbc-effective-queue-min-width',queueMin+'px');
      const next=effective(preference,width,parseFloat(style.getPropertyValue('--zbc-library-min-width')),queueMin,parseFloat(style.getPropertyValue('--zbc-layout-gap')));
      const scrolling=[...container.querySelectorAll('.virtualized-table-body'),doc.getElementById('zbc-picker-queue')].filter(Boolean).map(element=>[element,element.scrollTop,element.scrollLeft]);
      if(host.dataset.layout!==next){host.dataset.layout=next;win.requestAnimationFrame(()=>{for(const [element,top,left]of scrolling){element.scrollTop=top;element.scrollLeft=left;}});}
      notice.hidden=preference!=='side'||next==='side';
      for(let i=0;i<buttons.length;i++)buttons[i].setAttribute('aria-pressed',String(preference===['stacked','side'][i]));
    }
    function schedule(){if(!frame)frame=win.requestAnimationFrame(apply);}
    function select(event){preference=event.currentTarget.id==='layout-side'?'side':'stacked';adapter.Zotero.Prefs.set(key,preference);apply();}
    for(const button of buttons)button.addEventListener('click',select);
    const observer=new win.ResizeObserver(schedule);observer.observe(container);win.addEventListener('resize',schedule);
    function dispose(event){if(event.target!==doc)return;observer.disconnect();win.cancelAnimationFrame(frame);win.removeEventListener('resize',schedule);win.removeEventListener('unload',dispose);for(const button of buttons)button.removeEventListener('click',select);views.delete(win);}
    win.addEventListener('unload',dispose);const view={apply,get preference(){return preference;}};views.set(win,view);apply();return view;
  }
  return {effective,mount};
});
