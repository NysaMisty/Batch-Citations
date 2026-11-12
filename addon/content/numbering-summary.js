/* SPDX-License-Identifier: MIT */
(function(root,factory){
  const api=factory(typeof module==='object'?require('./citation-state.js'):root.ZBCitationState);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBNumberingSummary=api;
})(globalThis,function(identity){
  'use strict';
  const number=value=>Number.isSafeInteger(value)&&value>0?value:null;
  const title=entry=>`《${entry.title||entry.itemData?.title||entry.uris?.[0]||'未命名文献'}》`;
  const range=(a,b)=>a===b?`[${a}]`:`[${a}]–[${b}]`;
  function build(plan,state){
    const preview=plan.preview||{},references=state?.references||[],inserted=plan.expected?.newNumbers;
    const rows=(preview.order||[]).map(entry=>{
      const ref=references.find(ref=>identity.sameRecord(ref,entry));
      const displays=ref?[...new Set((state.display?.get(ref.referenceId)||[]).map(x=>x.display).filter(x=>x!==''&&x!==undefined&&x!==null))]:[];
      const oldNumber=displays.length===1?number(displays[0]):null;
      const isInserted=inserted?.some(item=>identity.sameRecord(item.record,entry));
      // Only the actual insertion plan proves reuse, even if the first-use
      // preview encountered an older field before the newly selected position.
      const kind=isInserted?(ref?'reuse':'new'):ref?'existing':'unknown';
      return {title:title(entry),name:entry.title||entry.itemData?.title||entry.uris?.[0]||'未命名文献',kind,displays,oldNumber,newNumber:number(entry.number),ref,
        changed:!!ref&&(oldNumber===null||oldNumber!==number(entry.number))};
    });
    const oldOwners=new Map(),newOwners=new Map();
    for(const row of rows){
      for(const n of row.displays.filter(value=>number(value)!==null))oldOwners.set(n,(oldOwners.get(n)||0)+1);
      if(row.newNumber!==null)newOwners.set(row.newNumber,(newOwners.get(row.newNumber)||0)+1);
    }
    const conflict=row=>row.displays.some(n=>oldOwners.get(n)>1)||newOwners.get(row.newNumber)>1;
    const before=row=>row.displays.length?row.displays.map(display=>`[${display}]`).join('、'):'原编号未能确认';
    const destination=row=>preview.numeric&&row.newNumber!==null?` → [${row.newNumber}]`:'（最终编号待确认）';
    const prefix=row=>row.kind==='new'?'新增':row.kind==='reuse'?'复用':'新增/复用';
    const details=rows.map(row=>`${row.kind==='existing'?'':prefix(row)+'：'}${row.title}：${row.ref?before(row):'尚无当前引用编号'}${destination(row)}`);
    const lines=[];
    if(!preview.numeric)lines.push(preview.limited||'当前只能核对文献顺序；最终编号由 Zotero 刷新生成。');
    if(preview.numeric&&rows.some(conflict))lines.push('存在编号冲突，以下逐项列出，请核对完整编号变化。');
    let unchanged=0;
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      if(row.kind!=='existing'){
        lines.push(`${prefix(row)}：${row.title}${destination(row)}`+(row.kind==='reuse'&&row.changed&&preview.numeric?`（原 ${before(row)}）`:''));
        continue;
      }
      if(!preview.numeric)continue;
      if(!row.changed&&!conflict(row)){unchanged++;continue;}
      const regular=row.oldNumber!==null&&row.newNumber!==null&&!conflict(row);
      let end=i;
      if(regular){
        const delta=row.newNumber-row.oldNumber;
        while(end+1<rows.length){
          const next=rows[end+1],previous=rows[end];
          if(next.kind!=='existing'||!next.changed||next.oldNumber===null||next.newNumber===null||conflict(next)||
            next.oldNumber!==previous.oldNumber+1||next.newNumber!==previous.newNumber+1||next.newNumber-next.oldNumber!==delta)break;
          end++;
        }
      }
      if(end>i){
        const delta=row.newNumber-row.oldNumber,last=rows[end];
        lines.push(`原 ${range(row.oldNumber,last.oldNumber)} 整体${delta>0?'顺延':'提前'} ${Math.abs(delta)} 位，现为 ${range(row.newNumber,last.newNumber)}`);i=end;
      }else{
        lines.push(`${row.title}：${before(row)}${destination(row)}`+(row.oldNumber===null?'（原编号无法唯一确认）':''));
      }
    }
    if(preview.numeric&&unchanged)lines.push(lines.length?'其余编号不变':'编号不变');
    if(!lines.length)lines.push(preview.numeric?'没有编号变化':'文献顺序见完整明细；最终编号由 Zotero 刷新生成。');
    for(const row of rows){
      row.change=(row.ref?before(row):prefix(row))+(preview.numeric&&row.newNumber!==null?` → [${row.newNumber}]`:' → 待确认');
      row.changed=!!preview.numeric&&row.changed;
      row.conflict=!!preview.numeric&&conflict(row);
    }
    const changes=rows.filter(row=>row.changed||row.conflict||row.kind==='new'||row.kind==='unknown');
    const notice=!preview.numeric?(preview.limited||'当前只能核对文献顺序；最终编号由 Zotero 刷新生成。'):
      rows.some(row=>row.conflict)?'存在编号冲突，请逐项核对。':'';
    return {lines,details,rows,changes,notice,needsConfirmation:rows.filter(row=>row.changed).length>1};
  }
  function renderTable(document,body,rows){
    const make=(tag,text)=>{const element=document.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)element.textContent=text;return element;};
    body.replaceChildren();
    for(const item of rows){
      const row=make('tr');row.dataset.kind=item.kind;row.dataset.changed=String(item.changed||item.kind==='new'||item.kind==='unknown'||item.conflict);
      const title=make('td',item.name);title.title=item.name;row.appendChild(title);
      const change=make('td',item.change);change.className='number-change';change.title=item.change;row.appendChild(change);body.appendChild(row);
    }
    if(!rows.length){const row=make('tr'),cell=make('td','没有编号变化');cell.colSpan=2;cell.className='empty-preview';row.appendChild(cell);body.appendChild(row);}
  }
  return {build,renderTable};
});
