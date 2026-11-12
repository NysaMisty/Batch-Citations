/* SPDX-License-Identifier: MIT */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('fflate'),require('./core.js'));
  else root.ZBArchive=factory(root.fflate,root.ZBCore);
})(globalThis,function(zip,core){
  'use strict';
  const MAX_INPUT=25*1024*1024,MAX_EXPANDED=100*1024*1024;
  const CP_TYPE='application/vnd.openxmlformats-officedocument.custom-properties+xml';
  const CP_REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';
  const REL='http://schemas.openxmlformats.org/package/2006/relationships';
  const CONTENT='http://schemas.openxmlformats.org/package/2006/content-types';
  function open(bytes,env){
    if(bytes.length>MAX_INPUT)throw new Error('MVP 仅处理不超过 25 MiB 的 DOCX。');
    let expanded=0,count=0,names=new Set();
    let entries;
    try{
      entries=zip.unzipSync(bytes,{filter(file){
        if(++count>5000)throw new Error('压缩包条目超过 5000。');
        if(names.has(file.name))throw new Error('压缩包含重复条目。');names.add(file.name);
        if(file.name.startsWith('/')||file.name.includes('\\')||file.name.split('/').includes('..'))throw new Error('压缩包条目路径异常。');
        expanded+=file.originalSize;
        if(expanded>MAX_EXPANDED)throw new Error('DOCX 展开后超过 100 MiB。');
        return true;
      }});
    }catch(e){throw new Error('无法读取 DOCX：'+e.message);}
    for(const key of ['[Content_Types].xml','_rels/.rels','word/document.xml'])if(!entries[key])throw new Error('不是完整 DOCX，或文件已加密。');
    if(Object.keys(entries).some(x=>x.startsWith('_xmlsignatures/')||x.endsWith('vbaProject.bin')))throw new Error('MVP 不处理数字签名文档或宏文档，请先另存为普通 DOCX。');
    const xml=name=>entries[name]?zip.strFromU8(entries[name]):'';
    const types=core.parseXML(xml('[Content_Types].xml'),env);
    const main=Array.from(types.documentElement.childNodes).find(x=>x.nodeType===1&&x.getAttribute('PartName')==='/word/document.xml');
    if(main?.getAttribute('ContentType')!=='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')throw new Error('仅支持普通 .docx 主文档类型。');
    for(const name of Object.keys(entries).filter(x=>/^word\/.*\.xml$/.test(x))){
      const s=xml(name);
      const d=core.parseXML(s,env);
      if(name==='word/settings.xml'){
        const track=Array.from(d.getElementsByTagNameNS(core.W,'trackRevisions')).some(x=>!['false','0','off'].includes(x.getAttributeNS(core.W,'val')));
        if(track)throw new Error('文档开启了修订模式，请先在副本中关闭修订。');
      }
      const instructions=Array.from(d.getElementsByTagNameNS(core.W,'instrText')).map(n=>n.textContent).join('')+
        Array.from(d.getElementsByTagNameNS(core.W,'fldSimple')).map(n=>n.getAttributeNS(core.W,'instr')).join('');
      const bookmarks=Array.from(d.getElementsByTagNameNS(core.W,'bookmarkStart')).some(n=>/^(ZOTERO_|CSL_)/.test(n.getAttributeNS(core.W,'name')));
      if(/CSL_CITATION|CSL_BIBLIOGRAPHY|ZOTERO_ITEM|ZOTERO_BIBL/.test(instructions)||bookmarks)throw new Error('文档已有 Zotero 引用；MVP 不混合或重复转换。');
    }
    if(/ZOTERO_PREF/i.test(xml('docProps/custom.xml')))throw new Error('文档已有 Zotero 设置，MVP 不混合转换。');
    const scan=core.scanDocument(xml('word/document.xml'),env);
    const excluded=[];
    for(const name of Object.keys(entries).filter(x=>/^word\/(header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(x))){
      const d=core.parseXML(xml(name),env);
      const n=Array.from(d.getElementsByTagNameNS(core.W,'p')).reduce((n,p)=>n+core.countMarkers(Array.from(p.getElementsByTagNameNS(core.W,'t')).map(t=>t.textContent).join('')),0);
      if(n)excluded.push({part:name,count:n});
    }
    return {entries,scan,excluded,sourceXML:xml('word/document.xml')};
  }
  function updatePackageXML(entries,data,env){
    entries['docProps/custom.xml']=zip.strToU8(core.mergeDocumentProperties(entries['docProps/custom.xml']?zip.strFromU8(entries['docProps/custom.xml']):'',data,env));
    const types=core.parseXML(zip.strFromU8(entries['[Content_Types].xml']),env);
    if(!Array.from(types.documentElement.childNodes).some(x=>x.nodeType===1&&x.getAttribute('PartName')==='/docProps/custom.xml')){
      const n=types.createElementNS(CONTENT,'Override');n.setAttribute('PartName','/docProps/custom.xml');n.setAttribute('ContentType',CP_TYPE);types.documentElement.appendChild(n);
    }
    entries['[Content_Types].xml']=zip.strToU8(core.serialize(types,env));
    const rels=core.parseXML(zip.strFromU8(entries['_rels/.rels']),env);
    const children=Array.from(rels.documentElement.childNodes).filter(x=>x.nodeType===1);
    const existing=children.find(x=>x.getAttribute('Type')===CP_REL);
    if(existing&&existing.getAttribute('Target')!=='docProps/custom.xml'&&existing.getAttribute('Target')!=='/docProps/custom.xml')throw new Error('自定义属性关系不是标准路径，请先用 Word 另存一份。');
    if(!existing){
      let i=1;while(children.some(x=>x.getAttribute('Id')===`rIdZBC${i}`))i++;
      const n=rels.createElementNS(REL,'Relationship');n.setAttribute('Id',`rIdZBC${i}`);n.setAttribute('Type',CP_REL);n.setAttribute('Target','docProps/custom.xml');rels.documentElement.appendChild(n);
    }
    entries['_rels/.rels']=zip.strToU8(core.serialize(rels,env));
  }
  function convert(archive,keys,mapping,rendered,settings,env){
    const out=core.convertDocument(archive.sourceXML,keys,mapping,rendered,env);
    const entries=Object.assign(Object.create(null),archive.entries);
    entries['word/document.xml']=zip.strToU8(out.xml);
    updatePackageXML(entries,core.documentData(settings.styleID,settings.locale,settings.zoteroVersion),env);
    return {bytes:zip.zipSync(entries,{level:6}),...out};
  }
  return {open,convert,MAX_INPUT,MAX_EXPANDED};
});
