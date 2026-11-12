/* SPDX-License-Identifier: MIT; isolated application UI and file round trips. */
async function runAutomaticUITests(Zotero,win,items,root){
  const checks=[],d=win.document,m=win.ZBTest.model,api=win.ZBTest.adapter,originalPick=api.pickFile;
  const check=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
  const until=async test=>{for(let i=0;i<300;i++){if(test())return;await Zotero.Promise.delay(40);}throw Error('I/O UI timed out');};
  const click=async button=>{button.click();await until(()=>!m.busy);};
  try{
    await until(()=>api.activePicker?.ZBCPicker.ready);
    const menu=d.getElementById('list-more'),format=d.getElementById('list-format'),records=Object.fromEntries(items.slice(0,3).map((item,i)=>[i+1,api.itemRecord(item)])),suffix=win.crypto.randomUUID();
    check('main library is directly visible without a separate choose button',!d.getElementById('batch-pick')&&!d.getElementById('zbc-reference-workspace').hidden);
    check('backup restore controls are secondary and initially collapsed',!menu.open&&menu.contains(d.getElementById('import-map'))&&menu.contains(d.getElementById('export-map')));
    check('backup guidance describes current lists library and no manual URLs',menu.textContent.includes('当前文献列表')&&menu.textContent.includes('当前 Zotero')&&menu.textContent.includes('无需手写')&&!d.getElementById('list-example'));
    check('all export formats retain the native Zotero menu',format.namespaceURI.includes('keymaster')&&format.value==='csv'&&format.menupopup.children[2].label==='JSON');
    menu.querySelector('summary').click();check('more operations opens with its existing accessible summary',menu.open);
    d.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape closes secondary menu without closing main window',!menu.open&&!win.closed);
    const file=PathUtils.join(root,'ui-list-'+suffix+'.json');api.pickFile=async()=>file;await IOUtils.writeUTF8(file,JSON.stringify(api.exportMapping(records)));
    await click(d.getElementById('import-map'));check('legacy JSON resolves current-library references and updates numbering',m.mapping[1]?.id===items[0].id&&m.mapping[3]?.id===items[2].id&&d.getElementById('number-check').textContent.includes('连续'));
    const native=api.activePicker.itemsView;check('import resets one draft without recreating the native view',api.activePicker.ZBCPicker.session.mapping[3].id===items[2].id&&d.querySelectorAll('#zbc-picker-panel').length===1);
    for(const name of ['csv','tsv','json']){
      const output=PathUtils.join(root,'ui-export-'+suffix+'.'+name);api.pickFile=async()=>output;format.value=name;await click(d.getElementById('export-map'));const text=await IOUtils.readUTF8(output),bytes=await IOUtils.read(output);
      const parsed=win.ZBLiterature.parse(text,name,{allowDuplicates:true});check(name+' export preserves stable numbered URI bindings',parsed[1].uri===records[1].uris[0]&&parsed[3].title===records[3].itemData.title);
      if(name!=='json')check(name+' export uses UTF8 BOM and required header',bytes[0]===239&&text.includes('number')&&text.includes('uri')&&text.includes('title'));
      m.mapping={};win.ZBTest.refresh();await click(d.getElementById('import-map'));check(name+' import restores real library metadata in the same view',m.mapping[2].id===items[1].id&&api.activePicker.itemsView===native);
    }
    const invalid=PathUtils.join(root,'ui-invalid-'+suffix+'.csv');api.pickFile=async()=>invalid;
    for(const [text,expected]of [['title,uri'+String.fromCharCode(10)+'Missing,'+records[1].uris[0],'表头'],['number,uri,title'+String.fromCharCode(10)+'zero,'+records[1].uris[0]+',bad','第 2 行'],['number,uri,title'+String.fromCharCode(10)+'1,https://zotero.org/users/123456/items/ABCD1234,Missing','资料库']]){const before=JSON.stringify(m.mapping);await IOUtils.writeUTF8(invalid,text);await click(d.getElementById('import-map'));check('invalid import remains atomic and reports '+expected,JSON.stringify(m.mapping)===before&&d.getElementById('message').textContent.includes(expected));}
    await IOUtils.writeUTF8(file,JSON.stringify(api.exportMapping({2:records[1]})));api.pickFile=async()=>file;let confirmation;
    const timer=Zotero.getMainWindow().setInterval(()=>{const windows=Services.ww.getWindowEnumerator();while(windows.hasMoreElements()){const modal=windows.getNext();if(modal.args?.title!=='确认重复绑定'||!modal.Dialog)continue;const dialog=modal.document.querySelector('dialog');confirmation={defaultButton:dialog.defaultButton,defaultButtonNum:modal.args.defaultButtonNum,text:modal.args.text};dialog.acceptDialog();}},25);
    try{await click(d.getElementById('import-map'));}finally{Zotero.getMainWindow().clearInterval(timer);}
    check('imported duplicate labels require explicit cancel-default confirmation',confirmation?.defaultButton==='cancel'&&confirmation.defaultButtonNum===1&&confirmation.text.includes('[1]')&&confirmation.text.includes('[2]')&&m.mapping[2].id===m.mapping[1].id);
    check('import keeps the persistent numbered queue synchronized',api.activePicker.ZBCPicker.session.mapping[2].id===m.mapping[2].id&&!m.mappingWorking);
    const session=api.activePicker.ZBCPicker.session,workspace=d.getElementById('workspace');
    check('number details area is removed while the numbered queue remains',!d.getElementById('mapping-details')&&d.getElementById('zbc-picker-queue'));
    workspace.selectedIndex=1;await Zotero.Promise.delay(100);
    const positions=d.querySelector('.preview').getBoundingClientRect();
    check('citation position tab remains separate and usable',d.getElementById('occurrences-tab').label==='引用位置'&&positions.height>100&&workspace.selectedPanel.id==='occurrences-panel'&&d.getElementById('occurrences-panel').contains(d.elementFromPoint(positions.x+positions.width/2,positions.y+positions.height/2)));
    workspace.selectedIndex=0;check('switching tabs preserves the same selection session',api.activePicker.ZBCPicker.session===session&&d.getElementById('zbc-reference-workspace').getBoundingClientRect().height>100);
    check('native platform styles and shared desktop components remain loaded',!!d.querySelector('link[href="ui-common.css"]')&&!!d.querySelector('link[href="chrome://zotero-platform/content/zotero.css"]'));
    check('the default document remains bound to its original Word job',!!m.liveJob&&d.getElementById('compatibility').hidden);
    format.value='csv';return {ok:true,checks,formats:['csv','tsv','json'],secondaryMenu:true};
  }catch(e){return {ok:false,checks,error:String(e),stack:e.stack};}finally{api.pickFile=originalPick;}
}
