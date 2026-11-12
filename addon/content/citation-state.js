/* SPDX-License-Identifier: MIT */
/* Pure citation identity model. No Zotero or Word globals are used here so the
 * same reconciliation rules can be exercised by Node tests and by the live
 * service. References are identified by recorded Zotero URIs, never by title
 * or by a bare local item id. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBCitationState=api;
})(globalThis,function(){
  'use strict';
  const NUMBER=/^[1-9]\d{0,4}$/;
  const MAX_FIELDS=5000,MAX_ITEMS=2000;
  const ITEM_ATTRIBUTES=['locator','label','prefix','suffix','suppress-author','author-only','ignoreRetraction'];
  const normalizedUris=new Map();

  function normalizeUri(value){
    const raw=String(value??'').trim();
    if(normalizedUris.has(raw))return normalizedUris.get(raw);
    if(!/^https?:\/\//i.test(raw))return '';
    let url;try{url=new URL(raw);}catch{return '';}
    if(!url.hostname||/[\s<>]/.test(raw))return '';
    url.protocol='https:';
    url.hostname=url.hostname.toLowerCase().replace(/^www\./,'');
    if(url.port||url.search||url.hash)return '';
    const result=url.toString().replace(/\/+$/,'');
    if(normalizedUris.size>40000)normalizedUris.clear();
    normalizedUris.set(raw,result);return result;
  }
  function uriKeys(record){
    return [...new Set((record?.uris||[]).map(normalizeUri).filter(Boolean))];
  }
  function recordFromItem(item){
    const uris=[];const seen=new Set();
    for(const uri of item?.uris||[]){
      const key=normalizeUri(uri);if(!key||seen.has(key))continue;
      seen.add(key);uris.push(String(uri).trim());
    }
    if(!uris.length||!item?.itemData||item.id===undefined||item.id===null)throw new Error('引用条目缺少有效的 Zotero URI、条目数据或本地 ID。');
    return {id:item.id,uris,itemData:item.itemData};
  }
  function sameRecord(a,b){
    const left=new Set(uriKeys(a));if(!left.size)return false;
    return uriKeys(b).some(key=>left.has(key));
  }
  function referenceKey(record){return uriKeys(record).sort()[0]||'';}

  function parseLedger(raw){
    if(raw===undefined||raw===null||raw==='')return {version:0,entries:{},present:false};
    let data;
    try{data=JSON.parse(raw);}
    catch{throw new Error('文档原编号绑定数据损坏，已停止批量匹配；请恢复文档备份或核查绑定。');}
    if(!data||![1,2].includes(data.version)||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))
      throw new Error('文档原编号绑定数据损坏，已停止批量匹配；请恢复文档备份或核查绑定。');
    for(const [n,entry]of Object.entries(data.entries)){
      if(!NUMBER.test(n)||!Array.isArray(entry?.uris)||!entry.uris.length||entry.uris.some(uri=>typeof uri!=='string'||!normalizeUri(uri))||
        !Array.isArray(entry.citations)||entry.citations.some(id=>typeof id!=='string'||!id)||
        (entry.aliases!==undefined&&(!Array.isArray(entry.aliases)||entry.aliases.some(id=>typeof id!=='string'||!id))))
        throw new Error('文档原编号绑定条目无效。');
    }
    if(data.references!==undefined&&(!data.references||typeof data.references!=='object'||Array.isArray(data.references)))throw new Error('文献身份注册表损坏。');
    if(data.occurrences!==undefined&&!Array.isArray(data.occurrences))throw new Error('引用位置记录损坏。');
    return {...data,version:data.version,entries:data.entries,present:true,transaction:data.transaction||'',revision:Number.isSafeInteger(data.revision)?data.revision:0};
  }

  function parseCitation(code,where){
    const text=String(code||''),at=text.indexOf('CSL_CITATION ');
    if(at<0)throw new Error(`无法读取${where||'已有'} Zotero 引用的绑定，请先用官方插件检查引用字段。`);
    let citation;
    try{citation=JSON.parse(text.slice(at+'CSL_CITATION '.length).trim());}
    catch{throw new Error(`无法读取${where||'已有'} Zotero 引用的绑定，请先用官方插件检查引用字段。`);}
    if(typeof citation?.citationID!=='string'||!citation.citationID||!Array.isArray(citation.citationItems)||
      !citation.citationItems.length||citation.citationItems.length>MAX_ITEMS||
      citation.citationItems.some(item=>!item?.uris?.length||!item.itemData||item.id===undefined||item.id===null))
      throw new Error(`无法读取${where||'已有'} Zotero 引用的绑定，请先用官方插件检查引用字段。`);
    for(const item of citation.citationItems)for(const uri of item.uris)if(!normalizeUri(uri))throw new Error(`引用条目包含无效的 Zotero URI：${String(uri).slice(0,80)}`);
    return citation;
  }

  function parseFields(snapshot){
    if(!snapshot||typeof snapshot.documentKey!=='string'||!snapshot.documentKey||typeof snapshot.fingerprint!=='string'||!snapshot.fingerprint)
      throw new Error('Word 文档快照无效。');
    let raw;
    if(Array.isArray(snapshot.citationFields))raw=snapshot.citationFields;
    else if(Array.isArray(snapshot.citationCodes))raw=snapshot.citationCodes.map((code,index)=>({code,text:snapshot.citationTexts?.[index]||'',index}));
    else raw=[];
    if(raw.length>MAX_FIELDS)throw new Error('文档引用字段超过 5000 个，已停止批量处理。');
    const citations=raw.map((field,index)=>{
      if(!field||typeof field.code!=='string')throw new Error('Word 引用字段快照无效，请重新扫描。');
      const citation=parseCitation(field.code,'');
      const start=Number.isSafeInteger(field.start)?field.start:(Number.isSafeInteger(field.codeStart)?field.codeStart:null);
      const end=Number.isSafeInteger(field.end)?field.end:(Number.isSafeInteger(field.resultEnd)?field.resultEnd:null);
      if(start!==null&&(!Number.isSafeInteger(start)||start<0))throw new Error('Word 引用字段范围无效，请重新扫描。');
      if(end!==null&&(end<=start||!Number.isSafeInteger(end)))throw new Error('Word 引用字段范围无效，请重新扫描。');
      return {
        index,field,citation,citationID:citation.citationID,citationItems:citation.citationItems,
        code:field.code,text:String(field.text??''),
        start,end,codeStart:field.codeStart??start,codeEnd:field.codeEnd??end,resultStart:field.resultStart??start,resultEnd:field.resultEnd??end,
        storyType:Number.isFinite(field.storyType)?field.storyType:1,codeHash:String(field.codeHash||''),
        fieldStart:Number.isSafeInteger(field.fieldStart)?field.fieldStart:start,
        fieldEnd:Number.isSafeInteger(field.fieldEnd)?field.fieldEnd:end,
        textAfter:String(field.textAfter||''),context:String(field.context||''),items:[]
      };
    });
    citations.sort((a,b)=>((a.storyType===1?0:1)-(b.storyType===1?0:1))||
      ((a.start??a.index)-(b.start??b.index))||(a.index-b.index));
    const byId=new Map();
    for(const citation of citations){
      const list=byId.get(citation.citationID)||[];list.push(citation);byId.set(citation.citationID,list);
    }
    return {citations,byId};
  }

  function buildDocumentState(snapshot){
    const ledger=parseLedger(snapshot.bindingData);
    const {citations,byId}=parseFields(snapshot);
    const issues=[];
    for(const [citationID,list]of byId)if(list.length>1){
      issues.push({code:'duplicate-citation-id',severity:'error',blocking:true,citationID,
        message:`引用域标识 ${citationID} 在 ${list.length} 个字段中重复，无法判断哪一处是原引用。`,
        action:'请在 Word 中用 Zotero 原生 Add/Edit Citation 核对，并保留文档备份。'});
    }
    // Native URI arrays are evidence of aliases. Union them before allocating
    // references, otherwise a later bridging record leaves duplicate identities.
    const parents=new Map();
    function find(key){if(!parents.has(key))parents.set(key,key);let root=key;while(parents.get(root)!==root)root=parents.get(root);while(parents.get(key)!==key){const next=parents.get(key);parents.set(key,root);key=next;}return root;}
    function join(record){const keys=uriKeys(record).sort();if(!keys.length)return;const roots=keys.map(find).sort(),root=roots[0];for(const r of roots)parents.set(r,root);}
    for(const citation of citations)for(const item of citation.citationItems)join(item);
    for(const entry of Object.values(ledger.entries))join(entry);
    for(const ref of Object.values(ledger.references||{}))join(ref);
    for(const alias of snapshot.uriAliases||[])join(alias);
    const identityGroups=new Map();
    for(const key of parents.keys()){const root=find(key),keys=identityGroups.get(root)||[];keys.push(key);identityGroups.set(root,keys);}
    const preferred=new Map();
    for(const [id,record]of Object.entries(ledger.references||{}))for(const key of uriKeys(record)){
      const root=find(key),previous=preferred.get(root);if(!previous||id<previous)preferred.set(root,id);
    }
    const references=[],byUri=new Map(),byRoot=new Map();
    function identify(item,citation){
      const record=recordFromItem(item),keys=uriKeys(record);
      const root=find(keys[0]);let ref=byRoot.get(root);
      if(!ref){
        const group=identityGroups.get(root)||keys;
        ref={referenceId:preferred.get(root)||[...group].sort()[0],keys:new Set(group),uris:[],itemData:record.itemData,occurrences:[],record};
        references.push(ref);byRoot.set(root,ref);
        for(const key of group)byUri.set(key,ref);
      }
      for(const key of keys)byUri.set(key,ref);
      for(const key of keys)ref.keys.add(key);
      for(const uri of record.uris)if(!ref.uris.some(other=>normalizeUri(other)===normalizeUri(uri)))ref.uris.push(uri);
      const resolved={item,record,ref,attributes:itemAttributes(item)};
      ref.occurrences.push({citation,item:resolved,display:null});
      return resolved;
    }
    for(const citation of citations){
      citation.items=citation.citationItems.map(item=>identify(item,citation));
      citation.references=[];
      for(const item of citation.items)if(!citation.references.includes(item.ref))citation.references.push(item.ref);
      const old=(ledger.occurrences||[]).find(o=>o.citationID===citation.citationID);
      citation.occurrenceId=old?.occurrenceId||'citation:'+citation.citationID;
    }
    const entries={},mapping={},conflicts=[],retired=[],carrierChanges=[],conflictDetails={};
    const active=new Map(); // number -> {record,citations,aliases}
    for(const [n,entry]of Object.entries(ledger.entries)){
      const sameId=[];
      for(const id of entry.citations)for(const citation of byId.get(id)||[])if(!sameId.includes(citation))sameId.push(citation);
      const reference=uriKeys(entry).map(key=>byUri.get(key)).find(Boolean);
      const uriHits=reference?.occurrences||[];
      let activeEntry=null;
      if(sameId.length){
        const missing=sameId.filter(citation=>!citation.items.some(item=>item.ref===reference));
        if(missing.length){
          conflicts.push(Number(n));
          const current=missing[0];
          conflictDetails[n]={number:Number(n),previous:{uris:[...entry.uris],itemData:null},current:current.items[0]?.record||null,citationID:current.citationID,
            text:current.text,location:locationText(current)};
          issues.push({code:'reference-replaced',severity:'error',blocking:true,number:Number(n),citationID:current.citationID,
            location:locationText(current),referenceId:referenceKey(entry),
            message:`编号 [${n}] 的引用内容与已记录文献不同：原为《${entryTitle(entry)}》，现为《${current.items[0]?.record?.itemData?.title||current.text||'未知文献'}》。`,
            action:'请确认这是 Zotero 中的显式替换；若不是，请撤销并保留文档备份。'});
          continue;
        }
        const hit=uriHits[0].item;
        activeEntry={record:hit.record,reference,citations:[...new Set(uriHits.map(hit=>hit.citation.citationID))],aliases:[...(entry.aliases||[])],carrierChanged:false};
      }else if(uriHits.length){
        const hit=uriHits[0];
        activeEntry={record:hit.item.record,reference,citations:[...new Set(uriHits.map(x=>x.citation.citationID))],aliases:[...(entry.aliases||[]),...entry.citations],carrierChanged:true};
        carrierChanges.push(Number(n));
        issues.push({code:'citation-carrier-changed',severity:'warning',blocking:false,number:Number(n),
          citationID:activeEntry.citations.join(','),location:locationText(hit.citation),referenceId:referenceKey(entry),
          message:`文献仍在，但引用域已重建或合并：原标签 [${n}]《${entryTitle(entry)}》现在由 ${locationText(hit.citation)} 承载。`,
          action:'可核对后同步记录；不会更改正文文献或重排编号。'});
      }else{
        retired.push(Number(n));
        issues.push({code:'reference-uncited',severity:'info',blocking:false,number:Number(n),referenceId:referenceKey(entry),
          message:`原编号 [${n}]《${entryTitle(entry)}》在正文中已找不到对应引用。`,
          action:'如为误删，请撤销；同步后将释放该历史标签。'});
        continue;
      }
      active.set(n,activeEntry);
    }
    for(const [n,entry]of active){
      const record=entry.record;
      mapping[n]={id:record.id,uris:[...record.uris],itemData:record.itemData};
      entries[n]={referenceId:entry.reference.referenceId,uris:[...new Set([...entry.reference.uris,...(ledger.entries[n]?.uris||[])])],citations:[...new Set(entry.citations)],
        ...(entry.aliases.length?{aliases:[...new Set(entry.aliases)]}:{}),...(entry.carrierChanged?{state:'carrier-changed'}:{})};
    }
    const tracked=new Set([...active.values()].map(entry=>entry.reference));
    const untracked=references.filter(ref=>!tracked.has(ref)&&!ledger.references?.[ref.referenceId]).map(ref=>({record:ref.record,
      citations:[...new Set(ref.occurrences.map(o=>o.citation.citationID))],locations:[...new Set(ref.occurrences.map(o=>locationText(o.citation)))]}));
    for(const group of untracked)issues.push({code:'untracked-reference',severity:'info',blocking:false,
      referenceId:referenceKey(group.record),
      message:`正文中的《${group.record.itemData?.title||group.record.uris[0]}》没有历史编号记录。`,
      action:'这是原生新增引用，不算错误；如需为手写编号匹配文献，可直接选择。'});
    const display=displayLabels(citations),displayOwners=new Map();
    for(const ref of references){
      const labels=new Set((display.get(ref.referenceId)||[]).map(x=>x.display).filter(n=>Number.isInteger(n)&&n>0));
      for(const n of labels){const owners=displayOwners.get(n)||[];if(!owners.includes(ref))owners.push(ref);displayOwners.set(n,owners);}
    }
    return {snapshot,ledger,ledgerVersion:ledger.version,ledgerPresent:ledger.present,citations,references,byUri,entries,mapping,conflicts,conflictDetails,
      retired,carrierChanges,untracked,issues,display,displayOwners};
  }

  function itemAttributes(item){
    const result={};
    for(const key of ITEM_ATTRIBUTES){
      let value=item[key];
      if(key==='suppress-author')value=value??item.suppressAuthor;
      if(key==='author-only')value=value??item.authorOnly;
      if(value!==undefined&&value!==null&&value!==''&&value!==false)result[key]=value;
    }
    return result;
  }
  function entryTitle(entry){return entry?.uris?.[0]||'未知文献';}
  function locationText(citation){
    if(!citation)return '正文';
    if(Number.isSafeInteger(citation.start))return `字符位置 ${citation.start}`;
    return `第 ${citation.index+1} 个引用域`;
  }
  function displayLabels(citations){
    const result=new Map();
    for(const citation of citations||[]){
      const text=String(citation.text||'');
      const markers=[...text.matchAll(/\[\s*\d[\d\s,，、;；\-–—]*\]/g)].map(match=>numberList(match[0]));
      const numbers=markers.flat();
      citation.items.forEach((item,index)=>{
        const display=numbers.length===citation.items.length?numbers[index]:numbers.join(',');
        item.display=display;
        const list=result.get(item.ref.referenceId)||[];
        list.push({display,text,citationID:citation.citationID,location:locationText(citation)});
        result.set(item.ref.referenceId,list);
      });
    }
    return result;
  }
  function numberList(raw){
    const body=String(raw).replace(/^\[|\]$/g,'');
    const out=[];
    for(const part of body.split(/[,，、;；]/)){
      const range=part.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
      if(range){const a=Number(range[1]),b=Number(range[2]);if(a<=b&&b-a<=999)for(let n=a;n<=b;n++)out.push(n);}
      else if(/^\d+$/.test(part.trim()))out.push(Number(part.trim()));
    }
    return out;
  }

  /* First-use order is the order Word/Zotero will number citations after the
   * planned insertions, independent of the old label numbers. Existing fields
   * stay in place; selected markers are inserted at their document positions. */
  function deriveFirstUseOrder(state,markers,mapping){
    const events=[];
    for(const citation of state.citations)events.push({start:citation.start??citation.index,order:citation.start??citation.index,type:'field',citation});
    for(const marker of markers||[]){
      const start=Number.isSafeInteger(marker.start)?marker.start:Number.MAX_SAFE_INTEGER;
      events.push({start,order:start,type:'marker',marker});
    }
    events.sort((a,b)=>a.start-b.start||a.order-b.order);
    let order=[];
    function add(record,via){
      if(!record)return;
      const matching=order.filter(other=>sameRecord(other,record));
      if(!matching.length){
        order.push({referenceId:referenceKey(record),title:record.itemData?.title||record.uris?.[0]||'',uris:[...record.uris],via});
        return;
      }
      // A merged library item can connect two references encountered earlier.
      // Keep the earliest entry, but carry every alias into subsequent matches.
      const first=matching[0];
      first.uris=[...new Set([...first.uris,...record.uris,...matching.slice(1).flatMap(other=>other.uris)])];
      order=order.filter(other=>other===first||!matching.includes(other));
    }
    for(const event of events){
      if(event.type==='field'){for(const item of event.citation.items)add(item.record,'existing');}
      else{
        for(const n of event.marker.numbers){
          const record=mapping?.[n];
          if(!record)throw new Error(`编号 [${n}] 尚未映射到有效 Zotero 条目。`);
          add(record,'inserted');
        }
      }
    }
    return {order:order.map((entry,index)=>({number:index+1,...entry}))};
  }

  function stateFromFields(fields){
    return buildDocumentState({documentKey:'verify',fingerprint:'verify',bindingData:'',citationFields:fields});
  }

  /* Completeness check after Word/Zotero has refreshed the document. */
  function verifyTransition(before,after,plan={}){
    const expected=plan.expected||{},allowedNew=expected.newReferences||[],allowedKeys=new Set();
    for(const record of allowedNew)for(const key of uriKeys(record))allowedKeys.add(key);
    for(const merge of expected.merges||[])for(const record of merge.references||[])for(const key of uriKeys(record))allowedKeys.add(key);
    const beforeKeys=allRefKeys(before),afterKeys=allRefKeys(after);
    const issues=after.issues.filter(issue=>issue.blocking&&!(issue.code==='reference-replaced'&&
      (expected.graph||expected.confirmedReplacements?.some(label=>label.number===issue.number)))).map(issue=>({...issue}));
    // Compare identities through the complete set of recorded aliases, not the
    // first URI of either snapshot. A valid URI reorder is not a replacement.
    const aliases=new Map();
    for(const ref of [...before.references,...after.references])for(const key of ref.keys){
      const group=[...ref.keys].map(k=>aliases.get(k)||k).sort()[0];
      for(const k of ref.keys)aliases.set(k,group);
    }
    const canonical=record=>uriKeys(record).map(key=>aliases.get(key)||key).sort()[0]||'';
    const equivalent=(a,b)=>sameRecord(a,b)||canonical(a)===canonical(b);
    const oldRefs=[...before.references],newRefs=[...after.references];
    for(const [key,title]of beforeKeys)if(!newRefs.some(ref=>equivalent(oldRefs.find(r=>r.referenceId===key),ref))&&!(expected.removedReferences||[]).some(record=>uriKeys(record).includes(key)))
      issues.push({code:'reference-lost',severity:'error',blocking:true,referenceId:key,
        message:`原有引用《${title}》在提交后消失。`,action:'请撤销本次操作并核对文档备份。'});
    for(const [key,title]of afterKeys)if(!oldRefs.some(ref=>equivalent(newRefs.find(r=>r.referenceId===key),ref))&&!allowedKeys.has(key)&&!allowedNew.some(record=>equivalent(record,newRefs.find(r=>r.referenceId===key))))
      issues.push({code:'unexpected-reference',severity:'error',blocking:true,referenceId:key,
        message:`提交后出现了计划外的引用《${title}》。`,action:'请撤销本次操作并核对文档备份。'});
    for(const merge of expected.graph?[]:expected.merges||[]){
      const keys=(merge.references||[]).map(referenceKey);
      const citation=after.citations.find(c=>keys.every(key=>c.items.some(item=>item.ref.keys.has(key))));
      if(!citation){
        issues.push({code:'merged-field-missing',severity:'error',blocking:true,citationID:merge.citationID,
          message:'合并后的引用域未找到原引用与新增文献。',action:'请用 Zotero Add/Edit Citation 核对，不要重复插入。'});
        continue;
      }
      const actual=[];
      for(const item of citation.items)if(keys.includes(item.ref.referenceId)&&!actual.includes(item.ref.referenceId))actual.push(item.ref.referenceId);
      const wanted=(merge.order||keys);
      if(actual.join('|')!==wanted.join('|'))
        issues.push({code:'item-order-inverted',severity:'error',blocking:true,citationID:citation.citationID,location:locationText(citation),
          message:`引用域内的文献顺序与计划不同：预期 ${wanted.map((key,index)=>`[${index+1}] ${titleFor(after,key)}`).join('、')}，实际 ${actual.map(key=>titleFor(after,key)).join('、')}。`,
          action:'文献顺序会影响首次引用编号；请用 Zotero Add/Edit Citation 调整顺序，勿仅改显示数字。'});
    }
    const wanted=expected.graph?.citations||legacyExpected(before,plan);
    if(wanted.length!==after.citations.length)issues.push({code:'citation-count-changed',severity:'error',blocking:true,
      message:`引用位置数量与计划不一致：应为 ${wanted.length} 个引用域，实际 ${after.citations.length} 个。`,action:'已停止最终化；请核对本次操作或恢复备份，勿重复插入。'});
    for(let index=0;index<Math.min(wanted.length,after.citations.length);index++){
      const want=wanted[index],actual=after.citations[index],items=want.items||want.citationItems||[];
      if(items.length!==actual.items.length){
        issues.push({code:'citation-items-changed',severity:'error',blocking:true,citationID:actual.citationID,
          location:locationText(actual),message:`${locationText(actual)} 的文献项数量不一致：应为 ${items.length} 项，实际 ${actual.items.length} 项。`,action:'请核对该处引用；其他位置仍有同文献不能证明此处完整。'});
        continue;
      }
      const nativeRecord=item=>Array.isArray(item.uris)?item:item.record||item.item||item;
      const identities=items.map(item=>canonical(nativeRecord(item)));
      const actualIdentities=actual.items.map(item=>canonical(item.record));
      const orderOnly=identities.join('|')!==actualIdentities.join('|')&&[...identities].sort().join('|')===[...actualIdentities].sort().join('|');
      if(orderOnly)issues.push({code:'item-order-inverted',severity:'error',blocking:true,citationID:actual.citationID,location:locationText(actual),
        message:`${locationText(actual)} 的文献顺序与计划不同。`,action:'已停止最终化，请核对首次引用顺序。'});
      for(let i=0;i<items.length;i++){
        const item=nativeRecord(items[i]),found=actual.items[i];
        if(!equivalent(item,found.record)&&!orderOnly)issues.push({code:'citation-identity-changed',severity:'error',blocking:true,citationID:actual.citationID,
          location:locationText(actual),message:`${locationText(actual)} 第 ${i+1} 项文献或顺序与计划不同。`,action:'请核对引用身份和位置，不能只修改显示数字。'});
        else if(equivalent(item,found.record)&&!sameAttributes(itemAttributes(item),found.attributes))issues.push({code:'item-attributes-changed',severity:'error',blocking:true,citationID:actual.citationID,
          location:locationText(actual),message:`${locationText(actual)} 的页码、前后缀或作者显示属性与计划不同。`,action:'已停止最终化；请保留并核对原引用项属性。'});
      }
    }
    const actualSkeleton=skeletonOf(after.snapshot),beforeBibliographies=expected.beforeBibliographyCount??before.snapshot?.bibliographyCount??0;
    const afterBibliographies=after.snapshot?.bibliographyCount??beforeBibliographies;
    const bibliographyAllowed=expected.allowBibliography&&beforeBibliographies===0&&afterBibliographies===1;
    if(afterBibliographies!==beforeBibliographies&&!bibliographyAllowed)issues.push({code:'bibliography-count-changed',severity:'error',blocking:true,
      message:'参考文献表数量发生了计划外变化。',action:'请保留文档并核对原生参考文献表。'});
    if(expected.graph?.skeleton!==undefined&&expected.graph.skeleton!==actualSkeleton&&!(bibliographyAllowed&&withoutNewBibliography(actualSkeleton).includes(expected.graph.skeleton)))issues.push({code:'outside-content-changed',severity:'error',blocking:true,
      message:'引用组以外的正文或其他字段发生了计划外变化。',action:'已停止最终化，请核对操作前后的文档副本。'});
    const counts={fields:after.citations.length,beforeFields:before.citations.length,distinctReferences:afterKeys.size,citationPositions:after.citations.reduce((n,c)=>n+c.items.length,0)};
    return {ok:!issues.some(issue=>issue.blocking),issues,counts};
  }
  function withoutNewBibliography(skeleton){
    if(!skeleton)return [];
    const tokens=JSON.parse(skeleton),at=tokens.findIndex(token=>token[0]==='bibliography');if(at<0)return [];
    const variants=[];
    for(let left=0;left<=2;left++)for(let right=0;right<=2;right++){
      const copy=tokens.map(token=>[...token]);
      if(left){if(copy[at-1]?.[0]!=='text'||!copy[at-1][1].endsWith('\r'.repeat(left)))continue;copy[at-1][1]=copy[at-1][1].slice(0,-left);}
      if(right){if(copy[at+1]?.[0]!=='text'||!copy[at+1][1].startsWith('\r'.repeat(right)))continue;copy[at+1][1]=copy[at+1][1].slice(right);}
      copy.splice(at,1);const merged=[];
      for(const token of copy){if(token[0]==='text'&&!token[1])continue;if(token[0]==='text'&&merged.at(-1)?.[0]==='text')merged.at(-1)[1]+=token[1];else merged.push(token);}
      variants.push(JSON.stringify(merged));
    }
    return variants;
  }
  function legacyExpected(before,plan){
    const nodes=before.citations.map(c=>({start:c.start??c.index,citationID:c.citationID,items:c.citationItems}));
    const operations=plan.operations||[];
    if(operations.length){
      const removed=new Set(operations.flatMap(op=>(op.sourceFields||[]).map(field=>field.citationID)));
      const kept=nodes.filter(node=>!removed.has(node.citationID));
      for(const op of operations){const citation=parseCitation(op.code);kept.push({start:op.start,citationID:citation.citationID,items:citation.citationItems});}
      return kept.sort((a,b)=>a.start-b.start);
    }
    for(const merge of plan.expected?.merges||[]){
      const at=nodes.findIndex(node=>node.citationID===merge.citationID);
      const ordered=(merge.order||merge.references.map(referenceKey)).map(key=>merge.references.find(record=>referenceKey(record)===key)).filter(Boolean);
      if(at>=0)nodes[at]={...nodes[at],items:ordered};else nodes.push({items:ordered});
    }
    return nodes;
  }
  function allRefKeys(state){const map=new Map();for(const reference of state.references)map.set(reference.referenceId,reference.itemData?.title||reference.uris[0]||'');return map;}
  function titleFor(state,key){return state.references.find(ref=>ref.referenceId===key)?.itemData?.title||key;}
  function findOldItem(before,item){
    for(const citation of before.citations)for(const candidate of citation.items)if(referenceKey(candidate.record)===referenceKey(item.record))return candidate;
    return null;
  }
  function sameAttributes(a,b){
    const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
    for(const key of keys)if(JSON.stringify(a?.[key])!==JSON.stringify(b?.[key]))return false;
    return true;
  }

  function syncAfterVerification(before,after,plan={}){
    const entries={};const expected=plan.expected||{};
    const labels=new Map();
    for(const [n,entry]of Object.entries(before.entries))labels.set(n,{record:{uris:entry.uris,itemData:null},citations:entry.citations,aliases:entry.aliases||[]});
    for(const label of expected.newNumbers||[])labels.set(String(label.number),{record:label.record,citations:[],aliases:[]});
    for(const [n,label]of labels){
      const reference=uriKeys(label.record).map(key=>after.byUri.get(key)).find(Boolean);
      const matches=reference?[...new Set(reference.occurrences.map(o=>o.citation))]:[];
      if(!matches.length)continue;
      const record=matches[0].items.find(item=>sameRecord(label.record,item.record)).record;
      const citations=[...new Set(matches.map(citation=>citation.citationID))];
      const ref=after.byUri.get(uriKeys(record)[0]);
      entries[n]={referenceId:ref.referenceId,uris:[...new Set([...ref.uris,...label.record.uris])],citations,
        ...(label.aliases.length||label.citations.some(id=>!citations.includes(id))?{aliases:[...new Set([...label.aliases,...label.citations.filter(id=>!citations.includes(id))])]}:{})};
    }
    const references=Object.fromEntries(after.references.map(ref=>[ref.referenceId,{uris:[...ref.uris]}]));
    const occurrences=after.citations.map(citation=>({occurrenceId:citation.occurrenceId,citationID:citation.citationID,
      items:citation.items.map(item=>({referenceId:item.ref.referenceId,...item.attributes}))}));
    const ledger={version:2,revision:(before.ledger.revision||0)+1,entries,references,occurrences};
    return {...ledger,bindingData:JSON.stringify(ledger)};
  }

  function graphOf(state){return {citations:state.citations.map(c=>({citationID:c.citationID,occurrenceId:c.occurrenceId,
    items:c.citationItems.map(item=>({id:item.id,uris:[...item.uris],itemData:{id:item.id,title:item.itemData?.title||'',type:item.itemData?.type||'article'},...itemAttributes(item)}))})),
    ...(Array.isArray(state.snapshot?.bodySegments)?{skeleton:skeletonOf(state.snapshot)}:{})};}
  function skeletonOf(snapshot,operations=[]){
    if(!Array.isArray(snapshot?.bodySegments))return undefined;
    const ops=[...operations].sort((a,b)=>a.start-b.start),pieces=[];
    for(const segment of snapshot.bodySegments){
      if(segment.kind==='text'){
        let cursor=segment.start;
        for(const op of ops){
          if(op.end<=cursor||op.start>=segment.end)continue;
          if(op.start>cursor)pieces.push({start:cursor,kind:'text',text:segment.text.slice(cursor-segment.start,op.start-segment.start)});
          cursor=Math.max(cursor,Math.min(segment.end,op.end));
        }
        if(cursor<segment.end)pieces.push({start:cursor,kind:'text',text:segment.text.slice(cursor-segment.start)});
      }else if(!ops.some(op=>op.start<=segment.start&&op.end>=segment.end))pieces.push(segment);
    }
    for(const op of ops)pieces.push({start:op.start,kind:'citation'});
    pieces.sort((a,b)=>a.start-b.start);
    const tokens=[];
    for(const piece of pieces){
      if(piece.kind==='text'){
        if(tokens.at(-1)?.[0]==='text')tokens.at(-1)[1]+=piece.text;else if(piece.text)tokens.push(['text',piece.text]);
      }else tokens.push([piece.kind,piece.kind==='field'?piece.signature||'':'']);
    }
    return JSON.stringify(tokens);
  }
  function expectedGraph(state,operations){
    const graph={citations:legacyExpected(state,{operations}).map(c=>({citationID:c.citationID,items:c.items.map(item=>({id:item.id,uris:[...item.uris],
      itemData:{id:item.id,title:item.itemData?.title||'',type:item.itemData?.type||'article'},...itemAttributes(item)}))}))};
    const skeleton=skeletonOf(state.snapshot,operations);if(skeleton!==undefined)graph.skeleton=skeleton;return graph;
  }

  return {normalizeUri,uriKeys,recordFromItem,sameRecord,referenceKey,parseLedger,parseCitation,parseFields,
    buildDocumentState,displayLabels,deriveFirstUseOrder,verifyTransition,syncAfterVerification,numberList,ITEM_ATTRIBUTES,
    itemAttributes,sameAttributes,graphOf,skeletonOf,expectedGraph};
});
