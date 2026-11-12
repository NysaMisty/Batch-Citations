const {test}=require('node:test');
const assert=require('node:assert/strict');
const zip=require('fflate');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const archive=require('../addon/content/archive.js');
const core=require('../addon/content/core.js');
const env={DOMParser,XMLSerializer};
function fixture(extra={}){
  return zip.zipSync({
    '[Content_Types].xml':zip.strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':zip.strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml':zip.strToU8(`<w:document xmlns:w="${core.W}"><w:body><w:p><w:r><w:t>测试[1]</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`),
    'word/media/image.bin':new Uint8Array([0,255,22,38,128]),...extra
  });
}
test('full package conversion preserves unrelated bytes, creates prefs and is not repeatable',()=>{
  const input=fixture();const a=archive.open(input,env);const key=a.scan.occurrences[0].key;
  const output=archive.convert(a,[key],{1:{id:1,uris:['http://zotero.org/users/1/items/ABCDEFGH'],itemData:{id:1,type:'book',title:'Demo'}}},
    {citations:{[key]:'[1]'},bibliography:'[1] Demo'},{styleID:'http://www.zotero.org/styles/ieee',locale:'zh-CN',zoteroVersion:'7.0.32'},env);
  const before=zip.unzipSync(input),after=zip.unzipSync(output.bytes);
  assert.deepEqual(after['word/media/image.bin'],before['word/media/image.bin']);
  assert.ok(zip.strFromU8(after['_rels/.rels']).includes('custom-properties'));
  assert.ok(zip.strFromU8(after['docProps/custom.xml']).includes('ZOTERO_PREF_1'));
  assert.throws(()=>archive.open(output.bytes,env),/已有 Zotero/);
  assert.ok(!a.entries['docProps/custom.xml']);
});
test('reject corrupt, path traversal, macro, revision mode and oversized expanded ZIP',()=>{
  assert.throws(()=>archive.open(new Uint8Array([1,2,3]),env));
  assert.throws(()=>archive.open(fixture({'../bad':new Uint8Array([1])}),env),/路径/);
  assert.throws(()=>archive.open(fixture({'word/vbaProject.bin':new Uint8Array([1])}),env),/宏/);
  assert.throws(()=>archive.open(fixture({'word/settings.xml':zip.strToU8(`<w:settings xmlns:w="${core.W}"><w:trackRevisions/></w:settings>`)}),env),/修订/);
  const bomb=zip.zipSync({'huge':new Uint8Array(archive.MAX_EXPANDED+1)});
  assert.throws(()=>archive.open(bomb,env),/100 MiB/);
});
test('count excluded story candidates separately',()=>{
  const a=archive.open(fixture({'word/footnotes.xml':zip.strToU8(`<w:footnotes xmlns:w="${core.W}"><w:footnote w:id="1"><w:p><w:r><w:t>[</w:t></w:r><w:r><w:t>2]</w:t></w:r></w:p></w:footnote></w:footnotes>`)}),env);
  assert.deepEqual(a.excluded,[{part:'word/footnotes.xml',count:1}]);
});
module.exports={fixture};
test('bibliography placeholder is ordinary text, never an existing Zotero field',()=>{
  const a=archive.open(fixture({'word/document.xml':zip.strToU8(`<w:document xmlns:w="${core.W}"><w:body><w:p><w:r><w:t>[1]</w:t></w:r></w:p><w:p><w:r><w:t>${core.BIB}</w:t></w:r></w:p></w:body></w:document>`)}),env);
  assert.equal(a.scan.bibliographyMarker,true);
  assert.equal(a.scan.occurrences.length,1);
});
