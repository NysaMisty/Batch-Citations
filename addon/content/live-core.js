/* SPDX-License-Identifier: MIT */
(function(root,factory){
  const api=factory(typeof module==='object'?require('./core.js'):root.ZBCore,
    typeof module==='object'?require('./citation-state.js'):root.ZBCitationState);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBLiveCore=api;
})(globalThis,function(core,stateAPI){
  'use strict';
  function documentSettings(data,parseLegacy,snapshot){
    if(!data)return null;
    let settings;
    try{settings=data.trim().startsWith('{')?JSON.parse(data):parseLegacy?.(data);}
    catch{throw new Error('无法读取当前文档的 Zotero 设置，请先使用官方插件检查文档。');}
    // Zotero can save an empty legacy <prefs/> after a cancelled first-use
    // dialog. This is not evidence of Bookmark fields. Initialize it only when
    // the Word snapshot positively excludes all native citation carriers.
    if(settings&&!settings.prefs?.fieldType&&!settings.prefs?.noteType&&!settings.style?.styleID&&
      snapshot?.hasZoteroBookmarks===false&&Array.isArray(snapshot.citationFields)&&!snapshot.citationFields.length&&
      !snapshot.citationCodes?.length&&!snapshot.bibliographyCount&&!snapshot.unsupportedCitationStories?.length&&
      !snapshot.bindingData&&!snapshot.pendingTransaction)return null;
    if(!settings||settings.prefs?.fieldType!=='Field')throw new Error('实时批量功能要求标准 Word Field 引用域；请先使用官方插件检查文档设置或转换书签。');
    if(settings.prefs.noteType)throw new Error('实时批量编号不支持脚注或尾注型文档。');
    return settings;
  }
  function scan(snapshot){
    if(!snapshot||typeof snapshot.documentKey!=='string'||!snapshot.documentKey||typeof snapshot.fingerprint!=='string'||!snapshot.fingerprint)throw new Error('Word 文档快照无效。');
    if(!Array.isArray(snapshot.candidates)||snapshot.candidates.length>2000)throw new Error('Word 候选位置超过限制或格式无效。');
    let previous=-1;
    const occurrences=[...snapshot.candidates].sort((a,b)=>a.start-b.start).map((c,index)=>{
      if(!Number.isSafeInteger(c.start)||!Number.isSafeInteger(c.end)||c.start<0||c.end<=c.start||c.start<previous)throw new Error('Word 范围无效或重叠，请重新扫描。');
      previous=c.end;
      const numbers=core.parseMarker(c.raw);
      return {...c,key:`${c.start}:${c.end}`,numbers:numbers||[],paragraph:index,eligible:!!numbers&&c.eligible===true,
        unsupported:!numbers,reason:!numbers?'不支持此编号结构；仅支持 1～99999、递增跨度不超过 100 的范围及最多 200 项的组合。'+(c.reason?' '+c.reason:''):c.reason||'',context:String(c.context||'').slice(0,300)};
    });
    return {occurrences,unsupportedCount:occurrences.filter(o=>o.unsupported).length,numbers:[...new Set(occurrences.filter(o=>o.eligible).flatMap(o=>o.numbers))].sort((a,b)=>a-b)};
  }
  function documentState(snapshot){return stateAPI.buildDocumentState(snapshot);}
  function restoreBindings(snapshot){
    const state=documentState(snapshot);
    return {
      mapping:state.mapping,entries:state.entries,untracked:state.untracked,conflicts:state.conflicts,
      conflictDetails:state.conflictDetails,retired:state.retired,carrierChanges:state.carrierChanges,
      issues:state.issues,display:state.display,state,ledgerVersion:state.ledgerVersion,
      requiresMigration:state.conflicts.length>0||state.issues.some(issue=>issue.blocking),
      legacyUnlabeled:!snapshot.bindingData&&state.citations.length>0
    };
  }
  function mergeBindings(current,incoming,bindings){
    const conflicts=new Set((bindings.conflicts||[]).map(Number));
    for(const [n,record]of Object.entries(incoming||{})){
      if(!/^[1-9]\d{0,4}$/.test(n))throw new Error('引用编号必须是 1 至 99999 的整数。');
      if(!record?.uris?.length)throw new Error(`编号 [${n}] 尚未映射到有效 Zotero 条目。`);
      if(bindings.mapping[n]&&!stateAPI.sameRecord(bindings.mapping[n],record))
        throw new Error(`原编号 [${n}] 已绑定文献，普通匹配不能更换；请使用 Zotero 的引用编辑。`);
      if(conflicts.has(Number(n)))
        throw new Error(`原编号 [${n}] 的引用内容与绑定不一致，请先核对并明确恢复绑定，普通匹配不会覆盖。`);
    }
    // A reference may legitimately serve several historical labels (for example
    // the same book printed as [3] in one paragraph and [5] in another).
    return {...bindings.mapping,...current,...incoming};
  }
  function styleCitation(occurrence,mapping,citationID){
    const citation=core.citationFor(occurrence,mapping);
    if(citationID)citation.citationID=citationID;
    return citation;
  }
  function gapAllowed(field,occurrence){
    if(!field||!Number.isSafeInteger(field.end))return false;
    const gapLength=occurrence.start-field.end;
    if(gapLength<0)return false;
    if(gapLength===0)return true;
    const after=String(field.textAfter||'');
    if(gapLength>after.length)return false;
    return /^[\t \u00A0,，;；、]*$/.test(after.slice(0,gapLength));
  }
  function labelAllocator(bindings,entries,reservedNumbers){
    const occupied=()=>[...new Set([...Object.keys(entries),...Object.keys(bindings.mapping),...(bindings.conflicts||[])].map(Number))];
    return function(record,preferred){
      const number=Number(preferred),label=String(number);
      // Free original labels remain distinct even when their references match.
      // Only a label already owned by a different historical reference needs
      // allocation through that reference (for a confirmed current-number use).
      if(entries[label]&&stateAPI.sameRecord(entries[label],record))return [label];
      if(!occupied().includes(number))return [label];
      const existing=Object.keys(entries).filter(label=>stateAPI.sameRecord(entries[label],record));
      if(existing.length)return existing;
      const bound=Object.keys(bindings.mapping).filter(label=>stateAPI.sameRecord(bindings.mapping[label],record));
      if(bound.length)return bound;
      // A marker such as [2] is a document position, not the historical label 2.
      // Prefer that number only when it is entirely unused; otherwise allocate a
      // fresh label so the existing reference keeps its recorded identity.
      const used=new Set([...occupied(),...reservedNumbers].map(Number));
      let next=Math.max(0,...occupied())+1;
      while(used.has(next))next++;
      if(next>99999){next=1;while(next<=99999&&used.has(next))next++;}
      if(next>99999)throw new Error('没有可用的原编号，无法安全保存文献映射。');
      return [String(next)];
    };
  }
  function buildMergeGroups(snapshot,bindings,selected,mapping,entries,expected,labelFor){
    const clone=value=>JSON.parse(JSON.stringify(value));
    const nodes=[...bindings.state.citations.filter(c=>Number.isSafeInteger(c.fieldStart)&&Number.isSafeInteger(c.fieldEnd))
      .map(c=>({type:'field',start:c.fieldStart,end:c.fieldEnd,textAfter:c.textAfter,source:c})),
      ...selected.map(o=>({type:'marker',start:o.start,end:o.end,textAfter:o.textAfter||'',source:o}))].sort((a,b)=>a.start-b.start);
    const groups=[];
    for(const node of nodes){const group=groups.at(-1);if(group&&gapAllowed(group.at(-1),node))group.push(node);else groups.push([node]);}
    const operations=[];
    for(const group of groups){
      const fields=group.filter(n=>n.type==='field').map(n=>n.source),markers=group.filter(n=>n.type==='marker').map(n=>n.source);
      if(group.length<2)continue;
      if(!fields.length){
        const citation=core.citationFor({numbers:markers.flatMap(o=>o.numbers)},mapping);
        const raw=group.map((node,index)=>(index?group[index-1].textAfter.slice(0,node.start-group[index-1].end):'')+node.source.raw).join('');
        for(const marker of markers){
          marker.merged=true;
          for(const n of marker.numbers)for(const label of labelFor(mapping[n],n)){
            const entry=entries[label]||={uris:[...mapping[n].uris],citations:[]};
            if(!entry.citations.includes(citation.citationID))entry.citations.push(citation.citationID);
            expected.newNumbers.push({number:Number(label),displayNumber:Number(n),record:mapping[n]});
          }
        }
        const records=citation.citationItems.map(stateAPI.recordFromItem);
        expected.merges.push({citationID:citation.citationID,sourceIDs:[],references:records,order:records.map(stateAPI.referenceKey)});
        operations.push({kind:'insert',start:group[0].start,end:group.at(-1).end,raw,text:raw,citationID:citation.citationID,code:'ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify(citation)});
        continue;
      }
      for(const source of fields)if(source.citation.properties?.dontUpdate||source.citation.properties?.custom)
        throw new Error(`引用域 ${source.citationID} 含手工或自定义显示，不能自动合并；请先用 Zotero 核对该组。`);
      for(const source of fields)if(source.citation.properties?.plainCitation&&String(source.citation.properties.plainCitation).trim()!==source.text.trim())
        throw new Error(`引用域 ${source.citationID} 的显示经过手工编辑，不能自动合并；请先用 Zotero 核对。`);
      const base=fields[0],citation=clone(base.citation),items=[],records=[],seenItems=new Set();
      const keyOf=record=>stateAPI.uriKeys(record).map(uri=>bindings.state.byUri.get(uri)?.referenceId).find(Boolean)||stateAPI.referenceKey(record);
      function add(item){
        const record=stateAPI.recordFromItem(item),key=keyOf(record)+'|'+JSON.stringify(stateAPI.itemAttributes(item));
        if(!seenItems.has(key)){items.push(clone(item));seenItems.add(key);}
        if(!records.some(r=>keyOf(r)===keyOf(record)))records.push(record);
      }
      for(const node of group){
        if(node.type==='field'){for(const item of node.source.citationItems)add(item);continue;}
        for(const n of node.source.numbers){
          const record=mapping[n];if(!record)throw new Error(`编号 [${n}] 尚未映射到有效 Zotero 条目。`);
          add(record);
          for(const label of labelFor(record,n)){
            const entry=entries[label]||={uris:[...record.uris],citations:[]};
            if(!entry.citations.includes(base.citationID))entry.citations.push(base.citationID);
            expected.newNumbers.push({number:Number(label),displayNumber:Number(n),record});
          }
        }
        node.source.merged=true;
      }
      citation.citationItems=items;
      const gaps=group.slice(1).map((node,i)=>({start:group[i].end,end:node.start,text:group[i].textAfter.slice(0,node.start-group[i].end)}));
      operations.push({kind:'mergeAdjacent',start:group[0].start,end:group.at(-1).end,
        markers:markers.map(o=>({start:o.start,end:o.end,raw:o.raw})),gaps,
        sourceFields:fields.map(c=>({start:c.codeStart,end:c.resultEnd,fieldStart:c.fieldStart,fieldEnd:c.fieldEnd,citationID:c.citationID,codeHash:c.codeHash,code:c.code})),
        code:'ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify(citation),text:base.text,citationID:base.citationID});
      expected.merges.push({citationID:base.citationID,sourceIDs:fields.map(c=>c.citationID),references:records,order:records.map(stateAPI.referenceKey),numbers:markers.flatMap(o=>o.numbers)});
    }
    return operations;
  }
  function resolveMarkerMapping(bindings,mapping,numbers,options={}){
    const resolved={...bindings.mapping,...mapping};
    for(const n of numbers){
      const historical=bindings.mapping[n],owners=bindings.state.displayOwners.get(Number(n))||[];
      if(owners.length>1)throw new Error(`当前编号 [${n}] 对应多个文献，无法可靠判断引用身份，请先核对字段。`);
      const current=owners[0]?.record,choice=options.labelResolutions?.[n];
      const ambiguous=historical&&current&&!stateAPI.sameRecord(historical,current);
      if(ambiguous&&!choice)throw new Error(`编号 [${n}] 的当前文献与历史标签不同，请先确认编号来源，不能自动选择。`);
      const bound=choice?.source==='current'?current:historical||current;
      if(!bound&&!historical&&!current&&bindings.state.references.length&&Number(n)<=bindings.state.references.length)
        throw new Error(`编号 [${n}] 无法从当前样式可靠对应文献，请先核对该编号的引用身份。`);
      if(choice&&(!['current','historical'].includes(choice.source)||!bound||!stateAPI.sameRecord(choice,bound)))throw new Error(`编号 [${n}] 的确认信息与当前快照不一致。`);
      if(bound&&mapping[n]&&!stateAPI.sameRecord(bound,mapping[n]))throw new Error(`编号 [${n}] 已绑定文献，普通匹配不能更换。`);
      if(bound)resolved[n]=bound;
      if(!resolved[n])throw new Error(`编号 [${n}] 尚未映射到有效 Zotero 条目。`);
    }
    return resolved;
  }
  function plan(snapshot,keys,mapping,options){
    const settings=documentSettings(snapshot.documentData,options.parseLegacy,snapshot);
    const bindings=restoreBindings(snapshot);
    if(bindings.conflicts.length)throw new Error('引用字段与原编号绑定冲突，请先在界面中核对并确认恢复绑定，再批量插入。');
    const blocking=bindings.issues.find(issue=>issue.blocking);
    if(blocking)throw new Error(blocking.message);
    if(snapshot.unsupportedCitationStories?.length)throw new Error('文档含正文以外的 Zotero 引用，无法保证全文重编号；请使用 Zotero 原生操作。');
    for(const [n,record]of Object.entries(mapping||{})){if(!record?.uris?.length)throw new Error(`编号 [${n}] 尚未映射到有效 Zotero 条目。`);stateAPI.recordFromItem(record);}
    const scanned=scan(snapshot);
    const selected=core.selectedOccurrences(scanned,keys);
    const selectedNumbers=new Set(selected.flatMap(occurrence=>occurrence.numbers.map(String)));
    const tableMapping={};
    for(const [n,record]of Object.entries(mapping||{}))if(!selectedNumbers.has(n))tableMapping[n]=record;
    for(const [n,record]of Object.entries(tableMapping)){
      if(options.labelResolutions?.[n])resolveMarkerMapping(bindings,{[n]:record},[n],options);
      else mergeBindings({},{[n]:record},bindings);
    }
    mapping=resolveMarkerMapping(bindings,mapping,selectedNumbers,options);
    const entries=JSON.parse(JSON.stringify(bindings.entries));
    const labelFor=labelAllocator(bindings,entries,selectedNumbers);
    const expected={newReferences:[],newNumbers:[],merges:[],removedReferences:[]};
    const operations=buildMergeGroups(snapshot,bindings,selected,mapping,entries,expected,labelFor);
    const mergedKeys=new Set(selected.filter(occurrence=>occurrence.merged).map(occurrence=>occurrence.key));
    for(const occurrence of selected){
      if(mergedKeys.has(occurrence.key))continue;
      const citation=styleCitation(occurrence,mapping);
      for(const n of occurrence.numbers){
        for(const label of labelFor(mapping[n],n)){
          const entry=entries[label]||={uris:[...mapping[n].uris],citations:[]};
          if(!entry.citations.includes(citation.citationID))entry.citations.push(citation.citationID);
          expected.newNumbers.push({number:Number(label),displayNumber:Number(n),record:mapping[n]});
        }
      }
      operations.push({kind:'insert',start:occurrence.start,end:occurrence.end,raw:occurrence.raw,
        code:'ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify(citation),text:occurrence.raw,citationID:citation.citationID});
      occurrence.merged=false;
    }
    for(const occurrence of selected){
      if(occurrence.merged)continue;
      for(const n of occurrence.numbers){
        const record=mapping[n];
        if(!expected.newReferences.some(existing=>stateAPI.sameRecord(existing,record)))expected.newReferences.push(record);
      }
    }
    for(const merge of expected.merges)for(const record of merge.references)
      if(!expected.newReferences.some(existing=>stateAPI.sameRecord(existing,record)))expected.newReferences.push(record);
    expected.newNumbers=expected.newNumbers.filter((item,index,all)=>all.findIndex(other=>other.number===item.number)===index);
    if(!settings&&!options.styleID)throw new Error('请为新文档选择引用格式。');
    const numeric=options.numeric===true;
    const preview=stateAPI.deriveFirstUseOrder(bindings.state,selected,mapping);
    preview.numeric=numeric;
    if(!numeric)preview.limited='当前样式不是已确认的数字连续制式；预览只用于核对首次出现顺序，最终编号由 Zotero 原生样式生成。';
    operations.sort((a,b)=>b.start-a.start);
    // An all-new adjacent marker cluster must also be one ordered field before
    // Zotero refreshes it. It has no old carrier but otherwise the same contract.
    for(let i=operations.length-1;i>0;i--){
      const left=operations[i],right=operations[i-1];
      if(left.kind!=='insert'||right.kind!=='insert'||left.end!==right.start)continue;
      const a=stateAPI.parseCitation(left.code),b=stateAPI.parseCitation(right.code),seen=new Set(a.citationItems.map(item=>stateAPI.referenceKey(item)+'|'+JSON.stringify(stateAPI.itemAttributes(item))));
      for(const item of b.citationItems){const key=stateAPI.referenceKey(item)+'|'+JSON.stringify(stateAPI.itemAttributes(item));if(!seen.has(key)){a.citationItems.push(item);seen.add(key);}}
      left.end=right.end;left.raw+=right.raw;left.code='ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify(a);left.text=left.raw;
      for(const entry of Object.values(entries))entry.citations=[...new Set(entry.citations.map(id=>id===right.citationID?left.citationID:id))];
      operations.splice(i-1,1);i=Math.min(i,operations.length);
    }
    expected.graph=stateAPI.expectedGraph(bindings.state,operations);
    expected.beforeGraph=stateAPI.graphOf(bindings.state);
    const transactionId=options.transactionId||'';
    const draft={documentKey:snapshot.documentKey,fingerprint:snapshot.fingerprint,
      documentData:settings?snapshot.documentData:core.documentData(options.styleID,options.locale,options.zoteroVersion),
      bindingData:JSON.stringify({version:2,revision:(bindings.state.ledger.revision||0)+1,entries}),operations,expected,preview,transactionId,
      protocol:schemaVersion(),capabilities:capabilities()};
    return draft;
  }
  function schemaVersion(){return 3;}
  function capabilities(){return ['structuredFields','mergeAdjacent','postCommitVerification','stagedLedger','finalize','v2Ledger','verifiedGraph','recoverTransaction','handshake'];}
  function recoverBindings(snapshot,confirmed){
    const bindings=restoreBindings(snapshot),entries=JSON.parse(JSON.stringify(bindings.entries));
    for(const [n,record]of Object.entries(confirmed||{})){
      if(!/^[1-9]\d{0,4}$/.test(n))throw new Error('恢复绑定的原编号必须为 1 至 99999。');
      if(!record?.uris?.length||!record.itemData)throw new Error(`编号 [${n}] 尚未选择有效文献。`);
      if(bindings.mapping[n]&&!bindings.conflicts.includes(Number(n))&&!stateAPI.sameRecord(bindings.mapping[n],record))
        throw new Error(`编号 [${n}] 的当前引用域仍绑定另一文献；只有明确替换后才能重新确认。`);
    }
    for(const n of bindings.conflicts){
      const detail=bindings.conflictDetails[n],record=confirmed?.[n];
      if(!record)throw new Error(`编号 [${n}] 的引用内容已改变，请明确选择当前引用域中的文献后再确认。`);
      if(detail?.current&&!stateAPI.sameRecord(record,detail.current))
        throw new Error(`编号 [${n}] 的确认文献与当前引用域内容不一致，请核对后重试。`);
      const original=bindings.state.ledger.entries[n],remaining=stateAPI.uriKeys(original).map(uri=>bindings.state.byUri.get(uri)).find(Boolean);
      if(remaining?.occurrences.length){
        // Replacing one A occurrence with H does not replace the other A
        // occurrences or transfer A's historical label to H.
        entries[n]={uris:[...remaining.uris],citations:[...new Set(remaining.occurrences.map(o=>o.citation.citationID))]};
        let label=Object.keys(entries).find(key=>stateAPI.sameRecord(entries[key],record));
        if(!label)label=String(Math.max(0,...Object.keys(bindings.state.ledger.entries).map(Number),...Object.keys(entries).map(Number))+1);
        const target=bindings.state.byUri.get(stateAPI.uriKeys(record)[0]);
        entries[label]={uris:[...record.uris],citations:[...new Set(target?.occurrences.map(o=>o.citation.citationID)||[detail.citationID])]};
      }else entries[n]={uris:[...record.uris],citations:detail?[detail.citationID]:[],aliases:[...(original?.citations||[])]};
    }
    for(const unknown of bindings.untracked){
      if(Object.values(entries).some(entry=>stateAPI.sameRecord(entry,unknown.record)))continue;
      const matches=Object.entries(confirmed||{}).filter(([,record])=>stateAPI.sameRecord(record,unknown.record));
      if(bindings.state.ledgerPresent&&!matches.length)continue; // Native additions need an identity, not a fabricated historical label.
      if(matches.length!==1)throw new Error('请为全部旧版引用确认唯一的原编号对应关系。');
      const [n]=matches[0];
      if(bindings.mapping[n]&&!stateAPI.sameRecord(bindings.mapping[n],unknown.record))
        throw new Error(`原编号 [${n}] 已绑定，不能覆盖。`);
      entries[n]={uris:[...unknown.record.uris],citations:[...unknown.citations]};
    }
    const confirmedNumbers=Object.entries(entries).map(([n,entry])=>({number:Number(n),record:stateAPI.uriKeys(entry).map(uri=>bindings.state.byUri.get(uri)).find(Boolean)?.record})).filter(label=>label.record);
    return {documentKey:snapshot.documentKey,fingerprint:snapshot.fingerprint,documentData:snapshot.documentData,
      bindingData:JSON.stringify({version:2,entries}),operations:[],
      syncOnly:true,expected:{newReferences:confirmedNumbers.map(label=>label.record),newNumbers:confirmedNumbers,
        confirmedReplacements:confirmedNumbers,merges:[],graph:stateAPI.graphOf(bindings.state),beforeGraph:stateAPI.graphOf(bindings.state)}};
  }
  function syncPlan(snapshot){
    const state=restoreBindings(snapshot);
    if(state.conflicts.length||state.issues.some(issue=>issue.blocking))
      throw new Error('存在需要确认的替换或旧版文献，不能只同步引用域记录。');
    const doc=documentState(snapshot);
    const sync=stateAPI.syncAfterVerification(doc,doc,{expected:{newReferences:[],newNumbers:[],merges:[]}});
    return {documentKey:snapshot.documentKey,fingerprint:snapshot.fingerprint,documentData:snapshot.documentData,
      bindingData:sync.bindingData,operations:[],syncOnly:true,
      expected:{newReferences:[],newNumbers:[],merges:[],graph:stateAPI.graphOf(doc),beforeGraph:stateAPI.graphOf(doc)}};
  }
  function refreshPlan(snapshot){
    const bindings=restoreBindings(snapshot);
    if(bindings.issues.some(issue=>issue.blocking))throw new Error('当前字段有引用身份冲突，请先核对后刷新。');
    if(snapshot.unsupportedCitationStories?.length)throw new Error('文档含正文以外的 Zotero 引用，请使用官方刷新。');
    const entries=JSON.parse(JSON.stringify(bindings.entries)),expected={newReferences:[],newNumbers:[],merges:[]};
    const operations=buildMergeGroups(snapshot,bindings,[],{},entries,expected,labelAllocator(bindings,entries));
    expected.graph=stateAPI.expectedGraph(bindings.state,operations);expected.beforeGraph=stateAPI.graphOf(bindings.state);
    return {documentKey:snapshot.documentKey,fingerprint:snapshot.fingerprint,documentData:snapshot.documentData,
      bindingData:JSON.stringify({version:2,entries}),operations,expected};
  }
  function verifyStoredGraph(snapshot,graph,beforeGraph=graph){
    const fields=beforeGraph.citations.map((c,index)=>({start:index*10,end:index*10+1,
      code:'ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify({citationID:c.citationID,citationItems:c.items,properties:{noteIndex:0}}),text:''}));
    const before=documentState({documentKey:'recovery',fingerprint:'recovery',citationFields:fields});
    const after=documentState(snapshot);
    return stateAPI.verifyTransition(before,after,{expected:{graph,newReferences:graph.citations.flatMap(c=>c.items)}});
  }
  function recoveryPlan(snapshot){
    const transaction=snapshot.transaction;
    if(!transaction?.id||!transaction.beforeGraph||!transaction.expectedGraph)throw new Error('上次事务缺少可验证的恢复记录，请保留文档并核对备份。');
    const state=documentState(snapshot);
    const unchanged=verifyStoredGraph(snapshot,transaction.beforeGraph).ok;
    const complete=verifyStoredGraph(snapshot,transaction.expectedGraph,transaction.beforeGraph).ok;
    if(!unchanged&&!complete)throw new Error('当前引用既不符合操作前状态，也不符合已确认计划；已停止恢复，请核对备份和异常位置。');
    const newNumbers=[];
    if(!unchanged||transaction.metadataOnly)for(const label of transaction.labels||[]){
      const ref=stateAPI.uriKeys(label).map(uri=>state.byUri.get(uri)).find(Boolean);
      if(!ref)throw new Error('已确认的编号记录找不到对应文献，已停止恢复。');
      newNumbers.push({number:Number(label.number),record:ref.record});
    }
    const expected={newReferences:[],newNumbers,merges:[],graph:stateAPI.graphOf(state),beforeGraph:stateAPI.graphOf(state)};
    const sync=stateAPI.syncAfterVerification(state,state,{expected});
    const plan={documentKey:snapshot.documentKey,fingerprint:snapshot.fingerprint,documentData:snapshot.documentData,bindingData:sync.bindingData,operations:[],expected};
    plan.resume=true;plan.transactionId=transaction.id;plan.syncOnly=unchanged||transaction.phase==='finalizing';
    plan.recoveryMode=unchanged?'restore-records':'complete-refresh';
    return plan;
  }
  function checkNumbers(snapshot,scanned){
    const numbers=new Set((scanned||scan(snapshot)).numbers);
    for(const value of snapshot.citationTexts||[]){
      let text=String(value).trim().replace(/\]\s*[-–—]\s*\[/g,'–').replace(/\]\s*[,，;；]\s*\[/g,',');
      if(/^[\d\s,，、;；\-–—]+$/.test(text))text='['+text+']';
      for(const n of core.parseMarker(text)||[])numbers.add(n);
    }
    return [...numbers].sort((a,b)=>a-b);
  }
  function reconcileScan(previous,next,mapping,selected,bindings={mapping:{},untracked:[]}){
    const numbers=new Set([...next.numbers.map(String),...Object.keys(bindings.mapping||{})]);
    const old=new Map((previous?.occurrences||[]).map(o=>[o.key,o]));
    return {
      mapping:mergeBindings({},Object.fromEntries(Object.entries(mapping||{}).filter(([n])=>numbers.has(n)&&!bindings.mapping?.[n])),bindings),
      selected:new Set(next.occurrences.filter(o=>{
        const before=old.get(o.key);
        return o.eligible&&selected.has(o.key)&&before?.raw===o.raw&&before.context===o.context;
      }).map(o=>o.key))
    };
  }
  function verifyCommit(beforeSnapshot,afterSnapshot,plan){
    const before=documentState(beforeSnapshot),after=documentState(afterSnapshot);
    const verification=stateAPI.verifyTransition(before,after,plan);
    if(!verification.ok)return {...verification,bindingData:null};
    const sync=stateAPI.syncAfterVerification(before,after,plan);
    return {...verification,entries:sync.entries,bindingData:sync.bindingData};
  }
  function finalizePlan(plan,beforeSnapshot,afterSnapshot){
    const result=verifyCommit(beforeSnapshot,afterSnapshot,plan);
    if(!result.ok)return result;
    return {...result,documentData:afterSnapshot.documentData,
      fingerprint:afterSnapshot.fingerprint,transactionId:plan.transactionId||''};
  }
  return {scan,plan,documentSettings,checkNumbers,reconcileScan,restoreBindings,mergeBindings,recoverBindings,syncPlan,
    documentState,verifyCommit,finalizePlan,capabilities,schemaVersion,resolveMarkerMapping,refreshPlan,recoveryPlan,verifyStoredGraph};
});
