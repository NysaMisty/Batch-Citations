/* SPDX-License-Identifier: MIT */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBLiterature=api;})(globalThis,function(){
  'use strict';
  const fail=(where,text)=>{throw new Error(`${where}：${text}`);};
  function parse(text,format='csv',options={}){
    text=String(text).replace(/^\uFEFF/,'');
    if(text.length>2*1024*1024)fail('文献列表','文件超过 2 MiB');
    let rows;
    if(format==='json'||text.trimStart().startsWith('{')){
      let data;try{data=JSON.parse(text);}catch(e){fail('JSON 语法',e.message);}
      if(data?.format!=='zotero-batch-citations/v1'||!data.mapping||typeof data.mapping!=='object'||Array.isArray(data.mapping))fail('JSON 格式','需要 format="zotero-batch-citations/v1" 和 mapping 对象');
      rows=Object.entries(data.mapping).map(([number,r])=>({number,uri:r?.uri,title:r?.title||'',where:`编号 ${number}`}));
    }else{
      const delimiter=format==='tsv'?'\t':',',table=[];let row=[],field='',quoted=false,closed=false,line=1,start=1;
      for(let i=0;i<=text.length;i++){
        const c=text[i];
        if(quoted){if(c===undefined)fail(`第 ${start} 行`,'引号未闭合');if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else{field+=c;if(c==='\n')line++;}continue;}
        if(c==='"'){if(field||closed)fail(`第 ${line} 行`,'引号必须位于字段开头，字段内引号写作两个双引号');quoted=true;continue;}
        if(c===delimiter){row.push(field);field='';closed=false;continue;}
        if(c==='\r'||c==='\n'||c===undefined){row.push(field);if(row.some(v=>v.trim()))table.push({values:row,line:start});row=[];field='';closed=false;if(c==='\r'&&text[i+1]==='\n')i++;line++;start=line;continue;}
        if(closed)fail(`第 ${line} 行`,'关闭引号后只能接分隔符或换行');field+=c;
      }
      if(!table.length)fail('文献列表','文件为空');
      const header=table.shift().values.map(v=>v.trim().toLowerCase());
      if(new Set(header).size!==header.length)fail('表头','列名重复');
      for(const key of ['number','uri'])if(!header.includes(key))fail('表头',`缺少必填列 ${key}；可选列为 title`);
      for(const key of header)if(!['number','uri','title'].includes(key))fail('表头',`未知列 ${key}；仅支持 number、uri、title`);
      rows=table.map(r=>{if(r.values.length!==header.length)fail(`第 ${r.line} 行`,`应有 ${header.length} 列，实际为 ${r.values.length} 列；含分隔符的标题需加双引号`);return {...Object.fromEntries(header.map((k,i)=>[k,r.values[i]])),where:`第 ${r.line} 行`};});
    }
    if(!rows.length)fail('文献列表','没有文献记录');if(rows.length>2000)fail('文献列表','记录超过 2000 条');
    const result={},seen=new Map();
    for(const r of rows){
      const number=String(r.number??'').trim(),uri=String(r.uri??'').trim();
      if(!/^[1-9]\d{0,4}$/.test(number))fail(r.where,'number 必须是 1～99999 的整数');
      if(Object.hasOwn(result,number))fail(r.where,`编号 ${number} 重复`);
      if(!/^https?:\/\/(?:www\.)?zotero\.org\/(?:users\/(?:local\/[A-Za-z0-9]+|\d+)|groups\/\d+)\/items\/[A-Z0-9]{8}\/?$/.test(uri))fail(r.where,`编号 ${number} 的 uri 不是有效的 Zotero 条目 URI；请从已导出的文献列表复制`);
      const identity=uri.replace(/^http:/,'https:').replace('://www.zotero.org','://zotero.org').replace(/\/$/,'');
      if(!options.live&&!options.allowDuplicates&&seen.has(identity))fail(r.where,`与编号 ${seen.get(identity)} 使用了同一文献 URI`);
      seen.set(identity,number);result[number]={uri,title:String(r.title||''),where:r.where};
    }
    return result;
  }
  function stringify(data,format='csv'){
    if(format==='json')return JSON.stringify(data,null,2)+'\n';
    const separator=format==='tsv'?'\t':',';
    const escape=value=>{const s=String(value??'');return /["\r\n,\t]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
    return '\uFEFF'+[['number','uri','title'],...Object.entries(data.mapping).sort(([a],[b])=>Number(a)-Number(b)).map(([n,r])=>[n,r.uri,r.title])].map(row=>row.map(escape).join(separator)).join('\r\n')+'\r\n';
  }
  function example(){return stringify({mapping:{1:{uri:'https://zotero.org/users/123456/items/ABCD1234',title:'示例：请将 URI 替换为当前 Zotero 资料库中的真实条目 URI'}}});}
  return {parse,stringify,example};
});
