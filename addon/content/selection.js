/* SPDX-License-Identifier: MIT */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBSelection=api;
})(globalThis,function(){
  'use strict';
  const recordValid=record=>!!record?.itemData&&Array.isArray(record.uris)&&record.uris.some(uri=>typeof uri==='string'&&uri.trim());
  function state(occurrence,mapping,{valid=recordValid,ambiguous=()=>false}={}){
    const numbers=occurrence.numbers||[],missing=numbers.filter(n=>!recordValid(mapping[n])||!valid(mapping[n],n)),uncertain=numbers.filter(n=>ambiguous(n));
    const selectable=!!occurrence.eligible&&numbers.length>0&&!missing.length&&!uncertain.length;
    const reason=!occurrence.eligible?occurrence.reason||'受保护的位置':missing.length?`缺少有效文献绑定：${missing.map(n=>`[${n}]`).join('、')}`:uncertain.length?`需确认编号来源：${uncertain.map(n=>`[${n}]`).join('、')}`:numbers.length?'':'无法识别引用编号';
    return {selectable,missing,ambiguous:uncertain,reason};
  }
  function reconcile(scan,mapping,keys,options){
    const wanted=keys==null?null:new Set(keys),selected=new Set(),skipped=[];
    for(const occurrence of scan?.occurrences||[]){
      if(wanted&&!wanted.has(occurrence.key))continue;
      const status=state(occurrence,mapping,options);
      if(status.selectable)selected.add(occurrence.key);
      else skipped.push({key:occurrence.key,...status});
    }
    return {selected,skipped};
  }
  return {state,reconcile};
});
