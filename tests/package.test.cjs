const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DOMParser}=require('@xmldom/xmldom');
const addon=path.join(__dirname,'../addon');
test('manifest contains the metadata required by the Zotero 7 loader',()=>{
  const m=JSON.parse(fs.readFileSync(path.join(addon,'manifest.json'),'utf8'));
  assert.equal(m.manifest_version,2);
  for(const field of ['id','update_url','strict_min_version','strict_max_version'])assert.ok(m.applications.zotero[field],field);
  assert.ok(fs.existsSync(path.join(addon,'bootstrap.js')));
});
test('XHTML controller loads after controls, without relying on HTML-only defer behavior',()=>{
  const text=fs.readFileSync(path.join(addon,'content/dialog.xhtml'),'utf8');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  assert.equal(doc.getElementsByTagName('parsererror').length,0);
  assert.ok(text.lastIndexOf('src="dialog.js"')>text.indexOf('id="convert"'));
});
test('citation-state loads before live-core in both the dialog and the background service',()=>{
  const text=fs.readFileSync(path.join(addon,'content/dialog.xhtml'),'utf8');
  assert.ok(text.indexOf('src="citation-state.js"')>=0);
  assert.ok(text.indexOf('src="citation-state.js"')<text.indexOf('src="live-core.js"'));
  const bootstrap=fs.readFileSync(path.join(addon,'bootstrap.js'),'utf8');
  const list=bootstrap.match(/for\(const name of \[([^\]]+)\]/)[1];
  assert.ok(list.indexOf("'citation-state.js'")>=0);
  assert.ok(list.indexOf("'citation-state.js'")<list.indexOf("'live-core.js'"));
});
