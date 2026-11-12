/* SPDX-License-Identifier: MIT; capture the preserved 1.1.5 addon in a fresh library. */
async function runBaselineUI(Zotero,config){
  const root=PathUtils.parent(config.result),checks=[];
  const check=(name,value)=>{if(!value)throw new Error(name);checks.push(name);};
  async function until(fn){for(let i=0;i<400;i++){if(fn())return;await Zotero.Promise.delay(50);}throw new Error('Baseline UI timeout');}
  try{
    await until(()=>!!Zotero.BatchCitations);const win=Zotero.BatchCitations.open(Zotero.getMainWindow());await until(()=>!!win.ZBTest&&!win.ZBTest.model.busy);
    const api=win.ZBTest.adapter,m=win.ZBTest.model,records={};
    for(let n=1;n<=3;n++){const item=new Zotero.Item('book');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title',`Synthetic reference ${n}`);item.setField('date',`202${n}`);item.setField('publisher','Test Press');item.setCreators([{firstName:'Test',lastName:`Author${n}`,creatorType:'author'}]);await item.saveTx();records[n]=api.itemRecord(item);}
    await win.ZBTest.loadDocument(config.input);m.mapping=records;m.selected=new Set(m.archive.scan.occurrences.filter(o=>o.eligible).map(o=>o.key));win.ZBTest.refresh();
    win.document.getElementById('style').value='http://www.zotero.org/styles/american-chemical-society';win.document.getElementById('locale').value='en-US';
    Services.scriptloader.loadSubScript(config.layoutScript);const geometry=await runUILayoutTests(win,{...config,baseline:true},check);
    const longTitle='Long synthetic literature title '.repeat(18),mapping=Object.fromEntries(Array.from({length:60},(_,i)=>[i+1,{...records[i%3+1],itemData:{...records[i%3+1].itemData,title:longTitle+(i+1)}}]));
    const pending=win.ZBPicker.open(api,{numbers:Array.from({length:60},(_,i)=>i+1),mapping,live:true});await until(()=>api.activePicker?.ZBCPicker?.ready);const picker=api.activePicker,pg=[];
    for(const [width,height]of [[1000,760],[720,560],[640,560]]){
      picker.resizeTo(width,height);await Zotero.Promise.delay(250);
      const d=picker.document,canvas=d.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=picker.innerWidth;canvas.height=picker.innerHeight;const ctx=canvas.getContext('2d');
      if(typeof ctx.drawWindow==='function')ctx.drawWindow(picker,0,0,picker.innerWidth,picker.innerHeight,'white');
      else{const bitmap=await picker.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');ctx.drawImage(bitmap,0,0);bitmap.close();}
      await IOUtils.write(PathUtils.join(root,`picker-native-${width}-light.png`),Uint8Array.from(picker.atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0)));
      pg.push({requestedWidth:width,width:picker.innerWidth,height:picker.innerHeight,queue:d.getElementById('zbc-picker-queue').getBoundingClientRect().toJSON(),buttons:d.querySelector('.dialog-button-box').getBoundingClientRect().toJSON()});
    }
    picker.document.querySelector('dialog').cancelDialog();await pending;win.close();
    await IOUtils.writeUTF8(config.result,JSON.stringify({ok:true,version:Zotero.version,addonVersion:'1.1.5',scope:'Actual isolated Zotero windows; synthetic library and document; content-area snapshots',geometry,pickerGeometry:pg,checks},null,2));
  }catch(e){await IOUtils.writeUTF8(config.result,JSON.stringify({ok:false,checks,error:String(e),stack:e.stack}));}
  Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
}
