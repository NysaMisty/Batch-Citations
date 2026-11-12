// SPDX-License-Identifier: MIT
// Read-only inspection of a Word document's complex Zotero citation fields.
// This intentionally does not write to the source file or require Word.
'use strict';
const fs=require('node:fs');
const {unzipSync}=require('fflate');

function decodeXml(text){
  return String(text).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}

function entry(zip,name){
  const data=zip[name];
  if(!data)throw new Error(`DOCX 缺少 ${name}`);
  return Buffer.from(data).toString('utf8');
}

function customProperties(xml){
  const properties={};
  for(const match of xml.matchAll(/<property[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/property>/g)){
    const value=/<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/.exec(match[2]);
    if(value)properties[match[1]]=decodeXml(value[1]);
  }
  return properties;
}

function citationFields(xml){
  const pattern=/<w:fldChar w:fldCharType="begin"\/>([\s\S]*?)<w:fldChar w:fldCharType="separate"\/>([\s\S]*?)<w:fldChar w:fldCharType="end"\/>/g;
  const fields=[];let match;
  while((match=pattern.exec(xml))){
    const code=[...match[1].matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g)]
      .map(part=>decodeXml(part[1])).join('').trim();
    const text=[...match[2].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map(part=>decodeXml(part[1])).join('');
    fields.push({code,text,start:match.index,end:pattern.lastIndex});
  }
  return fields;
}

function ledger(properties){
  let raw='';
  for(let index=1;properties[`ZBC_BINDINGS_${index}`]!==undefined;index++)raw+=properties[`ZBC_BINDINGS_${index}`];
  return raw;
}

function readEvidence(file){
  const zip=unzipSync(fs.readFileSync(file));
  const properties=customProperties(entry(zip,'docProps/custom.xml'));
  const fields=citationFields(entry(zip,'word/document.xml'));
  return {file,properties,ledger:ledger(properties),fields,
    pref:[properties.ZOTERO_PREF_1||'',properties.ZOTERO_PREF_2||''].join('')};
}

// Convert the Word field list into the snapshot shape consumed by
// citation-state/live-core. Ranges are synthetic but preserve field order.
function snapshotFromEvidence(evidence,{documentKey='evidence',fingerprint='evidence'}={}){
  return {
    documentKey,fingerprint,bindingData:evidence.ledger||'',
    citationFields:evidence.fields.map((field,index)=>{
      const prefix='ADDIN ZOTERO_ITEM CSL_CITATION ';
      const offset=field.code.indexOf(prefix);
      if(offset<0)throw new Error('证据文档中的域不是 Zotero 引用域。');
      const citation=JSON.parse(field.code.slice(offset+prefix.length));
      return {index,start:index*10000,end:index*10000+1,codeStart:index*10000,
        codeEnd:index*10000+1,resultStart:index*10000+1,resultEnd:index*10000+2,
        storyType:1,code:field.code,codeHash:'',text:field.text,textAfter:'',
        citationID:citation.citationID};
    }),
    citationCodes:evidence.fields.map(field=>field.code),
    citationTexts:evidence.fields.map(field=>field.text),
    candidates:[],display:evidence.properties.ZBC_DISPLAY||'',
    bibliographyCount:0,path:evidence.file,name:evidence.file
  };
}

module.exports={readEvidence,snapshotFromEvidence,snapshotFromFixture,customProperties,citationFields};

function snapshotFromFixture(fixture,{documentKey='fixture',fingerprint='fixture'}={}){
  return snapshotFromEvidence({ledger:fixture.ledger,fields:fixture.fields,properties:{},file:fixture.source||'fixture'},
    {documentKey,fingerprint});
}
