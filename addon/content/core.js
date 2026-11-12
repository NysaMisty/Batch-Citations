/* SPDX-License-Identifier: MIT */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZBCore = api;
})(globalThis, function () {
  'use strict';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const CP = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
  const VT = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
  const BIB = '{{ZOTERO_BIBLIOGRAPHY}}';
  const isW = (node, name) => node?.nodeType === 1 && node.namespaceURI === W && node.localName === name;
  const elements = node => Array.from(node.childNodes || []).filter(n => n.nodeType === 1);
  const descendants = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
  function fail(message) { throw new Error(message); }
  function parseXML(xml, env) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('不支持含 DTD 或实体声明的 XML。');
    let error = null;
    const doc = new env.DOMParser({ onError: (level, message) => { if (level !== 'warning') error = message; } }).parseFromString(xml, 'application/xml');
    if (error || !doc.documentElement || doc.getElementsByTagName('parsererror').length) fail('XML 解析失败：' + (error || '文档损坏'));
    return doc;
  }
  function serialize(doc, env) { return new env.XMLSerializer().serializeToString(doc); }
  function parseMarker(text) {
    if (typeof text !== 'string' || !/^\[\s*[\d\s,，、;；\-–—]+\s*\]$/.test(text)) return null;
    const values = [];
    const token = '[1-9]\\d{0,4}';
    for (const part of text.slice(1,-1).trim().split(/\s*[,，、;；]\s*/)) {
      const m = new RegExp(`^(${token})(?:\\s*[-–—]\\s*(${token}))?$`).exec(part.trim());
      if (!m) return null;
      const first = Number(m[1]), last = Number(m[2] || m[1]);
      if (last < first || last - first > 100 || values.length + last - first + 1 > 200) return null;
      for (let n=first; n<=last; n++) if (!values.includes(n)) values.push(n);
    }
    return values.length ? values : null;
  }
  function countMarkers(xml) {
    return (xml.match(/\[\s*\d[\d\s,，、;；\-–—]*\]/g) || []).filter(x=>parseMarker(x)).length;
  }
  function hasAncestor(node, name) {
    for (let p=node.parentNode; p; p=p.parentNode) if (isW(p,name)) return true;
    return false;
  }
  function paragraphText(p) { return descendants(p,'t').map(n=>n.textContent).join(''); }
  function segments(p, initialDepth=0) {
    let text='', spans=[], depth=initialDepth;
    const add = (value, run, eligible, reason, node=null) => {
      if (!value) return;
      spans.push({start:text.length,end:text.length+value.length,run,eligible,reason,node});
      text+=value;
    };
    for (const child of elements(p)) {
      if (isW(child,'pPr')) continue;
      if (isW(child,'r')) {
        for (const node of elements(child)) {
          if (isW(node,'fldChar')) {
            const type=node.getAttributeNS(W,'fldCharType');
            if (type==='begin') depth++;
            if (type==='end') depth=Math.max(0,depth-1);
            add('\uFFFC',null,false,'已有域');
          } else if (isW(node,'t')) {
            add(node.textContent,child,depth===0,depth ? '已有域中的显示文字' : '',node);
          } else if (!isW(node,'rPr')) add('\uFFFC',null,false,'结构边界');
        }
      } else {
        const value=descendants(child,'t').map(n=>n.textContent).join('');
        const reason=isW(child,'hyperlink')?'超链接':isW(child,'fldSimple')?'已有域':isW(child,'sdt')?'内容控件':'非普通正文结构';
        add(value || '\uFFFC',null,false,reason);
        for (const field of descendants(child,'fldChar')) {
          if (field.getAttributeNS(W,'fldCharType')==='begin') depth++;
          if (field.getAttributeNS(W,'fldCharType')==='end') depth=Math.max(0,depth-1);
        }
      }
    }
    return {text,spans,depth};
  }
  function scanDocument(xml, env) {
    const doc=parseXML(xml,env);
    if (!isW(doc.documentElement,'document')) fail('仅支持普通 Transitional DOCX；不支持 Strict OOXML。');
    for (const name of ['ins','del','moveFrom','moveTo']) if (descendants(doc,name).length) fail('文档含修订，请先在副本中接受或拒绝修订。');
    const allInstructions=descendants(doc,'instrText').map(n=>n.textContent).join('');
    const simpleInstructions=descendants(doc,'fldSimple').map(n=>n.getAttributeNS(W,'instr')).join('');
    if (/ZOTERO_|CSL_CITATION|CSL_BIBLIOGRAPHY/.test(allInstructions+simpleInstructions)
      || descendants(doc,'bookmarkStart').some(n=>/^(ZOTERO_|CSL_)/.test(n.getAttributeNS(W,'name')))) fail('已有 Zotero 引用，请直接使用 Word 的 Zotero 刷新；MVP 不混合或重复转换。');
    const paragraphs=descendants(doc,'p');
    const markerParagraphs=paragraphs.filter(p=>paragraphText(p).includes(BIB));
    if (markerParagraphs.length>1) fail('只能有一个参考文献表标记。');
    if (markerParagraphs.some(p=>paragraphText(p).trim()!==BIB || hasAncestor(p,'tbl') || hasAncestor(p,'txbxContent') || hasAncestor(p,'sdt') || hasAncestor(p,'customXml') || elements(p).some(n=>!isW(n,'pPr')&&!isW(n,'r')) || segments(p).spans.some(s=>!s.eligible))) fail('参考文献表标记必须独占正文段落，不能放在表格或其他结构中。');
    const bibIndex=markerParagraphs.length?paragraphs.indexOf(markerParagraphs[0]):-1;
    const heading=paragraphs.findIndex(p=>/^(参考文献|references|bibliography)\s*[:：]?$/i.test(paragraphText(p).trim()));
    if (heading>=0) {
      const tail=paragraphs.slice(heading+1).map(paragraphText).filter(t=>t.trim() && t.trim()!==BIB);
      if (tail.length) fail('检测到手写参考文献或标题后的正文。请先把旧参考文献表替换为独占一行的 '+BIB+'，再扫描。');
    }
    const occurrences=[];
    let depth=0;
    paragraphs.forEach((p,pi)=>{
      // Text-box paragraphs are already represented by their containing drawing paragraph.
      if (hasAncestor(p,'p')) return;
      const initialDepth=depth,s=segments(p,initialDepth); depth=s.depth;
      const pattern=/\[\s*\d[\d\s,，、;；\-–—]*\]/g;
      for (const m of s.text.matchAll(pattern)) {
        const numbers=parseMarker(m[0]); if (!numbers) continue;
        const start=m.index,end=start+m[0].length;
        const touched=s.spans.filter(x=>x.end>start&&x.start<end);
        let reason=touched.find(x=>!x.eligible)?.reason || '';
        if (bibIndex>=0 && pi>bibIndex) reason='参考文献表标记之后的位置';
        if (hasAncestor(p,'txbxContent')) reason='文本框';
        if (hasAncestor(p,'sdt')) reason='内容控件';
        if (hasAncestor(p,'customXml')) reason='自定义 XML 结构';
        occurrences.push({key:`${pi}:${start}:${end}`,paragraph:pi,start,end,raw:m[0],numbers,eligible:!reason,reason,initialDepth,
          context:s.text.slice(Math.max(0,start-32),Math.min(s.text.length,end+32)).replace(/\uFFFC/g,' ')});
        if (occurrences.length>2000) fail('候选位置超过 2000 处，请分篇处理。');
      }
    });
    return {occurrences,numbers:[...new Set(occurrences.filter(x=>x.eligible).flatMap(x=>x.numbers))].sort((a,b)=>a-b),paragraphCount:paragraphs.length,bibliographyMarker:bibIndex>=0,hasBibliographyHeading:heading>=0};
  }
  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g,'');
    // Only a uniqueness identifier, never an authentication token.
    return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  }
  function citationIdentities(item) {
    // The same Zotero reference can be recorded under both http/https or with a
    // trailing slash. Deduplicate by every normalized URI, never by title.
    return [...new Set((item?.uris||[]).map(uri=>String(uri).trim().replace(/^https?:\/\/(www\.)?/i,'').replace(/\/+$/,'')).filter(Boolean))];
  }
  function citationFor(occurrence,mapping) {
    let groups=[];
    for (const n of occurrence.numbers) {
      const item=mapping[n];
      if (!item?.uris?.length || !item.itemData || !item.id) fail(`编号 ${n} 尚未映射到有效 Zotero 条目。`);
      const identities=citationIdentities(item);
      if (!identities.length) fail(`编号 ${n} 的文献 URI 无效。`);
      const matching=groups.filter(group=>identities.some(key=>group.keys.has(key)));
      if(!matching.length){groups.push({item:JSON.parse(JSON.stringify(item)),keys:new Set(identities)});continue;}
      const first=matching[0];
      for(const key of identities)first.keys.add(key);
      const uris=[...first.item.uris,...item.uris];
      for(const other of matching.slice(1)){
        for(const key of other.keys)first.keys.add(key);
        uris.push(...other.item.uris);
      }
      first.item.uris=[...new Set(uris)];
      groups=groups.filter(group=>group===first||!matching.includes(group));
    }
    const citationItems=groups.map(group=>group.item);
    return {citationID:uuid(),properties:{noteIndex:0},citationItems,schema:'https://github.com/citation-style-language/schema/raw/master/csl-citation.json'};
  }
  function textRun(doc,text,rPr) {
    const r=doc.createElementNS(W,'w:r');
    if (rPr) r.appendChild(rPr.cloneNode(true));
    String(text).split(/\r?\n/).forEach((part,i)=>{
      if(i)r.appendChild(doc.createElementNS(W,'w:br'));
      const t=doc.createElementNS(W,'w:t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=part;r.appendChild(t);
    });
    return r;
  }
  function fieldRuns(doc,code,text,rPr) {
    const nodes=[];
    function char(type) {const r=doc.createElementNS(W,'w:r'),f=doc.createElementNS(W,'w:fldChar');f.setAttributeNS(W,'w:fldCharType',type);r.appendChild(f);nodes.push(r);}
    char('begin');
    // Avoid splitting UTF-16 surrogate pairs between instruction nodes.
    let chunk='';
    for(const c of code) {chunk+=c;if(chunk.length>=200){const r=doc.createElementNS(W,'w:r'),i=doc.createElementNS(W,'w:instrText');i.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');i.textContent=chunk;r.appendChild(i);nodes.push(r);chunk='';}}
    if(chunk){const r=doc.createElementNS(W,'w:r'),i=doc.createElementNS(W,'w:instrText');i.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');i.textContent=chunk;r.appendChild(i);nodes.push(r);}
    char('separate');nodes.push(textRun(doc,text,rPr));char('end');return nodes;
  }
  function selectedOccurrences(scan,keys) {
    const wanted=new Set(keys);
    if(!wanted.size)fail('请先勾选要转换的位置。');
    const selected=scan.occurrences.filter(o=>wanted.has(o.key));
    if(selected.length!==wanted.size || selected.some(o=>!o.eligible))fail('所选位置失效或包含受保护结构，请重新扫描。');
    return selected;
  }
  function runSide(run,boundary,offset,before) {
    // Keep tabs, line breaks, drawings and run metadata on their original side of the citation.
    const copy=run.cloneNode(false);let passed=false;
    for(const child of Array.from(run.childNodes)) {
      if(isW(child,'rPr'))copy.appendChild(child.cloneNode(true));
      else if(child===boundary) {
        passed=true;
        const value=before?child.textContent.slice(0,offset):child.textContent.slice(offset);
        if(value){const t=child.cloneNode(false);t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=value;copy.appendChild(t);}
      } else if(before?!passed:passed)copy.appendChild(child.cloneNode(true));
    }
    return Array.from(copy.childNodes).some(n=>!isW(n,'rPr')&&(n.nodeType!==3||n.textContent.trim()))?copy:null;
  }
  function convertDocument(xml,keys,mapping,rendered,env) {
    const scan=scanDocument(xml,env),selected=selectedOccurrences(scan,keys);
    const citations=selected.map(o=>citationFor(o,mapping));
    const doc=parseXML(xml,env),paragraphs=descendants(doc,'p');
    for(let i=selected.length-1;i>=0;i--) {
      const o=selected[i],p=paragraphs[o.paragraph],s=segments(p,o.initialDepth),touched=s.spans.filter(x=>x.end>o.start&&x.start<o.end);
      if(touched.some(x=>!x.eligible)||s.text.slice(o.start,o.end)!==o.raw)fail('文字结构在转换时不一致，已停止。');
      const first=touched[0],last=touched.at(-1),firstRun=first.run,lastRun=last.run;
      const prefix=runSide(firstRun,first.node,o.start-first.start,true),suffix=runSide(lastRun,last.node,o.end-last.start,false);
      const firstPr=elements(firstRun).find(x=>isW(x,'rPr'));
      const citation=citations[i],visible=rendered.citations[o.key];
      if(typeof visible!=='string'||!visible)fail('引用排版结果缺失。');
      citation.properties.plainCitation=visible;
      const replacements=[];
      if(prefix)replacements.push(prefix);
      replacements.push(...fieldRuns(doc,' ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify(citation)+' ',visible,firstPr));
      if(suffix)replacements.push(suffix);
      const toRemove=[];let r=firstRun;
      while(r){toRemove.push(r);if(r===lastRun)break;r=r.nextSibling;}
      if(toRemove.at(-1)!==lastRun)fail('无法定位占位符文字。');
      for(const node of replacements)p.insertBefore(node,firstRun);
      for(const node of toRemove)p.removeChild(node);
    }
    const body=descendants(doc,'body')[0];
    let bibP=paragraphs.find(p=>paragraphText(p).trim()===BIB);
    if(bibP){for(const child of Array.from(bibP.childNodes))if(!isW(child,'pPr'))bibP.removeChild(child);}
    else {
      const section=elements(body).find(n=>isW(n,'sectPr'));
      if(!scan.hasBibliographyHeading){const h=doc.createElementNS(W,'w:p');h.appendChild(textRun(doc,'参考文献'));body.insertBefore(h,section||null);}
      bibP=doc.createElementNS(W,'w:p');body.insertBefore(bibP,section||null);
    }
    for(const node of fieldRuns(doc,' ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY ',rendered.bibliography))bibP.appendChild(node);
    return {xml:serialize(doc,env),count:selected.length,citations,skipped:scan.occurrences.length-selected.length};
  }
  function documentData(styleID,locale,zoteroVersion) {
    return JSON.stringify({sessionID:uuid(),style:{styleID,locale,hasBibliography:true,bibliographyStyleHasBeenSet:false},
      prefs:{fieldType:'Field',noteType:0,automaticJournalAbbreviations:false,delayCitationUpdates:false},zoteroVersion,dataVersion:4});
  }
  function mergeDocumentProperties(old,data,env) {
    const doc=parseXML(old||`<Properties xmlns="${CP}" xmlns:vt="${VT}"/>`,env);
    if(doc.documentElement.namespaceURI!==CP)fail('自定义文档属性格式无效。');
    const props=elements(doc.documentElement);
    if(props.some(p=>/^ZOTERO_PREF/i.test(p.getAttribute('name'))))fail('文档已有 Zotero 设置，MVP 不混合转换。');
    let pid=Math.max(1,...props.map(p=>Number(p.getAttribute('pid'))||0));
    // Word custom property string values are limited to 255 UTF-16 code units.
    let chunks=[],chunk='';
    for(const c of data){if(chunk.length+c.length>255){chunks.push(chunk);chunk='';}chunk+=c;}if(chunk)chunks.push(chunk);
    chunks.forEach((value,i)=>{
      const p=doc.createElementNS(CP,'property');p.setAttribute('fmtid','{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');p.setAttribute('pid',String(++pid));p.setAttribute('name',`ZOTERO_PREF_${i+1}`);
      const v=doc.createElementNS(VT,'vt:lpwstr');v.textContent=value;p.appendChild(v);doc.documentElement.appendChild(p);
    });
    return serialize(doc,env);
  }
  return {W,BIB,parseXML,serialize,parseMarker,countMarkers,scanDocument,citationFor,selectedOccurrences,convertDocument,documentData,mergeDocumentProperties};
});
