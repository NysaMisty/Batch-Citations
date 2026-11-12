/* SPDX-License-Identifier: MIT; isolated synthetic library and native dialog only. */
async function runSelectionTests(Zotero,win,items,check){
  const m=win.ZBTest.model,api=win.ZBTest.adapter,d=win.document;
  const saved={archive:m.archive,mapping:m.mapping,selected:m.selected,path:m.path,bytes:m.bytes,invalidMappings:m.invalidMappings};
  const extra=new Zotero.Item('book');extra.libraryID=Zotero.Libraries.userLibraryID;extra.setField('title','Selection-only synthetic fourth reference');await extra.saveTx();
  const entries=[...items.slice(0,3),extra],mapping=Object.fromEntries(entries.map((item,i)=>[i+1,api.itemRecord(item)]));
  const wait=async()=>{for(let i=0;i<400;i++){if(!m.busy&&!m.mappingWorking)return;await Zotero.Promise.delay(25);}throw new Error('Selection test did not finish');};
  const waitPicker=async()=>{await Zotero.Promise.delay(100);await api.activePicker?.ZBCPicker?.idle;await wait();await Zotero.Promise.delay(50);};
  const selected=()=>m.archive.scan.occurrences.filter(o=>m.selected.has(o.key)).map(o=>o.raw).join('|');
  const bulk=async()=>{d.getElementById('select-all').click();await wait();};
  try{
    const xml=`<w:document xmlns:w="${win.ZBCore.W}"><w:body><w:p><w:r><w:t>one [1]; pair [1,2]; range [2-4]; other [3].</w:t></w:r></w:p></w:body></w:document>`;
    m.archive={scan:win.ZBCore.scanDocument(xml,api.env)};m.mapping={1:mapping[1]};m.selected=new Set();win.ZBTest.refresh();
    await bulk();check('bulk skips whole compound positions until all numbered references are bound',selected()==='[1]');
    check('bulk reports skipped positions and missing binding numbers',d.getElementById('message').textContent.includes('跳过 3 处')&&d.getElementById('message').textContent.includes('[2]'));
    m.mapping={...mapping};win.ZBTest.refresh();await bulk();
    check('bulk selects complete pairs and ranges when every binding is valid',m.selected.size===4);
    const clearRow=d.querySelector('#zbc-picker-queue [data-number="2"]');
    clearRow.querySelector('[data-action="clear"]').dispatchEvent(new win.Event('command',{bubbles:false}));await waitPicker();
    check('clearing a binding immediately unchecks every related compound position',selected()==='[1]|[3]'&&[...d.querySelectorAll('#occurrences input')].filter(box=>box.checked).length===2);
    check('missing binding reason is visible in the actual occurrence status',d.getElementById('occurrences').textContent.includes('缺少有效文献绑定：[2]'));
    m.mapping={...mapping};win.ZBTest.refresh();await bulk();
    const beforeNotification=JSON.stringify(m.mapping);
    extra.deleted=true;await extra.saveTx();await Zotero.Promise.delay(150);await waitPicker();
    check('library deletion notification prunes a selected range without another user click',selected()==='[1]|[1,2]|[3]');
    check('native library refresh does not bind an automatically reselected item',JSON.stringify(m.mapping)===beforeNotification);
    // Keep the button's previous enabled state, then invalidate one binding before its handler.
    // The submission path must revalidate rather than trusting the displayed selection.
    m.mapping[2]={...mapping[2],uris:['http://zotero.org/users/1/items/MISSING0']};
    let writes=0,pickers=0;const originalWrite=api.writeNew,originalPick=api.pickFile;
    api.writeNew=async()=>{writes++;};api.pickFile=async()=>{pickers++;return null;};
    try{d.getElementById('convert').click();await wait();}
    finally{api.writeNew=originalWrite;api.pickFile=originalPick;}
    check('conversion revalidates URI binding before any output picker or write',writes===0&&pickers===0&&d.getElementById('message').textContent.includes('缺少有效文献绑定'));
    // Confirmed duplicate labels remain valid while incomplete clusters stay blocked.
    m.mapping={1:mapping[1],2:mapping[1],3:mapping[3]};m.invalidMappings.clear();
    m.selected=new Set(m.archive.scan.occurrences.filter(o=>o.raw==='[1]'||o.raw==='[1,2]').map(o=>o.key));
    win.ZBTest.refresh();writes=0;pickers=0;
    api.writeNew=async()=>{writes++;};api.pickFile=async()=>{pickers++;return null;};
    try{d.getElementById('convert').click();await wait();}
    finally{api.writeNew=originalWrite;api.pickFile=originalPick;}
    check('compatibility conversion accepts shared references after per-number identity validation',writes===0&&pickers===1);
    const pair=win.ZBCore.citationFor({numbers:[1,2]},m.mapping);
    check('shared original numbers deduplicate the actual compatibility citation cluster',pair.citationItems.length===1&&pair.citationItems[0].uris[0]===mapping[1].uris[0]);
    const originalValidate=api.validateMapping;
    for(const proceed of [false,true]){
      m.mapping={1:mapping[1],2:mapping[2],3:mapping[3]};m.selected=new Set();m.invalidMappings.clear();win.ZBTest.refresh();
      const before=JSON.stringify(m.mapping);let confirmation=null;
      api.validateMapping=async function(records,numbers){const checked=await originalValidate.call(this,records,numbers);if(checked[2])checked[2]={...mapping[1],uris:[...mapping[1].uris,...mapping[2].uris]};return checked;};
      const timerWindow=Zotero.getMainWindow(),timer=timerWindow.setInterval(()=>{
        const windows=Services.ww.getWindowEnumerator();
        while(windows.hasMoreElements()){
          const modal=windows.getNext();
          if(!modal.document?.documentURI.includes('commonDialog')||modal.args?.title!=='确认重复绑定'||!modal.Dialog)continue;
          const dialog=modal.document.querySelector('dialog');confirmation={defaultButton:dialog.defaultButton,text:modal.args.text};if(proceed)dialog.acceptDialog();else dialog.cancelDialog();
        }
      },25);
      try{await bulk();}finally{timerWindow.clearInterval(timer);api.validateMapping=originalValidate;}
      if(proceed)check('selection-time resolver merges require confirmation before shared labels become convertible',confirmation?.defaultButton==='cancel'&&m.mapping[1].id===m.mapping[2].id&&win.ZBCore.citationFor({numbers:[1,2]},m.mapping).citationItems.length===1);
      else check('canceling a newly resolved duplicate preserves all prevalidation mappings',confirmation?.defaultButton==='cancel'&&confirmation.text.includes('[1]')&&confirmation.text.includes('[2]')&&JSON.stringify(m.mapping)===before);
    }
  }finally{
    if(!extra.deleted){extra.deleted=true;await extra.saveTx();}
    Object.assign(m,saved);win.ZBTest.refresh();
  }
}
