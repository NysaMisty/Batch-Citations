'use strict';
const core=require('../../addon/content/core.js');
function item(id,title,uris){
  const uriList=uris||[`https://zotero.org/users/local/test/items/ITEM${String(id).padStart(4,'0')}`];
  return {id,uris:uriList,itemData:{id,type:'book',title:title||`Item ${id}`}};
}
function citation(id,items,extra={}){
  return {citationID:id,properties:{noteIndex:0},citationItems:items.map(entry=>JSON.parse(JSON.stringify(entry))),schema:'https://github.com/citation-style-language/schema/raw/master/csl-citation.json',...extra};
}
function code(id,items,extra){return 'ADDIN ZOTERO_ITEM CSL_CITATION '+JSON.stringify(citation(id,items,extra));}
function field(options){
  const citationID=options.citationID||'field-'+options.start;
  const items=options.items||[];
  const text=options.text!==undefined?options.text:'[1]';
  const resultEnd=options.resultEnd!==undefined?options.resultEnd:options.start+text.length;
  return {code:options.code||code(citationID,items,options.extra),text,start:options.start,resultStart:options.resultStart??options.start,resultEnd,
    codeStart:options.codeStart??options.start,codeEnd:options.codeEnd??resultEnd,storyType:options.storyType||1,
    codeHash:core.hash?core.hash(options.code||code(citationID,items)):'',textAfter:options.textAfter||'',citationID};
}
function ledger(entries,version=1){return JSON.stringify({version,entries});}
function snapshot(fields,candidates,bindingData,extra={}){
  return {documentKey:'doc-a',fingerprint:'fingerprint-a',documentData:core.documentData('ieee','en-US','10'),
    path:'C:/test.docx',name:'test.docx',candidates:candidates||[],citationFields:fields||[],citationTexts:(fields||[]).map(f=>f.text),
    bindingData:bindingData||'',bibliographyCount:0,selectionStart:0,selectionEnd:0,...extra};
}
function marker(number,start,raw){return {start,end:start+(raw||`[${number}]`).length,raw:raw||`[${number}]`,eligible:true,reason:'',context:`text ${raw||`[${number}]`}`};}
function ledgerEntry(record,citations,extra={}){return {uris:record.uris,citations,...extra};}
module.exports={item,citation,code,field,ledger,snapshot,marker,ledgerEntry};
