/* SPDX-License-Identifier: MIT; isolated native selection and layout regressions. */
async function runPickerTests(Zotero,win,items,config,check){
  const api=win.ZBTest.adapter,m=win.ZBTest.model,d=win.document;
  const until=async(fn,label)=>{for(let i=0;i<400;i++){if(await fn())return;await Zotero.Promise.delay(40);}throw Error('Picker timeout: '+label);};
  await until(()=>api.activePicker?.ZBCPicker.ready,'library');const p=api.activePicker,native=p.itemsView;
  const idle=async()=>{await p.ZBCPicker.idle;await until(()=>!m.mappingWorking,'mapping save');};
  const row=n=>[...d.querySelectorAll('#zbc-picker-queue li')].find(el=>Number(el.dataset.number)===n);
  const action=(n,name)=>row(n).querySelector(`[data-action="${name}"]`);
  const select=async id=>{await p.itemsView.selectItems([id]);d.getElementById('zotero-items-tree').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await Promise.resolve();await idle();};
  const focus=n=>row(n).querySelector('.zbc-picker-number').click();
  const reset=(numbers,mapping={},lockedNumbers=[])=>{m.mapping={...mapping};p.update({numbers,mapping,lockedNumbers});};
  async function duplicate(operation,proceed=false){let observed;const timer=Zotero.getMainWindow().setInterval(()=>{const windows=Services.ww.getWindowEnumerator();while(windows.hasMoreElements()){const modal=windows.getNext();if(modal.args?.title!=='确认重复绑定'||!modal.Dialog)continue;const dialog=modal.document.querySelector('dialog');observed={text:modal.args.text,defaultButton:dialog.defaultButton,defaultButtonNum:modal.args.defaultButtonNum};if(proceed)dialog.acceptDialog();else dialog.cancelDialog();}},25);try{await operation();await until(()=>observed,'duplicate prompt');return observed;}finally{Zotero.getMainWindow().clearInterval(timer);}}
  function drag(from,to,after=false){const source=row(from),target=row(to),handle=source.querySelector('.zbc-picker-handle'),rect=target.getBoundingClientRect(),transfer=new win.DataTransfer();handle.dispatchEvent(new win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));const over=new win.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:after?rect.bottom-2:rect.top+2});target.dispatchEvent(over);const lines=d.querySelectorAll('#zbc-picker-queue [data-drop]').length,visible=!d.getElementById('zbc-drop-indicator').hidden;target.dispatchEvent(new win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:after?rect.bottom-2:rect.top+2}));handle.dispatchEvent(new win.DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));return over.defaultPrevented&&lines===1&&visible;}

  reset(m.archive.scan.numbers);focus(1);
  check('opening the main window directly exposes one native library and numbered queue',!d.getElementById('batch-pick')&&!d.getElementById('zbc-reference-workspace').hidden&&p.window===win&&d.querySelectorAll('#zbc-picker-panel').length===1);
  check('number details area is removed while the numbered queue remains',!d.getElementById('mapping-details')&&!!d.getElementById('zbc-picker-queue'));
  d.getElementById('workspace').selectedIndex=1;await Zotero.Promise.delay(100);
  const positions=d.querySelector('.preview').getBoundingClientRect();
  // XUL decks keep inactive panel geometry; verify the active hit target.
  check('citation position tab remains separate and usable',d.getElementById('occurrences-tab').label==='引用位置'&&positions.height>100&&d.getElementById('workspace').selectedPanel.id==='occurrences-panel'&&d.getElementById('occurrences-panel').contains(d.elementFromPoint(positions.x+positions.width/2,positions.y+positions.height/2)));
  d.getElementById('workspace').selectedIndex=0;await Zotero.Promise.delay(100);
  check('redundant number selector and three confirmation buttons are absent',!d.querySelector('#zbc-reference-workspace select')&&!['zbc-add','zbc-apply','zbc-cancel'].some(id=>d.getElementById(id))&&!d.querySelector('.zbc-picker-buttons'));
  await until(()=>p.itemsView.getRowIndexByID(items[0].id)!==false,'native test row');
  p.itemsView.ensureRowIsVisible(p.itemsView.getRowIndexByID(items[0].id));await Zotero.Promise.delay(150);
  const nativeRow=[...d.querySelectorAll('#zotero-items-tree .row')].find(el=>Number(el.id.match(/-row-(\d+)$/)?.[1])===p.itemsView.getRowIndexByID(items[0].id));
  if(!nativeRow)throw Error('Native mouse test row is not visible: '+JSON.stringify([...d.querySelectorAll('#zotero-items-tree [role="treeitem"]')].map(el=>({id:el.id,className:el.className}))));
  nativeRow.dispatchEvent(new win.MouseEvent('mousedown',{button:0,detail:1,bubbles:true}));await idle();
  nativeRow.dispatchEvent(new win.MouseEvent('mouseup',{button:0,detail:1,bubbles:true}));nativeRow.dispatchEvent(new win.MouseEvent('click',{button:0,detail:1,bubbles:true}));await idle();
  check('native single click highlights a reference without applying a mapping',!m.mapping[1]&&!m.mapping[2]);
  nativeRow.dispatchEvent(new win.MouseEvent('dblclick',{button:0,detail:2,bubbles:true}));await idle();await Zotero.Promise.delay(150);
  check('native double click immediately binds the selected reference once',Object.keys(m.mapping).length===1&&m.mapping[1]?.id===items[0].id&&!m.mapping[2]);
  check('native double click saves the current number without a draft',m.mapping[1]?.id===items[0].id&&p.ZBCPicker.session.currentNumber===2&&!m.mappingWorking);
  check('mapping selection does not select or write document positions',m.selected.size===0&&d.getElementById('convert').disabled);
  const beforeUnmatched=JSON.stringify(m.mapping);
  d.getElementById('zotero-items-tree').dispatchEvent(new win.KeyboardEvent('keydown',{key:'¤',bubbles:true}));await Zotero.Promise.delay(120);
  await p.itemsView.selectItems([items[1].id]);await idle();
  check('unmatched keyboard input expires before automatic native reselection',JSON.stringify(m.mapping)===beforeUnmatched);
  d.getElementById('zbc-skip').click();await select(items[2].id);
  check('partial immediate mapping keeps untouched numbers and the native library',!m.mapping[2]&&m.mapping[3]?.id===items[2].id&&p.itemsView===native);
  action(3,'clear').click();await idle();check('explicit clear immediately updates its numbered slot',!m.mapping[3]&&m.mapping[1]?.id===items[0].id);
  focus(2);await select(items[1].id);focus(2);const target=p.ZBCPicker.session.currentNumber;row(2).querySelector('.zbc-picker-title').click();
  row(2).click();check('number title and whitespace share the selected row feedback',target===2&&p.ZBCPicker.session.currentNumber===2&&row(2).getAttribute('aria-pressed')==='true'&&!row(2).querySelector('.zbc-picker-title').hasAttribute('tabindex'));
  const declined=await duplicate(()=>select(items[0].id));
  check('duplicate reuse requires explicit confirmation with cancel as default',declined.defaultButton==='cancel'&&declined.defaultButtonNum===1&&declined.text.includes('[1]')&&declined.text.includes('[2]')&&m.mapping[2].id===items[1].id);
  focus(3);await select(items[2].id);
  action(1,'down').click();await idle();check('down immediately reorders original numbered slots',m.mapping[1].id===items[1].id&&m.mapping[2].id===items[0].id);
  action(2,'up').click();await idle();check('up immediately restores original numbered slots',m.mapping[1].id===items[0].id);
  const dragged=drag(3,1);await idle();check('drag reorder shows one insertion line',dragged&&m.mapping[1].id===items[2].id);
  const unchanged=JSON.stringify(m.mapping);const stationary=drag(1,1);await idle();check('dropping onto the original source is legal and unchanged',stationary&&JSON.stringify(m.mapping)===unchanged);
  action(2,'clear').click();await idle();focus(1);await select(items[0].id);
  check('replacement preserves every untouched mapping',m.mapping[1].id===items[0].id&&!m.mapping[2]&&m.mapping[3].id===items[1].id);
  const before=JSON.stringify(m.mapping),validate=api.validateMapping;api.validateMapping=async()=>{throw Error('test URI unavailable');};focus(2);await select(items[2].id);api.validateMapping=validate;
  check('automatic application failure reports an error and preserves applied mapping',JSON.stringify(m.mapping)===before&&p.ZBCPicker.error.includes('test URI unavailable')&&!m.mappingWorking);
  await select(items[2].id);
  check('successful retry clears the prior automatic mapping error',m.mapping[2]?.id===items[2].id&&!p.ZBCPicker.error.includes('test URI unavailable')&&!m.mappingWorking);
  // Reference markers use exactly the same target as the numbered queue.
  d.querySelector('#occurrences [data-target-number="2"]').click();check('occurrence number targets the shared native picker',p.ZBCPicker.session.currentNumber===2&&m.focusNumber===2);
  const originalSize={width:win.outerWidth,height:win.outerHeight},largeGeometry=[];
  const browseItems=[];await Zotero.DB.executeTransaction(async()=>{for(let i=1;i<=65;i++){const item=new Zotero.Item('book');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title','Synthetic native '+String(i).padStart(3,'0')+' · '+('文献标题完整保留用于悬停核对 '.repeat(12)));await item.save({skipSelect:true});browseItems.push(item);}});
  const largeMap=Object.fromEntries(browseItems.slice(0,60).map((item,i)=>[i+1,api.itemRecord(item)]));
  reset(Array.from({length:60},(_,i)=>i+1),largeMap);focus(8);
  const expected=JSON.stringify(m.mapping),targetNumber=p.ZBCPicker.session.currentNumber,view=p.itemsView;
  const search=d.getElementById('zotero-tb-search'),input=d.getElementById('zotero-tb-search-textbox');input.value='Synthetic';search.dispatchEvent(new win.Event('command',{bubbles:true}));await Zotero.Promise.delay(250);
  await until(()=>view.rowCount>=65,'large library');
  const filtered=view.rowCount,titleColumn=view._getColumns().findIndex(column=>column.dataKey==='title');await view._handleColumnSort(titleColumn,-1);await Zotero.Promise.delay(150);
  const sorted=JSON.stringify(view.getSortedItems(true)),filterRow=view.collectionTreeRows?.[0]||view.collectionTreeRow;
  const darkPref='ui.systemUsesDarkTheme',hadDark=Services.prefs.prefHasUserValue(darkPref),oldDark=hadDark?Services.prefs.getIntPref(darkPref):null;
  try{for(const dark of [0,1]){Services.prefs.setIntPref(darkPref,dark);for(const [width,height]of [[1800,820],[1000,680],[640,560]])for(const layout of ['stacked','side']){
    win.resizeTo(width+(win.outerWidth-win.innerWidth),height+(win.outerHeight-win.innerHeight));d.getElementById('layout-'+layout).click();await Zotero.Promise.delay(220);
    const q=d.getElementById('zbc-picker-queue'),nativeBounds=d.getElementById('zotero-items-pane-content').getBoundingClientRect(),queue=q.getBoundingClientRect(),panel=d.getElementById('zbc-picker-panel').getBoundingClientRect(),header=d.querySelector('.zbc-picker-header').getBoundingClientRect(),actual=d.getElementById('zbc-reference-workspace').dataset.layout,main=d.querySelector('main');
    const aligned=actual==='side'?panel.left>=nativeBounds.right-1:panel.top>=nativeBounds.bottom-1;
    const fits=(width<720||Math.max(queue.bottom,nativeBounds.bottom)<=d.querySelector('.dialog-buttons').getBoundingClientRect().top)&&aligned&&nativeBounds.height>=100&&queue.height>=65&&d.documentElement.scrollWidth<=win.innerWidth+1&&q.scrollWidth<=q.clientWidth+1;
    const rows=[...q.children],rowHeight=rows[0].getBoundingClientRect().height,visibleRows=Math.floor(queue.height/rowHeight);
    const actionsFit=rows.every(el=>[...el.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.width>=24&&b.height>=24&&b.right<=queue.right+1;}));
    const heading=d.getElementById('zbc-picker-heading').getBoundingClientRect(),skip=d.getElementById('zbc-skip').getBoundingClientRect(),sameLine=Math.abs((heading.top+heading.bottom-skip.top-skip.bottom)/2)<2;
    largeGeometry.push({width:win.innerWidth,height:win.innerHeight,layout,actual,scheme:dark?'dark':'light',fits,actionsFit,aligned,sameLine,visibleRows,rowHeight,queue:queue.toJSON(),tree:nativeBounds.toJSON(),header:header.toJSON(),devicePixelRatio:win.devicePixelRatio,mainScroll:main.scrollHeight-main.clientHeight});
    if(!fits||!actionsFit||!sameLine)throw Error('Selection layout: '+JSON.stringify(largeGeometry.at(-1)));
    check('layout '+layout+' '+width+' '+dark+' keeps independent lists usable',true);
    check('layout preserves native search sorting target and applied mappings '+layout+' '+width+' '+dark,p.itemsView===view&&input.value==='Synthetic'&&view.rowCount===filtered&&JSON.stringify(view.getSortedItems(true))===sorted&&(view.collectionTreeRows?.[0]||view.collectionTreeRow)===filterRow&&JSON.stringify(m.mapping)===expected&&p.ZBCPicker.session.currentNumber===targetNumber);
    if(config.captureUI){const canvas=d.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;const ctx=canvas.getContext('2d');if(typeof ctx.drawWindow==='function')ctx.drawWindow(win,0,0,win.innerWidth,win.innerHeight,'white');else{const bitmap=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');ctx.drawImage(bitmap,0,0);bitmap.close();}await IOUtils.write(PathUtils.join(PathUtils.parent(config.result),'picker-'+layout+'-'+width+'-'+(dark?'dark':'light')+'.png'),Uint8Array.from(win.atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));}
  }}}finally{if(hadDark)Services.prefs.setIntPref(darkPref,oldDark);else Services.prefs.clearUserPref(darkPref);win.resizeTo(originalSize.width,originalSize.height);}
  check('long titles remain single line with complete tooltip',d.querySelector('.zbc-picker-title').title.includes('文献标题完整保留')&&win.getComputedStyle(d.querySelector('.zbc-picker-title')).textOverflow==='ellipsis');
  const boundaryGeometry=[],manyNumbers=[...Array.from({length:1999},(_,i)=>i+1),99999],manyMap=Object.fromEntries(manyNumbers.map((n,i)=>[n,api.itemRecord(browseItems[i%browseItems.length])]));reset(manyNumbers,manyMap);
  for(const current of [1,99999]){focus(current);for(const width of [760,1000,1800]){win.resizeTo(width+(win.outerWidth-win.innerWidth),680+(win.outerHeight-win.innerHeight));d.getElementById('layout-side').click();await Zotero.Promise.delay(180);const q=d.getElementById('zbc-picker-queue'),bounds=q.getBoundingClientRect(),panel=d.getElementById('zbc-picker-panel').getBoundingClientRect(),skip=d.getElementById('zbc-skip').getBoundingClientRect();const fits=bounds.width>0&&q.scrollWidth<=q.clientWidth+1&&skip.right<=panel.right+1;boundaryGeometry.push({width,current,fits});check('large numbered queue fits '+current+' '+width,fits);}}
  reset(Array.from({length:60},(_,i)=>i+1),largeMap);win.resizeTo(1800+(win.outerWidth-win.innerWidth),820+(win.outerHeight-win.innerHeight));d.getElementById('layout-side').click();await Zotero.Promise.delay(200);
  const q=d.getElementById('zbc-picker-queue'),nativeScroll=d.querySelector('#zotero-items-tree .virtualized-table-body');q.scrollTop=45;nativeScroll.scrollTop=64;await Zotero.Promise.delay(100);const scrolls=[q.scrollTop,nativeScroll.scrollTop];
  for(let i=0;i<8;i++){d.getElementById('layout-'+(i%2?'side':'stacked')).click();await Zotero.Promise.delay(80);}
  check('repeated layout switches retain both scroll positions and native sorting',Math.abs(q.scrollTop-scrolls[0])<2&&Math.abs(nativeScroll.scrollTop-scrolls[1])<2&&JSON.stringify(view.getSortedItems(true))===sorted);
  win.resizeTo(640+(win.outerWidth-win.innerWidth),560+(win.outerHeight-win.innerHeight));await Zotero.Promise.delay(150);const fallback=d.getElementById('zbc-reference-workspace').dataset.layout==='stacked';win.resizeTo(1800+(win.outerWidth-win.innerWidth),820+(win.outerHeight-win.innerHeight));await Zotero.Promise.delay(150);
  check('resize fallback restores side preference automatically without another click',fallback&&d.getElementById('zbc-reference-workspace').dataset.layout==='side'&&Zotero.Prefs.get('batchCitations.pickerLayout')==='side');
  input.value='';search.dispatchEvent(new win.Event('command',{bubbles:true}));
  reset([1,3,8],{1:api.itemRecord(items[0]),3:api.itemRecord(items[1]),8:api.itemRecord(items[2])},[3]);
  check('locked binding is immutable and cannot be crossed by sorting',action(3,'clear').disabled&&action(1,'down').disabled&&action(8,'up').disabled&&!p.ZBCPicker.session.canMove(1,8));
  reset([]);d.getElementById('layout-side').click();d.getElementById('layout-stacked').click();check('empty queue can switch layouts without resetting native browsing',p.ZBCPicker.session.currentNumber===null&&p.itemsView===native);
  win.ZBTest.refresh();d.getElementById('layout-side').click();
  const temp=Zotero.getMainWindow().openDialog('chrome://zotero-batch-citations/content/dialog.xhtml','zbc-layout-reopen-test','chrome,dialog=no,resizable,width=1000,height=700',{wrappedJSObject:{Zotero}});
  try{await until(()=>temp.ZBTest?.adapter.activePicker?.ZBCPicker.ready&&!temp.ZBTest.model.busy,'reopened UI');check('new main window restores layout preference without document or export state',temp.document.getElementById('layout-side').getAttribute('aria-pressed')==='true'&&!temp.document.getElementById('zbc-reference-workspace').hidden);}finally{temp.close();}
  d.getElementById('layout-stacked').click();await win.ZBTest.loadDocument(config.input);win.ZBTest.refresh();
  return {largeGeometry,boundaryGeometry,persistent:true,layoutPreferenceKey:'extensions.zotero.batchCitations.pickerLayout',allLayoutsRetainMapping:true};
}
