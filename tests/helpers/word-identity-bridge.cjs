'use strict';
const fs=require('node:fs');
const root=require('node:path').resolve(__dirname,'../..');
const live=require(root+'/addon/content/live-core.js');
const core=require(root+'/addon/content/core.js');
const {Service}=require(root+'/addon/content/live-service.js');
const [action,inputPath,outputPath,beforePath,planPath]=process.argv.slice(2);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const input=read(inputPath);
(async()=>{
 let output;
 if(action==='plan'){
  const restored=live.restoreBindings(input);
  const candidate=live.scan(input).occurrences.find(x=>x.raw==='[8]'&&x.eligible);
  if(!candidate)throw new Error('No eligible marker [8]');
  const existing=restored.mapping[1];
  const record=input.name==='repeat-probe'?existing:{id:8,uris:['http://zotero.org/users/local/TEST/items/HHHH8888'],itemData:{id:8,type:'book',title:'H'}};
  output=live.plan(input,[candidate.key],{...restored.mapping,8:record},{styleID:'ieee',locale:'en-US',zoteroVersion:'10.0.7',numeric:true});
  output.staged=true;output.transactionId='tx-review';
 }else if(action==='verify'){
  output={documentKey:input.documentKey,...live.finalizePlan(read(planPath),read(beforePath),input)};
 }else if(action==='refresh'){
  class Data{constructor(s){Object.assign(this,JSON.parse(s));}serialize(){return JSON.stringify(this);}}
  const z={Styles:{init:async()=>{},getVisible:()=>[]},Integration:{DocumentData:Data,currentDoc:false},logError:()=>{}};
  const s=new Service(z,{openLive:()=>{},schedule:()=>{}},{token:'a'.repeat(64),randomID:()=> 'tx-refresh'});
  const {id}=await s.start({command:'refresh',snapshot:input,protocol:3,capabilities:live.capabilities()});
  output=s.job(id).plan;
 }else if(action==='recovery'){output=live.recoveryPlan(input);output.staged=true;}
 else if(action==='refresh-plan'){output=live.refreshPlan(input);output.staged=true;output.transactionId='tx-integrity';}
 else throw new Error('unknown action');
 fs.writeFileSync(outputPath,JSON.stringify(output,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
