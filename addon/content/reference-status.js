/* SPDX-License-Identifier: MIT; presentation only, never modifies a scan or mapping. */
(function(root,factory){
  const api=factory(typeof module==='object'?require('./citation-state.js'):root.ZBCitationState);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBReferenceStatus=api;
})(globalThis,function(identity){
  'use strict';
  function count(record,number,state,scan,mapping={}){
    const ref=record?(state?.references||[]).find(ref=>identity.sameRecord(ref.record||ref,record)):null;
    const existing=ref?new Set(ref.occurrences.map(o=>o.citation.citationID)).size:0;
    const pending=(scan?.occurrences||[]).filter(o=>o.eligible&&o.numbers.some(n=>
      record?identity.sameRecord(mapping[n],record):n===number)).length;
    return {existing,pending};
  }
  function format({existing,pending}){
    if(existing&&pending)return `已引用 ${existing} · 待转换 ${pending}`;
    return existing?`已引用 ${existing} 处`:pending?`待转换 ${pending} 处`:'—';
  }
  return {count,format};
});
