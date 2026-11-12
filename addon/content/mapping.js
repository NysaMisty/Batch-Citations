/* SPDX-License-Identifier: MIT */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ZBMapping=factory();})(globalThis,function(){
  'use strict';
  function sequenceStatus(values){
    const numbers=[...new Set(values.map(Number))].sort((a,b)=>a-b);
    if(numbers.some(n=>!Number.isInteger(n)||n<1||n>99999))throw new Error('引用编号必须是 1 至 99999 的整数。');
    const missingRanges=[];
    for(let i=1;i<numbers.length;i++)if(numbers[i]>numbers[i-1]+1)missingRanges.push([numbers[i-1]+1,numbers[i]-1]);
    return {numbers,start:numbers[0]??null,end:numbers.at(-1)??null,consecutive:!!numbers.length&&!missingRanges.length,startsAtOne:numbers[0]===1,missingRanges};
  }
  function describeRanges(ranges){return ranges.slice(0,12).map(([a,b])=>a===b?`[${a}]`:`[${a}]–[${b}]`).join('、')+(ranges.length>12?' 等':'');}
  function recordKeys(item){
    const keys=[];
    if(item?.id)keys.push('id:'+item.id);
    for(const uri of item?.uris||[])if(typeof uri==='string'&&uri.trim())keys.push('uri:'+uri.trim().replace(/^https?:\/\/(?:www\.)?zotero\.org\//i,'zotero.org/').replace(/\/+$/,''));
    return keys;
  }
  function assertUnique(mapping){
    const owners=new Map();
    for(const [n,item]of Object.entries(mapping)){
      if(!item)continue;
      const keys=recordKeys(item);if(!keys.length)throw new Error(`编号 [${n}] 的文献标识无效。`);
      for(const key of keys){
        const other=owners.get(key);
        if(other!==undefined&&other!==n)throw new Error(`该文献已分配给编号 [${other}]，不能再分配给 [${n}]。请另选文献，或先清空原编号的映射。`);
        owners.set(key,n);
      }
    }
    return mapping;
  }
  function assignUnique(mapping,number,item){
    const keys=new Set(recordKeys(item));
    for(const [other,record]of Object.entries(mapping))if(other!==String(number)&&recordKeys(record).some(key=>keys.has(key)))throw new Error(`该文献已分配给编号 [${other}]，不能再分配给 [${number}]。请另选文献，或先清空原编号的映射。`);
    const candidate={...mapping,[number]:item};assertUnique(candidate);return candidate;
  }
  function assignPlain(mapping,number,item){
    if(!recordKeys(item).length)throw new Error(`编号 [${number}] 的文献标识无效。`);
    return {...mapping,[number]:item};
  }
  function duplicateNumbers(mapping,number,item){
    const keys=recordKeys(item),uris=keys.filter(key=>key.startsWith('uri:'));
    return Object.entries(mapping).filter(([n,record])=>{
      if(n===String(number))return false;
      const others=recordKeys(record),otherURIs=others.filter(key=>key.startsWith('uri:'));
      return uris.length&&otherURIs.length?otherURIs.some(key=>uris.includes(key)):others.some(key=>keys.includes(key));
    }).map(([n])=>Number(n)).sort((a,b)=>a-b);
  }
  class OrderedSession{
    constructor(numbers,mapping={},lockedNumbers=[],options={}){
      const status=sequenceStatus(numbers);
      if(!status.numbers.length&&!options.allowEmpty)throw new Error('没有可供选择文献的原编号。');
      this.unique=options.unique!==false;
      if(this.unique)assertUnique(mapping);this.numbers=status.numbers;this.initial={...mapping};this.mapping={...mapping};this.locked=new Set(lockedNumbers);
      if([...this.locked].some(n=>!this.mapping[n]))throw new Error('已绑定编号缺少文献，不能开始选择文献。');
      this.currentNumber=this.numbers.find(n=>!this.mapping[n]&&!this.locked.has(n))??this.numbers.find(n=>!this.locked.has(n))??null;
      if(options.focusNumber!==undefined)this.edit(options.focusNumber);
    }
    get count(){return this.numbers.filter(n=>!!this.mapping[n]).length;}
    get complete(){return this.count===this.numbers.length;}
    editable(number){return this.numbers.includes(number)&&!this.locked.has(number);}
    edit(number){if(!this.numbers.includes(number))throw new Error('编号不在本次批量选择中。');if(!this.editable(number))throw new Error('该原编号已绑定或不在本次修改范围内。');this.currentNumber=number;}
    clear(number){this.edit(number);delete this.mapping[number];}
    skip(){
      const index=this.numbers.indexOf(this.currentNumber);
      this.currentNumber=this.numbers.slice(index+1).find(n=>!this.mapping[n]&&this.editable(n))??null;
    }
    canMove(fromNumber,toNumber){
      const from=this.numbers.indexOf(fromNumber),to=this.numbers.indexOf(toNumber);
      return from>=0&&to>=0&&!!this.mapping[fromNumber]&&
        !this.numbers.slice(Math.min(from,to),Math.max(from,to)+1).some(n=>this.locked.has(n));
    }
    move(fromNumber,toNumber){
      if(!this.canMove(fromNumber,toNumber))throw new Error('只能在未绑定的编号之间移动已选文献，不能跨越已绑定编号。');
      const from=this.numbers.indexOf(fromNumber),to=this.numbers.indexOf(toNumber);
      if(from===to)return;
      const order=[...this.numbers];order.splice(to,0,order.splice(from,1)[0]);
      const candidate={...this.mapping};
      for(let i=0;i<this.numbers.length;i++){
        const item=this.mapping[order[i]],n=this.numbers[i];
        if(item)candidate[n]=item;else delete candidate[n];
      }
      if(this.unique)assertUnique(candidate);
      const target=this.currentNumber===null?null:this.numbers[order.indexOf(this.currentNumber)];
      this.mapping=candidate;this.currentNumber=target;
    }
    assign(item){
      if(this.currentNumber===null)throw new Error('请先选择需要匹配文献的编号。');
      this.mapping=this.unique?assignUnique(this.mapping,this.currentNumber,item):assignPlain(this.mapping,this.currentNumber,item);
      const index=this.numbers.indexOf(this.currentNumber),order=[...this.numbers.slice(index+1),...this.numbers.slice(0,index)];
      this.currentNumber=order.find(n=>!this.mapping[n]&&this.editable(n))??null;
    }
    finish(){if(this.unique)assertUnique(this.mapping);return {...this.mapping};}
    changes(){return Object.fromEntries(this.numbers.filter(n=>this.mapping[n]!==this.initial[n]).map(n=>[n,this.mapping[n]||null]));}
  }
  return {sequenceStatus,describeRanges,assertUnique,assignUnique,assignPlain,duplicateNumbers,OrderedSession};
});
