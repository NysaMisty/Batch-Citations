const {test}=require('node:test');const assert=require('node:assert/strict');const lists=require('../addon/content/literature.js');
const uri='http://zotero.org/users/local/abc123/items/ABCD1234';
test('editable CSV/TSV round trip BOM, quoted titles, commas, tabs and newlines',()=>{
  const original={format:'zotero-batch-citations/v1',mapping:{1:{uri,title:'Title, "quoted"\n下一行\tTab'}}};
  for(const format of ['csv','tsv','json']){const parsed=lists.parse(lists.stringify(original,format),format);assert.equal(parsed[1].uri,uri);assert.equal(parsed[1].title,original.mapping[1].title);}
});
test('legacy JSON is accepted; invalid shape and record fields identify the problem',()=>{
  assert.equal(lists.parse(JSON.stringify({format:'zotero-batch-citations/v1',mapping:{1:{uri}}}),'json')[1].uri,uri);
  for(const [text,match]of [['{}',/mapping/],['number,title\n1,A',/uri/],['number,uri\n0,'+uri,/第 2 行.*number/],['number,uri\n1,no',/第 2 行.*uri/],['number,uri,title\n1,'+uri+',"broken',/第 2 行.*未闭合/],['number,uri\n1,'+uri+',extra',/第 2 行.*实际/]])assert.throws(()=>lists.parse(text),match);
});
test('duplicate numbers and equivalent Zotero URIs are rejected atomically',()=>{
  assert.throws(()=>lists.parse(`number,uri\n1,${uri}\n1,${uri}`),/第 3 行.*重复/);
  assert.throws(()=>lists.parse(`number,uri\n1,${uri}\n2,${uri.replace('http:','https:')}`),/第 3 行.*编号 1/);
});
