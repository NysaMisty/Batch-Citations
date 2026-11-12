/* SPDX-License-Identifier: MIT */
globalThis.ZBAdapter=class ZBAdapter {
  constructor(Zotero,window){this.Zotero=Zotero;this.window=window;this.env={DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer};}
  checkAPIs(){
    const z=this.Zotero;
    if(!z.Styles?.get||!z.URI?.getItemURI||!z.Cite?.System||typeof IOUtils?.read!=='function')throw new Error('当前 Zotero 缺少所需接口，暂不能使用此版本。');
    return {version:z.version,platform:z.isWin?'Windows':z.isMac?'macOS':'Linux'};
  }
  async pickFile(save=false,name='',extension='docx'){
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const fp=new FilePicker();fp.init(this.window,['json','csv','tsv','literature'].includes(extension)?(save?'导出文献列表':'导入文献列表'):(save?'导出新副本':'打开 DOCX（兼容模式）'),save?fp.modeSave:fp.modeOpen);
    if(extension==='literature'){fp.appendFilter('文献列表（CSV、TSV、JSON）','*.csv;*.tsv;*.json');fp.defaultExtension='csv';}
    else{fp.appendFilter(extension.toUpperCase(),'*.'+extension);fp.defaultExtension=extension;}if(name)fp.defaultString=name;
    const result=await fp.show();return result===fp.returnCancel?null:fp.file;
  }
  async readDocument(path){
    if(!/\.docx$/i.test(path))throw new Error('请选择普通 .docx 文件。');
    const stat=await IOUtils.stat(path);
    if(stat.size>ZBArchive.MAX_INPUT)throw new Error('MVP 仅处理不超过 25 MiB 的 DOCX。');
    const bytes=await IOUtils.read(path);return {bytes,archive:ZBArchive.open(bytes,this.env)};
  }
  async assertUnchanged(path,original){
    const stat=await IOUtils.stat(path);if(stat.size!==original.length)throw new Error('源文档已发生变化，请重新扫描。');
    const bytes=await IOUtils.read(path);
    if(!bytes.every((v,i)=>v===original[i]))throw new Error('源文档已发生变化，请重新扫描。');
  }
  async writeNew(path,bytes){
    if(await IOUtils.exists(path))throw new Error('此文件已存在。为保留原件，请换一个新文件名。');
    const tmp=path+'.zbc-'+this.window.crypto.randomUUID()+'.tmp';
    try{await IOUtils.write(tmp,bytes);await IOUtils.move(tmp,path,{noOverwrite:true});}
    finally{if(await IOUtils.exists(tmp))await IOUtils.remove(tmp);}
  }
  chooseReferences(numbers,mapping={},lockedNumbers=[],options={}){return ZBPicker.open(this,{numbers,mapping,lockedNumbers,...options});}
  confirmDuplicateBindings(mapping,incoming,{parent=this.window}={}){
    const candidate={...mapping,...incoming},lines=[],seen=new Set();
    for(const [n,record]of Object.entries(incoming)){
      if(!record)continue;
      const previous=ZBMapping.duplicateNumbers(mapping,n,mapping[n]);
      const others=ZBMapping.duplicateNumbers(candidate,n,record).filter(other=>{
        if(previous.includes(other)&&this.sameIdentity(mapping[n],record)&&this.sameIdentity(mapping[other],candidate[other]))return false;
        const key=[Number(n),other].sort((a,b)=>a-b).join(':');if(seen.has(key))return false;seen.add(key);return true;
      });
      if(others.length)lines.push(`《${record.itemData?.title||'未命名文献'}》\n该文献已绑定原编号 ${others.map(other=>`[${other}]`).join('、')}。如果继续将其绑定至 [${n}]，这些原编号将指向同一文献，最终引用编号可能合并。`);
    }
    if(!lines.length)return true;
    const prompt=Services.prompt,flags=prompt.BUTTON_POS_0*prompt.BUTTON_TITLE_IS_STRING+prompt.BUTTON_POS_1*prompt.BUTTON_TITLE_CANCEL+prompt.BUTTON_POS_1_DEFAULT;
    return prompt.confirmEx(parent,'确认重复绑定',lines.join('\n\n')+'\n\n是否继续？',flags,'继续绑定',null,null,null,{value:false})===0;
  }
  itemRecord(item){
    if(!item||item.deleted||!item.isRegularItem())throw new Error('请选择未删除的普通文献条目，不能选择附件或笔记。');
    const sys=new this.Zotero.Cite.System({automaticJournalAbbreviations:false});
    return {id:item.id,uris:[this.Zotero.URI.getItemURI(item)],itemData:sys.retrieveItem(item.id)};
  }
  mappingRecordValid(record,{existing={}}={}){
    if(!record?.itemData||!record.uris?.some(uri=>typeof uri==='string'&&uri.trim()))return false;
    if(Object.values(existing).some(item=>this.sameIdentity(item,record)))return true;
    try{
      const item=this.Zotero.Items.get(record.id);
      return !!item&&!item.deleted&&item.isRegularItem()&&this.sameIdentity(record,{uris:[this.Zotero.URI.getItemURI(item)]});
    }catch{return false;}
  }
  async validateMapping(mapping,numbers){
    const current={};
    for(const n of numbers){
      const uri=mapping[n]?.uris?.[0];if(!uri)throw new Error(`编号 ${n} 尚未选择文献。`);
      try{const item=await this.Zotero.URI.getURIItem(uri);current[n]=this.itemRecord(item);}
      catch(e){throw new Error(`编号 [${n}] 的文献无法应用：${e.message||String(e)} 请重新选择有效文献。`);}
    }
    return current;
  }
  // Original labels can share a reference after explicit confirmation in the UI.
  sameIdentity(a,b){
    const normalize=uri=>String(uri).trim().replace(/^https?:\/\/(?:www\.)?zotero\.org\//i,'zotero.org/').replace(/\/+$/,'');
    const keys=new Set((a?.uris||[]).map(normalize));return (b?.uris||[]).some(uri=>keys.has(normalize(uri)));
  }
  async resolveRecord(record){
    const found=new Map();
    for(const uri of record.uris||[]){
      let item;try{item=await this.Zotero.URI.getURIItem(uri);}catch{}
      if(item&&!item.deleted)found.set(item.libraryID+':'+item.id,item);
      const relations=this.Zotero.Relations;
      if(relations?.getByPredicateAndObject&&relations.replacedItemPredicate){
        const replacements=await relations.getByPredicateAndObject('item',relations.replacedItemPredicate,uri);
        for(const replacement of replacements||[])if(!replacement.deleted)found.set(replacement.libraryID+':'+replacement.id,replacement);
      }
    }
    if(found.size>1)throw new Error('同一引用的 URI 对应多个当前文献，已停止自动关联，请先核对 Zotero 条目合并关系。');
    const item=found.values().next().value;if(!item)return null;
    const current=this.itemRecord(item);current.uris=[...new Set([...current.uris,...record.uris])];return current;
  }
  async validateLiveMapping(mapping,numbers,{existing={}}={}){
    const current={};
    for(const n of numbers){
      const uri=mapping[n]?.uris?.[0];if(!uri)throw new Error(`编号 ${n} 尚未选择文献。`);
      const protectedRecord=Object.values(existing).find(record=>this.sameIdentity(record,mapping[n]));
      // A field-backed embedded item remains valid even when the current library
      // has no corresponding local item. Never trust arbitrary new mappings here.
      if(protectedRecord){current[n]=JSON.parse(JSON.stringify(protectedRecord));continue;}
      const record=await this.resolveRecord(mapping[n]);
      if(!record)throw new Error(`编号 ${n} 的新文献不在当前资料库中，请重新选择。`);
      current[n]=record;
    }
    return current;
  }
  async styles(){
    await this.Zotero.Styles.init();
    return this.Zotero.Styles.getVisible().filter(s=>s.class!=='note'&&s.hasBibliography).map(s=>({id:s.styleID,title:s.title})).sort((a,b)=>a.title.localeCompare(b.title));
  }
  async styleCapabilities(styleID){
    const style=this.Zotero.Styles.get(styleID);
    if(!style||style.class==='note')return {numeric:false,firstUse:false,reason:'当前样式不是正文顺序编码样式。'};
    const xml=await style.getXML();
    const document=new this.window.DOMParser().parseFromString(xml,'application/xml');
    const elements=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
    const citation=elements(document,'citation')[0],bibliography=elements(document,'bibliography')[0];
    const macros=new Map(elements(document,'macro').map(node=>[node.getAttribute('name'),node]));
    function usesNumber(node,visited=new Set()){
      if(!node)return false;
      for(const text of elements(node,'text')){
        if(text.getAttribute('variable')==='citation-number')return true;
        const name=text.getAttribute('macro');if(name&&!visited.has(name)){visited.add(name);if(usesNumber(macros.get(name),visited))return true;}
      }
      return false;
    }
    const numeric=usesNumber(citation),sort=bibliography&&elements(bibliography,'sort')[0];
    const firstUse=numeric&&(!sort||elements(sort,'key').every(key=>key.getAttribute('variable')==='citation-number'));
    return {numeric,firstUse,reason:firstUse?'':'当前样式不能确认按首次引用顺序编号；显示和书目排序由 Zotero 决定。'};
  }
  async previewLive(plan,locale){
    if(!plan.preview.numeric)return plan.preview;
    const settings=JSON.parse(plan.documentData),style=this.Zotero.Styles.get(settings.style.styleID);
    // Zotero 7 always caches engines for installed styles. A pathless Style
    // instance creates a separate processor without clearing a Word session.
    const isolated=new this.Zotero.Style(style.getXML());
    const engine=await isolated.getCiteProc(locale,'text',false);
    try{
      for(const citation of plan.expected.graph.citations)
        // citeproc adds internal `item` data to each input. Keep the immutable
        // commit/verification graph separate from that engine-owned data.
        await engine.appendCitationCluster({citationID:citation.citationID,citationItems:JSON.parse(JSON.stringify(citation.items)),properties:{noteIndex:0}});
      const bibliography=await engine.makeBibliography(),ids=bibliography?.[0]?.entry_ids;
      if(!Array.isArray(ids))throw new Error('样式处理器未提供编号对应关系。');
      const numbers=new Map(ids.flatMap((group,index)=>(Array.isArray(group)?group:[group]).map(id=>[String(id),index+1])));
      const items=plan.expected.graph.citations.flatMap(c=>c.items);
      for(const entry of plan.preview.order){
        const item=items.find(record=>this.sameIdentity(record,entry)),number=item&&numbers.get(String(item.id));
        if(!Number.isInteger(number))throw new Error('无法确认嵌入文献的预览编号。');
        entry.number=number;
      }
      plan.preview.verifiedCSL=true;return plan.preview;
    }catch(e){plan.preview.numeric=false;plan.preview.diagnostic=e.message||String(e);plan.preview.limited='可核对文献出现顺序；当前处理器未能确认最终编号，正式编号由 Zotero 刷新生成。';return plan.preview;}
    finally{if(typeof engine.free==='function')engine.free();}
  }
  async render(occurrences,mapping,styleID,locale){
    const style=this.Zotero.Styles.get(styleID);
    if(!style||style.class==='note'||!style.hasBibliography)throw new Error('请选择带参考文献表的正文引用样式。');
    const engine=await style.getCiteProc(locale,'text',false);
    try{
      const citations={};
      for(const o of occurrences){
        const updates=await engine.appendCitationCluster(ZBCore.citationFor(o,mapping));
        for(const [index,text]of updates){if(occurrences[index])citations[occurrences[index].key]=text;}
      }
      const bibliography=await engine.makeBibliography();
      if(!bibliography||!bibliography[1]?.length)throw new Error('所选样式没有生成参考文献表。');
      return {citations,bibliography:bibliography[1].map(t=>t.replace(/\r?\n$/,'')).join('\n')};
    }finally{if(typeof engine.free==='function')engine.free();}
  }
  async importMapping(path,options={}){
    if((await IOUtils.stat(path)).size>2*1024*1024)throw new Error('文献列表超过 2 MiB。');
    const rows=ZBLiterature.parse(await IOUtils.readUTF8(path),path.split('.').at(-1).toLowerCase(),{...options,allowDuplicates:true}),records={};
    for(const [number,row]of Object.entries(rows)){
      try{records[number]=options.live?await this.resolveRecord({uris:[row.uri]}):this.itemRecord(await this.Zotero.URI.getURIItem(row.uri));if(!records[number])throw new Error('missing');}
      catch{throw new Error(`${row.where}：编号 ${number} 的 URI 未对应当前资料库中的有效文献，请检查 URI 或先将文献加入 Zotero。`);}
    }
    return records;
  }
  exportMapping(mapping,options={}){
    return {format:'zotero-batch-citations/v1',mapping:Object.fromEntries(Object.entries(mapping).map(([n,item])=>[n,{uri:item.uris[0],title:item.itemData.title}]))};
  }
};
