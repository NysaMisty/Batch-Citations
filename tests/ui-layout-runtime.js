/* SPDX-License-Identifier: MIT; isolated native geometry only. */
async function runUILayoutTests(win,config,check){
  const d=win.document,root=PathUtils.parent(config.result),workspace=d.getElementById('workspace'),main=d.querySelector('main');
  const original={width:win.outerWidth,height:win.outerHeight,page:workspace.selectedIndex},geometry=[];
  const delay=()=>Zotero.Promise.delay(180);
  if(config.captureUI)for(let i=0;i<120&&!d.getElementById('message').hidden;i++)await Zotero.Promise.delay(50);
  async function capture(name){const canvas=d.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;const ctx=canvas.getContext('2d');if(typeof ctx.drawWindow==='function')ctx.drawWindow(win,0,0,win.innerWidth,win.innerHeight,'white');else{const bitmap=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');ctx.drawImage(bitmap,0,0);bitmap.close();}await IOUtils.write(PathUtils.join(root,name+'.png'),Uint8Array.from(win.atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));}
  try{
    for(const [width,height]of [[1000,680],[760,600],[640,560]]){
      win.resizeTo(width+(win.outerWidth-win.innerWidth),height+(win.outerHeight-win.innerHeight));await delay();
      for(const page of [0,1]){
        workspace.selectedIndex=page;main.scrollTop=0;await delay();
        const panel=d.getElementById(page===0?'mapping-panel':'occurrences-panel'),list=d.querySelector(page===0?'#zbc-reference-workspace':'.preview'),r=list.getBoundingClientRect(),settings=d.querySelector('.settings-area').getBoundingClientRect(),footer=d.querySelector('.dialog-buttons').getBoundingClientRect();
        const controls=[...panel.querySelectorAll('.toolbar button,.toolbar summary')].filter(el=>el.getBoundingClientRect().width>0);
        main.scrollTop=main.scrollHeight;await delay();
        const contentReachable=d.querySelector('.settings-area').getBoundingClientRect().bottom<=main.getBoundingClientRect().bottom+1;
        main.scrollTop=0;await delay();
        const scrollAreas=page===0?[d.getElementById('zbc-picker-queue'),d.querySelector('#zotero-items-tree .virtualized-table-body')]:[list];
        const internalScroll=scrollAreas.every(el=>el&&['auto','scroll'].includes(win.getComputedStyle(el).overflowY));
        const fits=r.height>=120&&r.right<=win.innerWidth-15&&r.bottom<=settings.top+1&&footer.bottom<=win.innerHeight+1&&contentReachable&&internalScroll&&d.documentElement.scrollWidth<=win.innerWidth+1&&controls.every(el=>{const b=el.getBoundingClientRect();return b.left>=15&&b.right<=win.innerWidth-15;});
        const actionsFit=[...d.querySelectorAll('#zbc-picker-queue button')].every(el=>{const b=el.getBoundingClientRect(),q=d.getElementById('zbc-picker-queue').getBoundingClientRect();return !b.width||b.right<=q.right+1;});
        const tabs=workspace.querySelector('tabs').getBoundingClientRect(),centered=Math.abs((tabs.left+tabs.right-win.innerWidth)/2)<=1;
        const active=workspace.selectedPanel===panel||workspace.selectedIndex===page;
        const row={width:win.innerWidth,height:win.innerHeight,page,expanded:false,fits,actionsFit,centered,contentReachable,internalScroll,active,mainScroll:main.scrollHeight-main.clientHeight,list:r.toJSON(),settings:settings.toJSON(),footer:footer.toJSON()};
        geometry.push(row);
        if(!fits||!actionsFit||!centered||!active)throw new Error('Main layout: '+JSON.stringify(row));
        check('main '+width+'x'+height+' tab '+page+' fits with internal scrolling',fits&&actionsFit&&centered&&active);
        if(config.captureUI)await capture((config.capturePrefix?config.capturePrefix+'-':'')+'main-'+width+'-'+(page===0?'literature':'positions'));
      }
    }
    return geometry;
  }finally{workspace.selectedIndex=original.page;win.resizeTo(original.width,original.height);await delay();}
}
