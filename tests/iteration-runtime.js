/* SPDX-License-Identifier: MIT; isolated runtime tests only. */
async function runIterationControl(Zotero,items,root,command){
  if(command.themeProbe){
    const window=Zotero.getMainWindow(),name='ui.systemUsesDarkTheme',had=Services.prefs.prefHasUserValue(name),old=had?Services.prefs.getIntPref(name):null,samples=[];
    try{for(const value of [0,1]){Services.prefs.setIntPref(name,value);await Zotero.Promise.delay(250);const style=window.getComputedStyle(window.document.documentElement);samples.push({value,dark:window.matchMedia('(prefers-color-scheme: dark)').matches,fill:style.getPropertyValue('--fill-primary'),background:style.getPropertyValue('--color-background')});}}
    finally{if(had)Services.prefs.setIntPref(name,old);else Services.prefs.clearUserPref(name);}
    return {ok:true,samples};
  }
  if(command.evidence){
    const job=[...Zotero.BatchCitations.liveService.jobs.values()].at(-1);
    for(const [name,value]of Object.entries({before:job.snapshot,after:job.finalSnapshot,plan:job.plan}))if(value)await IOUtils.writeUTF8(PathUtils.join(root,'failure-'+name+'.json'),JSON.stringify(value));
    return {ok:true,state:job.state,beforeSegments:job.snapshot.bodySegments?.length,afterSegments:job.finalSnapshot?.bodySegments?.length,issues:job.verificationIssues};
  }
  const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending');
  if(!win)throw new Error('No pending iteration test window');
  const m=win.ZBTest.model,d=win.document,api=win.ZBTest.adapter,job=m.liveJob;
  if(command.layout){
    Services.scriptloader.loadSubScript(Services.io.newFileURI(Zotero.File.pathToFile(command.layoutScript)).spec);
    const checks=[],oldError=job.checkError;
    try{
      if(command.errorState){job.checkError='测试：当前文档快照暂时不可用，请返回 Word 核对。'.repeat(8);win.ZBTest.refresh();if(!d.getElementById('convert').disabled)throw new Error('Error state allowed a commit');}
      const geometry=await runUILayoutTests(win,{result:PathUtils.join(root,'result.json'),captureUI:true,capturePrefix:command.prefix||'live-preview'},(name,value)=>{if(!value)throw new Error(name);checks.push(name);});
      return {ok:true,checks,geometry};
    }finally{if(command.errorState){job.checkError=oldError;win.ZBTest.refresh();}}
  }
  if(command.action==='iteration-inspect')return {ok:true,numbers:job.scan.numbers,occurrences:job.scan.occurrences,scanWarnings:job.snapshot.scanWarnings||[],
    selected:[...m.selected],fields:job.snapshot.citationFields.length,fingerprint:job.snapshot.fingerprint,issues:win.currentIssues(),busy:m.busy,
    mappingIDs:Object.fromEntries(Object.entries(m.mapping).map(([n,item])=>[n,item.id])),pickerNumbers:api.activePicker?.ZBCPicker.session.numbers,pickerReady:api.activePicker?.ZBCPicker.ready};
  if(command.action==='iteration-pick-reference'){
    const picker=api.activePicker,number=command.number,item=items[command.itemIndex||0];
    api.chooseReferences(picker.ZBCPicker.session.numbers,m.mapping,[],{focusNumber:number});
    await picker.itemsView.selectItems([item.id]);d.getElementById('zotero-items-tree').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await Promise.resolve();await picker.ZBCPicker.idle;
    if(m.mapping[number]?.id!==item.id)throw new Error('Immediate real Word mapping failed: '+picker.ZBCPicker.error);
    return {ok:true,itemID:item.id,mappingIDs:Object.fromEntries(Object.entries(m.mapping).map(([n,record])=>[n,record.id]))};
  }
  if(command.action!=='iteration-submit')throw new Error('Unknown iteration control');
  while(items.length<60){const item=new Zotero.Item('book');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title','Synthetic application reference '+(items.length+1));item.setField('date','2024');item.setField('publisher','Test Press');await item.saveTx();items.push(item);}
  m.mapping={...m.bindings.mapping};
  for(const n of job.scan.numbers){const index=command.mapping?.[n]||n;m.mapping[n]=api.itemRecord(items[index-1]);}
  m.selected=new Set(job.scan.occurrences.filter(o=>o.eligible).map(o=>o.key));
  if(!win.currentDocumentSettings()){d.getElementById('style').value='http://www.zotero.org/styles/ieee';d.getElementById('locale').value='en-US';}
  win.ZBTest.refresh();
  if(d.getElementById('convert').disabled&&!command.pickerScenario&&!command.singlePicker)throw new Error('Iteration convert disabled: '+d.getElementById('status-summary').textContent+' '+d.getElementById('selection').textContent);
  const referenceStatuses=Object.entries(m.mapping).map(([number,record])=>({referenceId:record.uris?.[0],inputNumber:number,title:record.itemData?.title,status:win.ZBReferenceStatus.format(win.ZBReferenceStatus.count(record,Number(number),m.bindings.state,m.archive.scan,m.mapping))}));
  let pickerCount=0,pickerEvidence=null;
  if(command.pickerScenario||command.singlePicker){
    const until=async(fn,label)=>{const start=Date.now();while(!fn()){if(Date.now()-start>20000)throw new Error('Real Word picker: '+label);await Zotero.Promise.delay(40);}};
    const opened=async()=>{await until(()=>api.activePicker?.ZBCPicker?.ready,'open');return api.activePicker;};
    const select=async(picker,item)=>{const number=picker.ZBCPicker.session.currentNumber;await picker.itemsView.selectItems([item.id]);d.getElementById('zotero-items-tree').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await Promise.resolve();await picker.ZBCPicker.idle;await until(()=>!m.mappingWorking,'automatic save');if(m.mapping[number]?.id!==item.id)throw new Error('Real Word automatic mapping failed: '+picker.ZBCPicker.error);};
    m.mapping={...m.bindings.mapping};m.selected.clear();win.ZBTest.refresh();
    const protectedBefore=JSON.stringify(m.bindings.mapping);
    if(command.pickerScenario){
      const picker=await opened();
      await select(picker,items[0]);picker.document.getElementById('zbc-skip').click();
      let confirmation=null;
      const timerWindow=Zotero.getMainWindow(),timer=timerWindow.setInterval(()=>{
        const windows=Services.ww.getWindowEnumerator();
        while(windows.hasMoreElements()){
          const modal=windows.getNext();
          if(!modal.document?.documentURI.includes('commonDialog')||modal.args?.title!=='确认重复绑定'||!modal.Dialog)continue;
          const dialog=modal.document.querySelector('dialog');confirmation={text:modal.args.text,defaultButton:dialog.defaultButton,defaultButtonNum:modal.args.defaultButtonNum};dialog.acceptDialog();
        }
      },25);
      try{await select(picker,items[0]);}finally{timerWindow.clearInterval(timer);}
      if(!confirmation||confirmation.defaultButton!=='cancel'||confirmation.defaultButtonNum!==1||!confirmation.text.includes('[1]')||!confirmation.text.includes('[3]'))throw new Error('Real Word duplicate confirmation was not explicit and cancel-default');
      if(m.mapping[1]?.id!==items[0].id||m.mapping[3]?.id!==items[0].id||m.mapping[2])throw new Error('Real Word partial duplicate application changed an unselected number');
      pickerEvidence={mode:'partial-duplicate',confirmation,appliedLabels:Object.keys(m.mapping)};
    }else{
      const target=d.querySelector('#occurrences [data-target-number="2"]');if(!target)throw new Error('Real Word individual picker target was not rendered');target.click();const picker=await opened();
      if(picker.ZBCPicker.session.currentNumber!==2||picker.ZBCPicker.session.numbers.length!==3)throw new Error('Real Word individual picker lost its numbered target');
      await select(picker,items[1]);
      if(JSON.stringify(m.bindings.mapping)!==protectedBefore||m.mapping[1]?.id!==items[0].id||m.mapping[3]?.id!==items[0].id||m.mapping[2]?.id!==items[1].id)throw new Error('Real Word single replacement changed a committed neighboring label');
      pickerEvidence={entry:'row',protectedUnchanged:true,appliedLabels:Object.keys(m.mapping)};
    }
    d.getElementById('select-all').click();await until(()=>!m.busy,'select valid positions');pickerEvidence.selected=m.selected.size;
    if(command.pickerScenario&&m.selected.size!==2)throw new Error('Real Word partial selection included an incomplete compound position');
  }
  if(command.orderedPicker){
    m.mapping={...m.bindings.mapping};win.ZBTest.refresh();
    let start=Date.now();while(!api.activePicker?.ZBCPicker?.ready){if(Date.now()-start>20000)throw new Error('Ordered application picker did not open');await Zotero.Promise.delay(50);}
    const picker=api.activePicker;
    for(const n of job.scan.numbers){
      const selected=items[(command.mapping?.[n]||n)-1];
      if(picker.ZBCPicker.session.currentNumber!==n)throw new Error('Ordered automatic mapping lost target '+n);
      await picker.itemsView.selectItems([selected.id]);d.getElementById('zotero-items-tree').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await Promise.resolve();await picker.ZBCPicker.idle;pickerCount++;
      if(m.mapping[n]?.id!==selected.id||m.mappingWorking)throw new Error('Ordered automatic mapping failed at '+n+': '+picker.ZBCPicker.error);
    }
    if(!picker.ZBCPicker.session.complete)throw new Error('Sixty immediate selections did not complete their mappings');
    if(command.reorder){
      picker.document.querySelector('[data-number="1"] [data-action="down"]').click();await picker.ZBCPicker.idle;
      const handle=picker.document.querySelector('[data-number="3"] .zbc-picker-handle'),target=picker.document.querySelector('[data-number="1"]'),transfer=new picker.window.DataTransfer(),rect=target.getBoundingClientRect();
      handle.dispatchEvent(new picker.window.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      target.dispatchEvent(new picker.window.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+2}));
      if(target.dataset.drop!=='before')throw new Error('Ordered Word draft has no insertion indicator');
      target.dispatchEvent(new picker.window.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+2}));
      handle.dispatchEvent(new picker.window.DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));await picker.ZBCPicker.idle;
      if([1,2,3].map(n=>picker.ZBCPicker.session.mapping[n].id).join(',')!==[items[2].id,items[1].id,items[0].id].join(','))throw new Error('Ordered Word draft numbering differs after reorder');
    }
    start=Date.now();while(m.busy||m.mappingWorking){if(Date.now()-start>30000)throw new Error('Ordered application list did not apply');await Zotero.Promise.delay(50);}
    if(Object.keys(m.mapping).length!==job.scan.numbers.length)throw new Error('Applied ordered mapping lost records');
    win.ZBTest.refresh();d.getElementById('select-all').click();
    start=Date.now();while(m.busy||m.mappingWorking){if(Date.now()-start>30000)throw new Error('Ordered application positions did not select');await Zotero.Promise.delay(50);}
  }
  let observed=null,modalError=null,handling=false;
  const timerWindow=Zotero.getMainWindow();
  const timer=timerWindow.setInterval(async()=>{
    if(handling)return;
    let modal=Services.wm.getMostRecentWindow('zbc:renumber-confirm');
    if(!modal||modal.closed||modal.document.readyState!=='complete'){
      modal=null;const windows=Services.ww.getWindowEnumerator();
      while(windows.hasMoreElements()){const w=windows.getNext();if(w.document?.documentURI==='chrome://zotero-batch-citations/content/renumber-confirm.xhtml'&&w.document.readyState==='complete'){modal=w;break;}}
    }
    if(!modal)return;
    const loadError=modal.document.getElementById('renumber-confirm-error');
    if(loadError&&!loadError.hidden){modalError=new Error(loadError.textContent);modal.document.querySelector('dialog').cancelDialog();return;}
    if(!modal.document.getElementById('renumber-summary-lines').children.length)return;
    handling=true;
    try{
      const md=modal.document,tableRows=(document,id)=>[...document.querySelectorAll('#'+id+' > tr')].map(row=>[...row.children].map(cell=>cell.textContent));
      const expected=win.ZBNumberingSummary.build(m.previewPlan,m.bindings.state),summary=tableRows(md,'renumber-summary-lines'),main=tableRows(d,'renumber-preview-body');
      if(JSON.stringify(summary)!==JSON.stringify(expected.changes.map(row=>[row.name,row.change]))||JSON.stringify(main)!==JSON.stringify(summary))throw new Error('Confirmation/main changed numbering mismatch');
      md.getElementById('renumber-full').click();d.getElementById('renumber-preview-full').click();await Zotero.Promise.delay(80);
      const details=tableRows(md,'renumber-summary-lines'),allMain=tableRows(d,'renumber-preview-body');
      if(JSON.stringify(details)!==JSON.stringify(expected.rows.map(row=>[row.name,row.change]))||JSON.stringify(details)!==JSON.stringify(allMain))throw new Error('Confirmation/main all numbering mismatch');
      d.getElementById('renumber-preview-full').click();
      observed={summary,details,accept:!!command.confirm,explicitRefresh:md.querySelector('.renumber-confirm-notice').textContent.includes('Word'),buttonsVisible:[...md.querySelectorAll('button[dlgtype]')].every(b=>b.getBoundingClientRect().bottom<=modal.innerHeight+1)};
      if(!command.confirm){
        const canvas=md.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=modal.innerWidth;canvas.height=modal.innerHeight;const ctx=canvas.getContext('2d');
        if(typeof ctx.drawWindow==='function')ctx.drawWindow(modal,0,0,modal.innerWidth,modal.innerHeight,'white');
        else{const bitmap=await modal.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');ctx.drawImage(bitmap,0,0);bitmap.close();}
        await IOUtils.write(PathUtils.join(root,'renumber-confirm.png'),Uint8Array.from(modal.atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));
      }
      if(command.confirm)md.querySelector('dialog').acceptDialog();else md.querySelector('dialog').cancelDialog();
    }catch(e){modalError=e;modal.document.querySelector('dialog').cancelDialog();}
  },50);
  const start=Date.now();
  try{
    d.getElementById('convert').click();
    while(m.busy||m.mappingWorking){if(Date.now()-start>90000)throw new Error('Iteration submit timed out');await Zotero.Promise.delay(50);}
    if(modalError)throw modalError;
    if(command.expectConfirm&&!observed)throw new Error('Expected numbering confirmation did not open');
    if(job.state==='pending'&&command.confirm!==false)throw new Error('Submission did not advance: '+d.getElementById('message').textContent);
    return {ok:true,confirmation:observed,state:job.state,selected:m.selected.size,referenceStatuses,mixedStatusRows:referenceStatuses.filter(row=>row.status==='已引用 1 · 待转换 2').length,pickerEvidence,orderedPickerCount:pickerCount,appliedMapping:Object.fromEntries(Object.entries(m.mapping).map(([n,r])=>[n,r.uris[0]])),records:items.map(item=>api.itemRecord(item)),preview:m.previewPlan?.preview,elapsedMs:Date.now()-start};
  }finally{timerWindow.clearInterval(timer);}
}
