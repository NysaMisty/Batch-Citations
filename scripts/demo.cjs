/* SPDX-License-Identifier: MIT */
const fs=require('node:fs');
const path=require('node:path');
const zip=require('fflate');
const core=require('../addon/content/core.js');
const dir=path.join(__dirname,'../examples');fs.mkdirSync(dir,{recursive:true});
const p=t=>`<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const body='<w:p><w:r><w:tab/><w:t>这是合成演示文档。第一处引用[1]，第二处为组合引用[1,3]。</w:t><w:br/></w:r></w:p>'+
  '<w:p><w:r><w:t>跨格式引用[</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>2</w:t></w:r><w:r><w:t>]也可以扫描。</w:t></w:r></w:p>'+
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>'+p('表格中的范围引用[1–3]。')+'</w:tc></w:tr></w:tbl>'+
  p('参考文献')+p(core.BIB)+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const entries={
  '[Content_Types].xml':zip.strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels':zip.strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml':zip.strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${core.W}"><w:body>${body}</w:body></w:document>`)
};
fs.writeFileSync(path.join(dir,'placeholder-demo.docx'),zip.zipSync(entries));
fs.writeFileSync(path.join(dir,'demo-references.ris'),[1,2,3].map(i=>`TY  - BOOK\nTI  - Synthetic reference ${i}\nAU  - Author${i}, Test\nPY  - 202${i}\nPB  - Test Press\nER  - \n`).join('\n'));
console.log('Generated examples/placeholder-demo.docx and demo-references.ris');
