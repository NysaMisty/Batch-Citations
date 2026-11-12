/* SPDX-License-Identifier: MIT */
// Loaded ONLY by the disposable runner add-on in the test profile.
async function runRuntimeTest(Zotero,config){
  const result={version:Zotero.version,checks:[],started:new Date().toISOString()};
  let progress=Promise.resolve();
  const check=(name,value)=>{if(!value)throw new Error(name);result.checks.push(name);const snapshot=JSON.stringify({...result,state:'running'});progress=progress.then(()=>IOUtils.writeUTF8(config.result.replace(/result\.json$/,'progress.json'),snapshot));};
  try{
    for(let i=0;i<200&&!Zotero.BatchCitations;i++)await Zotero.Promise.delay(100);
    check('plugin startup',!!Zotero.BatchCitations);
    const main=Zotero.getMainWindow();
    check('Tools menu',!!main.document.getElementById('zbc-tools-menu'));
    const win=Zotero.BatchCitations.open(main);
    for(let i=0;i<200&&!win.ZBTest;i++)await Zotero.Promise.delay(100);
    const api=win.ZBTest.adapter;api.checkAPIs();check('dialog and host API checks',!!api);
    const menuIcon=main.document.getElementById('zbc-tools-menu');
    const iconLoaded=await new Promise(resolve=>{const img=new win.Image();img.onload=()=>resolve(img.naturalWidth===96);img.onerror=()=>resolve(false);img.src=menuIcon.getAttribute('image');});
    check('menu icon loads',menuIcon.classList.contains('menuitem-iconic')&&iconLoaded);
    const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const addon=await AddonManager.getAddonByID('batch-citations@nanyan.local');
    check('plugin icon registered',addon.iconURL?.endsWith('/content/icons/batch-citations.svg'));
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    check('native FilePicker API',typeof FilePicker==='function');
    // Fresh Zotero 7 profiles install bundled styles after core startup; await that work explicitly.
    await api.styles();
    for(let i=0;i<200&&(!win.document.getElementById('style-popup')?.children.length||win.ZBTest.model.busy);i++)await Zotero.Promise.delay(100);
    const menuVersion=win.document.getElementById('version').textContent;
    result.initialization={busy:win.ZBTest.model.busy,styleCount:win.document.getElementById('style-popup').children.length};
    check('dialog initialization',menuVersion.includes(Zotero.version)&&!win.ZBTest.model.busy&&result.initialization.styleCount>0);
    const stylePicker=win.document.getElementById('style'),localePicker=win.document.getElementById('locale');
    check('native settings controls',[stylePicker,localePicker].every(el=>el.namespaceURI==='http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'&&typeof el.appendItem==='function'));
    const settingsHeight=win.document.querySelector('.settings').getBoundingClientRect().height;
    const alternateStyle=[...win.document.getElementById('style-popup').children].find(el=>el.getAttribute('value')!==stylePicker.value);
    async function showMenu(picker){
      picker.scrollIntoView({block:'center'});win.focus();picker.open=true;
      for(let i=0;i<60&&picker.menupopup.state!=='open';i++)await Zotero.Promise.delay(50);
      const rect=picker.menupopup.getBoundingClientRect();
      (result.popupSizes||={})[picker.id]={width:rect.width,height:rect.height};
      return picker.menupopup.state==='open'&&rect.height>0&&rect.height<=win.screen.availHeight;
    }
    check('style popup opens',await showMenu(stylePicker));
    alternateStyle.doCommand();stylePicker.menupopup.hidePopup();
    check('style selection command',stylePicker.value===alternateStyle.getAttribute('value')&&stylePicker.selectedItem===alternateStyle);
    check('language popup opens',await showMenu(localePicker));
    const localeItems=[...win.document.getElementById('locale-popup').children];
    localeItems[1].doCommand();let changed=localePicker.value==='en-US';localeItems[0].doCommand();changed&&=localePicker.value==='zh-CN';localeItems[1].doCommand();localePicker.menupopup.hidePopup();
    check('language selection commands',changed&&localePicker.value==='en-US');
    await Zotero.Promise.delay(200);
    // Native popups retain their last bounds after closing; their state and page flow are authoritative.
    check('closed popup layout',[stylePicker,localePicker].every(p=>p.menupopup.state==='closed')&&Math.abs(win.document.querySelector('.settings').getBoundingClientRect().height-settingsHeight)<1);
    const settings=win.document.querySelector('.settings'),bounds=settings.getBoundingClientRect();
    check('settings fit panel',settings.nextElementSibling.getBoundingClientRect().top>=bounds.bottom&&[stylePicker,localePicker].every(p=>{const r=p.getBoundingClientRect();return r.width>0&&r.left>=bounds.left-1&&r.right<=bounds.right+1;}));
    const items=[];
    for(let i=1;i<=3;i++){
      const item=new Zotero.Item('book');item.libraryID=Zotero.Libraries.userLibraryID;
      item.setField('title',`Synthetic reference ${i}`);item.setField('date',`202${i}`);item.setField('publisher','Test Press');
      item.setCreators([{firstName:'Test',lastName:`Author${i}`,creatorType:'author'}]);await item.saveTx();items.push(item);
    }
    const mapping=Object.fromEntries(items.map((item,i)=>[i+1,api.itemRecord(item)]));
    check('URI and CSL metadata',mapping[1].uris[0].includes('/items/')&&mapping[1].itemData.title==='Synthetic reference 1');
    const validated=await api.validateMapping(mapping,[1,2,3]);check('resolve library URI',validated[3].id===items[2].id);
    const read=await api.readDocument(config.input);check('DOCX scan',read.archive.scan.occurrences.length===4);
    const occurrences=read.archive.scan.occurrences.filter(o=>o.eligible);
    check('all markers eligible beside tabs and breaks',occurrences.length===4);
    const styles=await api.styles();check('available in-text styles',styles.length>0);
    const style=styles.find(s=>s.id.endsWith('/ieee'))||styles[0];
    const rendered=await api.render(occurrences,mapping,style.id,'en-US');
    check('CSL citation clusters',Object.keys(rendered.citations).length===4);
    check('CSL bibliography',rendered.bibliography.includes('Synthetic reference'));
    const out=win.ZBArchive.convert(read.archive,occurrences.map(o=>o.key),mapping,rendered,{styleID:style.id,locale:'en-US',zoteroVersion:Zotero.version},api.env);
    const sourceDoc=win.ZBCore.parseXML(read.archive.sourceXML,api.env),convertedDoc=win.ZBCore.parseXML(out.xml,api.env);
    const firstParagraph=doc=>doc.getElementsByTagNameNS(win.ZBCore.W,'p')[0];
    check('tabs and line breaks preserved',['tab','br'].every(name=>{
      const original=firstParagraph(sourceDoc).getElementsByTagNameNS(win.ZBCore.W,name).length;
      return original>0&&firstParagraph(convertedDoc).getElementsByTagNameNS(win.ZBCore.W,name).length===original;
    }));
    await api.assertUnchanged(config.input,read.bytes);
    await api.writeNew(config.output,out.bytes);check('write new DOCX',await IOUtils.exists(config.output));
    let rejected=false;try{await api.writeNew(config.output,out.bytes);}catch(e){rejected=true;}check('existing output refused',rejected);
    const prefDoc=win.ZBCore.parseXML(win.fflate.strFromU8(win.fflate.unzipSync(out.bytes)['docProps/custom.xml']),api.env);
    const prefs=Array.from(prefDoc.documentElement.children).map(p=>p.textContent).join('');
    const dd=new Zotero.Integration.DocumentData(prefs);check('official DocumentData reader',dd.prefs.fieldType==='Field'&&dd.style.styleID===style.id);
    const field={getCode:async()=> 'ITEM CSL_CITATION '+JSON.stringify(out.citations[0]),getText:async()=>rendered.citations[occurrences[0].key]};
    const citation=await new Zotero.Integration.CitationField(field,await field.getCode()).unserialize();
    check('official CitationField reader',citation.citationItems[0].uris[0]===mapping[1].uris[0]);
    await win.ZBTest.loadDocument(config.input);win.ZBTest.refresh();
    Services.scriptloader.loadSubScript(config.selectionScript);await runSelectionTests(Zotero,win,items,check);
    Services.scriptloader.loadSubScript(config.pickerScript);result.pickerLayout=await runPickerTests(Zotero,win,items,config,check);
    win.ZBTest.model.mapping=mapping;
    for(const o of occurrences)win.ZBTest.model.selected.add(o.key);win.ZBTest.refresh();
    const uiOutput=config.output.replace(/\.docx$/,'-ui.docx'),expectedStyle=stylePicker.value,expectedLocale=localePicker.value;
    const originalPicker=api.pickFile,originalRender=api.render;let renderedSelection=null;
    api.pickFile=async()=>uiOutput;
    api.render=async function(selected,records,styleID,locale){renderedSelection={styleID,locale,disabled:stylePicker.disabled&&localePicker.disabled};return originalRender.call(this,selected,records,styleID,locale);};
    try{
      win.document.getElementById('convert').click();
      for(let i=0;i<400&&(win.ZBTest.model.busy||!(await IOUtils.exists(uiOutput)));i++)await Zotero.Promise.delay(50);
      check('export uses selected style and language',renderedSelection?.styleID===expectedStyle&&renderedSelection?.locale===expectedLocale&&renderedSelection.disabled);
      const uiEntries=win.fflate.unzipSync(await IOUtils.read(uiOutput));
      const uiProperties=win.ZBCore.parseXML(win.fflate.strFromU8(uiEntries['docProps/custom.xml']),api.env);
      const uiData=new Zotero.Integration.DocumentData(Array.from(uiProperties.documentElement.children).map(p=>p.textContent).join(''));
      check('exported preferences follow selected controls',uiData.style.styleID===expectedStyle&&uiData.style.locale===expectedLocale);
      check('settings reenabled after export',!win.ZBTest.model.busy&&!stylePicker.disabled&&!localePicker.disabled);
      result.uiSelection={styleID:uiData.style.styleID,locale:uiData.style.locale};
    }finally{api.pickFile=originalPicker;api.render=originalRender;}
    const workspace=win.document.getElementById('workspace'),originalSize={width:win.outerWidth,height:win.outerHeight},chromeWidth=win.outerWidth-win.innerWidth;
    let responsiveOK=true;result.responsiveLayout=[];
    try{
      for(const width of [760,1000]){
        win.resizeTo(width+chromeWidth,originalSize.height);await Zotero.Promise.delay(150);
        for(const page of [0,1]){
          workspace.selectedIndex=page;await Zotero.Promise.delay(100);
          const tabs=win.document.getElementById(page===0?'mapping-tab':'occurrences-tab').getBoundingClientRect();
          const controls=[...win.document.getElementById(page===0?'mapping-panel':'occurrences-panel').querySelectorAll('.toolbar button,.toolbar menulist')].filter(c=>c.getBoundingClientRect().width>0).map(c=>c.getBoundingClientRect());
          const fits=controls.every(r=>r.top>=tabs.bottom-1&&r.left>=8&&r.right<=win.innerWidth-8);
          responsiveOK&&=fits;result.responsiveLayout.push({width:win.innerWidth,page,fits});
        }
      }
    }finally{workspace.selectedIndex=0;win.resizeTo(originalSize.width,originalSize.height);await Zotero.Promise.delay(150);}
    check('both panel toolbars stay separate and within the window at 760 and 1000 pixels',responsiveOK);
    Services.scriptloader.loadSubScript(config.layoutScript);result.mainGeometry=await runUILayoutTests(win,config,check);
    result.citationTexts=rendered.citations;result.bibliography=rendered.bibliography;result.style=style.id;result.output=config.output;
    result.ok=true;
    // Leave a result document for optional Word integration verification, without opening Word.
    if(config.keepOpen){
      await win.ZBTest.loadDocument(config.input);win.ZBTest.model.mapping=mapping;win.ZBTest.refresh();
      if(config.captureUI){
        for(let i=0;i<120&&!win.document.getElementById('message').hidden;i++)await Zotero.Promise.delay(50);
        await Zotero.Promise.delay(300);
        const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=win.innerWidth;canvas.height=win.innerHeight;
        const ctx=canvas.getContext('2d');
        if(typeof ctx.drawWindow==='function')ctx.drawWindow(win,0,0,win.innerWidth,win.innerHeight,'white');
        else{const bitmap=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');ctx.drawImage(bitmap,0,0);bitmap.close();}
        const bytes=Uint8Array.from(win.atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
        await IOUtils.write(config.captureUI,bytes);result.screenshot=config.captureUI;
      }
      const stopTimer=main.setInterval(async()=>{
        const control=PathUtils.join(PathUtils.parent(config.result),'live-control.json');
        if(!(await IOUtils.exists(control)))return;
        const command=JSON.parse((await IOUtils.readUTF8(control)).replace(/^\uFEFF/,''));
        if(command.action!=='stop')return;
        await IOUtils.remove(control);main.clearInterval(stopTimer);win.close();Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
      },250);
      if(config.wordTest){
        const timer=setInterval(async()=>{
          const signal=config.result.replace(/result\.json$/,'word-ready.json');
          if(!(await IOUtils.exists(signal)))return;
          clearInterval(timer);
          Services.scriptloader.loadSubScript(config.wordScript);
          await runWordTest(Zotero,config,items);
        },1000);
      }
    }
    else win.close();
  }catch(e){
    result.ok=false;result.error=String(e);result.stack=e.stack;Zotero.logError(e);
    for(const window of Zotero.BatchCitations?.dialogs||[]){try{window.ZBTest?.adapter.activePicker?.close();window.close();}catch{}}
  }
  result.finished=new Date().toISOString();
  await progress;
  await IOUtils.writeUTF8(config.result,JSON.stringify(result,null,2));
  if(!config.keepOpen||!result.ok)Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
}
