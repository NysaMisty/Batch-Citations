const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const core = require('../addon/content/core.js');
const env = { DOMParser, XMLSerializer };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = body => `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = id => ({ id, uris: [`http://zotero.org/users/1/items/TEST000${id}`], itemData: { id, type: 'book', title: `Test & ${id}` } });
const convert = (input, keys, mapping = { 1:item(1), 2:item(2), 3:item(3) }) => {
  const scan = core.scanDocument(input, env);
  return core.convertDocument(input, keys || scan.occurrences.filter(x=>x.eligible).map(x=>x.key), mapping,
    { citations: Object.fromEntries(scan.occurrences.map(x=>[x.key,x.raw])), bibliography:'[1] Test A\n[2] Test B' }, env);
};

test('parse simple, clusters, Chinese separators and bounded ranges', () => {
  assert.deepEqual(core.parseMarker('[1,3–5，2、3]'), [1,3,4,5,2]);
  for (const v of ['[0]','[01]','[-1]','[3-1]','[1,,2]','[1.2]','[1-99999]']) assert.equal(core.parseMarker(v), null, v);
});
test('scan across runs but never across paragraphs', () => {
  const s = core.scanDocument(xml('<w:p><w:r><w:t>甲[</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>1,3]</w:t></w:r></w:p>'+p('[')+p('2]')), env);
  assert.equal(s.occurrences.length, 1);
  assert.deepEqual(s.numbers, [1,3]);
  assert.equal(s.occurrences[0].eligible, true);
});
test('protected hyperlink and ordinary fields are visible but ineligible', () => {
  const s = core.scanDocument(xml('<w:p><w:hyperlink><w:r><w:t>[1]</w:t></w:r></w:hyperlink><w:fldSimple w:instr="DATE"><w:r><w:t>[2]</w:t></w:r></w:fldSimple></w:p>'), env);
  assert.equal(s.occurrences.length, 2);
  assert.ok(s.occurrences.every(x=>!x.eligible));
});
test('block content controls protect their paragraphs and cannot host the bibliography marker', () => {
  const control=text=>'<w:sdt><w:sdtContent>'+p(text)+'</w:sdtContent></w:sdt>';
  const input=xml(control('[1]')+p('[2]'));
  const scan=core.scanDocument(input,env);
  assert.equal(scan.occurrences[0].eligible,false);
  assert.deepEqual(scan.numbers,[2]);
  assert.throws(()=>convert(input,[scan.occurrences[0].key]),/受保护/);
  assert.throws(()=>core.scanDocument(xml(control(core.BIB)),env),/独占/);
  const field='<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>OTHER</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>'+core.BIB+'</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  assert.throws(()=>core.scanDocument(xml(field),env),/独占/);
});
test('reject tracked changes, existing Zotero fields, malformed XML and DTD', () => {
  for (const input of [xml('<w:ins>'+p('[1]')+'</w:ins>'), xml('<w:p><w:r><w:instrText>ADDIN ZOTERO_ITEM CSL_CITATION {}</w:instrText></w:r></w:p>'), '<w:document>', '<!DOCTYPE x [<!ENTITY a "a">]>'+xml(p('[1]'))]) {
    assert.throws(()=>core.scanDocument(input, env));
  }
});
test('replace multiple markers in same run; preserve text, suffix formatting and section', () => {
  const input = xml('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>甲[1]乙[2]丙[1,3]丁</w:t></w:r></w:p>');
  const out = convert(input);
  assert.equal(out.count, 3);
  const doc = core.parseXML(out.xml, env);
  assert.equal(doc.getElementsByTagNameNS(W,'fldChar').length, 12); // 3 citations + bibliography
  const codes = Array.from(doc.getElementsByTagNameNS(W,'instrText')).map(x=>x.textContent).join('');
  assert.ok(codes.includes('ZOTERO_ITEM CSL_CITATION'));
  assert.ok(codes.includes('ZOTERO_BIBL'));
  assert.equal(new Set(out.citations.map(x=>x.citationID)).size, 3);
  assert.ok(out.xml.indexOf('ZOTERO_BIBL') < out.xml.indexOf('<w:sectPr'));
  for (const text of ['甲','乙','丙','丁']) assert.ok(doc.documentElement.textContent.includes(text));
  assert.ok(out.xml.includes('<w:i'));
});
test('cross-run suffix retains its original formatting', () => {
  const input=xml('<w:p><w:r><w:t>前[1,</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>3]后</w:t></w:r></w:p>');
  const out=convert(input);
  assert.ok(/<w:rPr><w:b\s*\/><\/w:rPr><w:t[^>]*>后<\/w:t>/.test(out.xml));
});
test('markers next to tabs and line breaks convert without losing surrounding run content', () => {
  const input=xml('<w:p><w:r><w:t>1.</w:t></w:r><w:r w:rsidR="00AB1234"><w:rPr><w:b/></w:rPr><w:tab/><w:t>正文[1]</w:t><w:br/><w:t>下一行[2]</w:t><w:tab/><w:t>末尾</w:t></w:r></w:p>'+p('[3]'));
  const scan=core.scanDocument(input,env);
  assert.deepEqual(scan.numbers,[1,2,3]);
  assert.ok(scan.occurrences.every(o=>o.eligible));
  const out=convert(input),doc=core.parseXML(out.xml,env);
  assert.equal(out.count,3);
  assert.equal(doc.getElementsByTagNameNS(W,'tab').length,2);
  assert.equal(doc.getElementsByTagNameNS(W,'br').length,2); // Original break plus bibliography line break
  const visible=Array.from(doc.getElementsByTagNameNS(W,'t')).map(n=>n.textContent).join('');
  assert.ok(visible.startsWith('1.正文[1]下一行[2]末尾[3]'));
  const suffix=Array.from(doc.getElementsByTagNameNS(W,'r')).find(r=>r.textContent==='末尾');
  assert.ok(suffix.getElementsByTagNameNS(W,'b').length);
  assert.equal(suffix.getAttributeNS(W,'rsidR'),'00AB1234');
  assert.deepEqual(core.scanDocument(xml('<w:p><w:r><w:t>[</w:t><w:tab/><w:t>1]</w:t></w:r></w:p>'),env).occurrences,[]);
});
test('cross-run marker replacement retains adjacent drawings, multiple text nodes and bookmarks', () => {
  const input=xml('<w:p><w:r><w:tab/><w:t>前</w:t><w:t>[1,</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>3]后</w:t><w:drawing><object xmlns="urn:test" id="keep"/></w:drawing><w:t>尾</w:t></w:r><w:bookmarkStart w:id="1" w:name="other"/><w:r><w:t>结束</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>');
  const out=convert(input),doc=core.parseXML(out.xml,env);
  assert.equal(out.count,1);
  assert.equal(doc.getElementsByTagNameNS(W,'tab').length,1);
  assert.equal(doc.getElementsByTagNameNS(W,'drawing').length,1);
  assert.equal(doc.getElementsByTagNameNS('urn:test','object')[0].getAttribute('id'),'keep');
  assert.equal(doc.getElementsByTagNameNS(W,'bookmarkStart').length,1);
  const visible=Array.from(doc.getElementsByTagNameNS(W,'t')).map(n=>n.textContent).join('');
  assert.ok(visible.startsWith('前[1,3]后尾结束'));
});
test('text outside a complex field remains convertible while its display text stays protected across paragraphs', () => {
  const input=xml('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>[1]</w:t></w:r></w:p><w:p><w:r><w:t>[2]</w:t><w:fldChar w:fldCharType="end"/><w:t> [3]</w:t><w:br/></w:r></w:p>');
  const scan=core.scanDocument(input,env);
  assert.deepEqual(scan.occurrences.map(o=>o.eligible),[false,false,true]);
  const out=convert(input),doc=core.parseXML(out.xml,env);
  assert.equal(out.count,1);
  assert.equal(doc.getElementsByTagNameNS(W,'fldChar').length,9); // Original field, citation and bibliography
  assert.equal(doc.getElementsByTagNameNS(W,'br').length,2);
  assert.ok(Array.from(doc.getElementsByTagNameNS(W,'instrText')).some(n=>n.textContent==='DATE'));
  assert.ok(Array.from(doc.getElementsByTagNameNS(W,'t')).map(n=>n.textContent).join('').startsWith('[1][2] [3]'));
});
test('only selected candidates convert; missing mappings fail before output', () => {
  const input=xml(p('[1] [2]'));
  const s=core.scanDocument(input,env);
  const out=convert(input,[s.occurrences[1].key]);
  assert.equal(out.count,1);
  assert.throws(()=>convert(input,undefined,{1:item(1)}),/2/);
});
test('duplicate mapped paper appears once in a cluster', () => {
  const out=convert(xml(p('[1,2]')),undefined,{1:item(1),2:item(1)});
  assert.equal(out.citations[0].citationItems.length,1);
});
test('bibliography marker requires its own paragraph; manual list is rejected', () => {
  assert.throws(()=>core.scanDocument(xml(p('正文 {{ZOTERO_BIBLIOGRAPHY}}')),env),/独占/);
  assert.throws(()=>core.scanDocument(xml(p('参考文献')+p('[1] Old')),env),/参考文献/);
  const out=convert(xml(p('[1]')+p('参考文献')+p('{{ZOTERO_BIBLIOGRAPHY}}')));
  assert.ok(!out.xml.includes('{{ZOTERO_BIBLIOGRAPHY}}'));
});
test('custom properties retain unrelated entries and reject existing Zotero prefs', () => {
  const old='<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Other"><vt:lpwstr>keep</vt:lpwstr></property></Properties>';
  const data=JSON.stringify({test:'南烟 & '+ 'x'.repeat(600)});
  const props=core.mergeDocumentProperties(old,data,env);
  const doc=core.parseXML(props,env);
  const entries=Array.from(doc.documentElement.childNodes).filter(x=>x.nodeType===1);
  assert.equal(entries[0].textContent,'keep');
  assert.equal(entries.slice(1).map(x=>x.textContent).join(''),data);
  assert.ok(entries.slice(1).every(x=>x.textContent.length<=255));
  assert.throws(()=>core.mergeDocumentProperties(props,data,env),/Zotero/);
});
test('preference data is accepted as JSON version 4 with Word fields', () => {
  const data=JSON.parse(core.documentData('http://www.zotero.org/styles/ieee','zh-CN','7.0.32'));
  assert.equal(data.dataVersion,4);
  assert.equal(data.prefs.fieldType,'Field');
  assert.equal(data.prefs.noteType,0);
});
module.exports={env,xml,p,item};
