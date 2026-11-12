/* SPDX-License-Identifier: MIT */
'use strict';
const $=id=>document.getElementById(id);
const args=window.arguments[0].wrappedJSObject||window.arguments[0];
const model={path:null,bytes:null,archive:null,mapping:{},bindings:{mapping:{},untracked:[]},labelResolutions:{},invalidMappings:new Map(),previewPlan:null,selected:new Set(),busy:false,mappingWorking:false,focusNumber:null,initialized:false,pendingSnapshot:false,fingerprint:null,liveJob:args.liveJob||null};
const liveService=args.liveService;
const adapter=new ZBAdapter(args.Zotero,window);
window.ZBTest={model,adapter};
let toastTimer,unsubscribe,itemObserver,disposed=false;
function message(text,error=false){window.clearTimeout(toastTimer);const toast=$('message');toast.textContent=text;toast.className=error?'error':'success';toast.hidden=false;toastTimer=window.setTimeout(()=>{toast.hidden=true;},error?6000:4500);}
function node(tag,text){const n=document.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;return n;}
function currentIssues(){
  const raw=[...(model.liveJob?.bindings?.issues||[]),...(model.liveJob?.verificationIssues||[])];
  if(model.archive?.scan.unsupportedCount)raw.push({code:'unsupported-marker',severity:'warning',blocking:false,message:`有 ${model.archive.scan.unsupportedCount} 处不支持的编号标记。`,action:'已保留在“引用位置”中并禁用转换；其他可识别位置仍可使用。'});
  for(const warning of model.liveJob?.snapshot.scanWarnings||[])raw.push({code:warning.code,severity:'warning',blocking:!!warning.blocking,message:`有 ${warning.count} 处标记无法安全定位。`,action:'这些位置未转换，请在 Word 中人工核对。'});
  if(model.liveJob?.checkError)raw.push({code:'snapshot-unavailable',severity:'error',blocking:true,message:model.liveJob.checkError,action:'请回到 Word 核对后重试。'});
  if(model.liveJob?.recoveryPending&&!model.liveJob.recoveryError)raw.push({code:'unfinished-transaction',severity:'warning',blocking:true,message:'上次引用操作尚未完成。',action:'请先核验并恢复，再继续新增引用。'});
  const seen=new Map();
  for(const issue of raw){
    const key=[issue.code,issue.message,issue.number??'',issue.citationID??''].join('|');
    if(seen.has(key))seen.get(key).count++;
    else seen.set(key,{...issue,count:1});
  }
  return [...seen.values()];
}
function blockingIssues(){return currentIssues().filter(issue=>issue.blocking);}
function previewSummary(){
  const preview=model.previewPlan?.preview||model.liveJob?.plan?.preview;
  if(!preview)return '';
  if(!preview.numeric)return preview.limited||'';
  return '当前编号预览仅按本次首次出现顺序核对；最终显示编号仍由 Zotero 按引用样式生成。';
}
function renderStatus(){
  const job=model.liveJob,issues=currentIssues(),blocking=blockingIssues();
  const summary=$('status-summary'),list=$('status-issues');
  summary.hidden=!job;
  if(!job){summary.textContent='';list.hidden=true;list.replaceChildren();return;}
  summary.dataset.state=blocking.length?'error':issues.length?'warning':'normal';
  if(job.state==='verifying')summary.textContent='正在核对提交后的引用域与文献顺序…';
  else if(job.state==='finalizing')summary.textContent='引用域已通过核对，正在写入最终绑定记录…';
  else if(job.state==='needs-recovery')summary.textContent=`提交后验证未通过，已停止最终写入（${blocking.length||issues.length} 项需处理）。`;
  else if(blocking.length)summary.textContent=`${blocking.length} 项需要处理，相关写入已暂停。`;
  else if(issues.length)summary.textContent=`${issues.length} 项提示，请核对后继续。`;
  else summary.textContent='✓ 引用状态正常';
  summary.title=previewSummary();
  list.replaceChildren();
  for(const issue of issues){
    const item=node('li',(issue.message||issue.code)+(issue.count>1?`（${issue.count} 处）`:'')+(issue.action?` ${issue.action}`:''));
    item.dataset.severity=issue.severity||'info';item.dataset.code=issue.code||'';
    list.appendChild(item);
  }
  list.hidden=!issues.length;
}
function ambiguousNumber(n){
  if(!model.archive?.scan.numbers.includes(Number(n)))return null;
  const historical=model.bindings.mapping[n],owners=model.bindings.state?.displayOwners.get(Number(n))||[],current=owners[0]?.record;
  return historical&&current&&!adapter.sameIdentity(historical,current)?{historical,current}:null;
}
function invalidatePreview(){model.previewPlan=null;$('renumber-preview').hidden=true;}
function selectionOptions(){
  const existing=model.liveJob?nativeRecords():{};
  return {valid:record=>model.invalidMappings.get(record)?.invalid!==true&&adapter.mappingRecordValid(record,{existing}),ambiguous:n=>!!ambiguousNumber(n)&&!model.labelResolutions[n]};
}
function reconcileSelection(){
  const next=ZBSelection.reconcile(model.archive?.scan,model.mapping,model.selected,selectionOptions());
  if(next.selected.size!==model.selected.size)invalidatePreview();
  model.selected=next.selected;
  return next;
}
function updateSelection(){
  const {skipped}=reconcileSelection();
  for(const check of document.querySelectorAll('#occurrences input'))check.checked=model.selected.has(check.dataset.key);
  $('selection').textContent=model.mappingWorking?'正在保存文献映射…':model.selected.size?`已选 ${model.selected.size} 处`:'请为编号绑定文献，再在“引用位置”中选择需要转换的位置。';
  if(skipped.length)$('selection').textContent+=`；已取消 ${skipped.length} 处失效选择。`;
  $('convert').disabled=model.busy||model.mappingWorking||!model.selected.size||!!model.bindings.requiresMigration||blockingIssues().length>0||!!model.liveJob?.recoveryPending||!!model.liveJob?.checkError||!!(model.liveJob&&model.liveJob.state!=='pending');
}
async function validateSelectionMapping(numbers,{strict=true}={}){
  const checked={},errors=[],before={...model.mapping};
  for(const n of numbers){
    const record=model.mapping[n];
    if(!record){errors.push(n);continue;}
    try{
      const current=model.liveJob?await adapter.validateLiveMapping({[n]:record},[n],{existing:nativeRecords()}):await adapter.validateMapping({[n]:record},[n]);
      if(model.mapping[n]!==record)throw new Error('文献绑定已变化，请重新核对。');
      checked[n]=current[n];
    }catch(e){model.invalidMappings.set(record,{invalid:true});errors.push(n);}
  }
  reconcileSelection();
  if(errors.length&&strict)throw new Error(`编号 ${errors.map(n=>`[${n}]`).join('、')} 缺少有效文献绑定，相关位置已取消选择，请重新选择文献。`);
  assertCurrentScan();
  if(!adapter.confirmDuplicateBindings(before,checked))throw new Error('已取消重复绑定；文献映射保持不变，请重新核对。');
  assertCurrentScan();
  if(Object.keys(checked).some(n=>model.mapping[n]!==before[n]))throw new Error('文献绑定已变化，请重新核对。');
  model.mapping={...model.mapping,...checked};
  for(const n of Object.keys(checked))model.invalidMappings.delete(before[n]);
  reconcileSelection();
  return checked;
}
function assertSelectedCurrent(keys,mapping){
  assertCurrentScan();
  const current=ZBSelection.reconcile(model.archive.scan,model.mapping,keys,selectionOptions()).selected;
  if(current.size!==keys.length||keys.some(key=>!model.selected.has(key))||Object.entries(mapping).some(([n,record])=>!adapter.sameIdentity(record,model.mapping[n])))
    throw new Error('引用位置或文献绑定已变化，已停止转换，请核对后重试。');
}
function mergeMapping(incoming){
  invalidatePreview();if(!model.liveJob)return {...model.mapping,...incoming};
  for(const [n,record]of Object.entries(incoming)){
    if(model.labelResolutions[n])ZBLiveCore.resolveMarkerMapping(model.bindings,{[n]:record},[n],{labelResolutions:model.labelResolutions});
    else ZBLiveCore.mergeBindings(model.mapping,{[n]:record},model.bindings);
  }
  return {...model.bindings.mapping,...model.mapping,...incoming};
}
function nativeRecords(){return Object.fromEntries((model.bindings.state?.references||[]).map(ref=>[ref.referenceId,ref.record]));}
function matchingNumbers(){return [...new Set([...(model.archive?.scan.numbers||[]),...Object.keys(model.bindings.mapping).map(Number)])].sort((a,b)=>a-b);}
function applyMappingChanges(changes){
  assertCurrentScan();
  const assigned={},cleared=[];
  for(const [n,record]of Object.entries(changes)){
    if(model.bindings.mapping[n]&&(!record||!adapter.sameIdentity(model.bindings.mapping[n],record)))throw new Error(`原编号 [${n}] 已绑定，不能在文献选择中修改。`);
    if(record)assigned[n]=record;else cleared.push(n);
  }
  const candidate=mergeMapping(assigned);
  for(const n of cleared)delete candidate[n];
  model.mapping=candidate;invalidatePreview();
}
function commitReferenceChanges(changes,{isCurrent}={}){
  if(model.busy||disposed||isCurrent&&!isCurrent())throw new Error('当前操作尚未完成或编号已变化，请重新选择。');
  const previous=model.mapping;
  try{applyMappingChanges(changes);renderMapping();rememberReferences();return {...model.bindings.mapping,...model.mapping};}
  catch(error){model.mapping=previous;invalidatePreview();try{renderMapping();}catch{}throw error;}
}
function rememberReferences(){
  if(model.liveJob?.state==='pending'&&model.fingerprint===model.liveJob.snapshot.fingerprint)
    liveService.saveReferenceSelection(model.liveJob.id,{fingerprint:model.fingerprint,mapping:model.mapping});
}
function referenceState(){return {numbers:matchingNumbers(),mapping:{...model.bindings.mapping,...model.mapping},lockedNumbers:Object.keys(model.bindings.mapping).map(Number),existing:nativeRecords()};}
function ensureReferences({reset=false,focusNumber}={}){
  if(disposed||!model.initialized)return;
  const state=referenceState();rememberReferences();
  if(adapter.activePicker){if(reset)adapter.activePicker.update(state);if(focusNumber!==undefined)adapter.chooseReferences(state.numbers,state.mapping,state.lockedNumbers,{focusNumber});return;}
  const pending=adapter.chooseReferences(state.numbers,state.mapping,state.lockedNumbers,{live:!!model.liveJob,existing:state.existing,persistent:true,focusNumber,
    onApply:commitReferenceChanges,
    onChange:state=>{if(model.mappingWorking===state.working&&model.focusNumber===state.focusNumber)return;model.mappingWorking=state.working;model.focusNumber=state.focusNumber;if(!disposed){updateTarget();updateControls();}}});
  pending.catch(error=>{if(!disposed){model.mappingWorking=false;message(error.message||String(error),true);updateControls();}});
}
function chooseReferences(number){ensureReferences({focusNumber:number});}
function targetButton(number,text){
  const button=node('button',text);button.className='mapping-target';button.dataset.targetNumber=String(number);
  const ambiguity=ambiguousNumber(number);
  if(ambiguity)button.title='当前编号存在两个可能的文献来源，点击可核对来源。';
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(ambiguity)return action(async()=>{await confirmNumberSource(number,ambiguity);if(model.labelResolutions[number]&&!referenceState().lockedNumbers.includes(number))chooseReferences(number);});chooseReferences(number);});return button;
}
function updateTarget(){
  for(const button of document.querySelectorAll('[data-target-number]')){
    const current=Number(button.dataset.targetNumber)===model.focusNumber;
    button.setAttribute('aria-pressed',String(current));button.classList.toggle('current-target',current);
  }
}
function currentDocumentSettings(){return model.liveJob?ZBLiveCore.documentSettings(model.liveJob.snapshot.documentData,data=>new adapter.Zotero.Integration.DocumentData(data),model.liveJob.snapshot):null;}
function updateControls(){
  for(const id of ['layout-stacked','layout-side'])$(id).disabled=false;
  const pending=!model.liveJob||model.liveJob.state==='pending';
  const editable=!!model.archive&&pending&&!model.liveJob?.recoveryPending&&!model.liveJob?.checkError;
  $('open').disabled=model.busy||model.mappingWorking||!!model.liveJob;
  for(const id of ['import-map','select-all','select-none'])$(id).disabled=model.busy||model.mappingWorking||!editable;
  $('import-map').title='恢复插件已导出的文献列表';
  $('export-map').disabled=model.busy||!Object.keys(model.mapping).length;
  $('binding-recovery').hidden=!model.liveJob||(!model.liveJob.recoveryPending&&!model.bindings.untracked.length&&!model.bindings.conflicts?.length&&!model.bindings.carrierChanges?.length);
  $('binding-hint').textContent=model.liveJob?.recoveryPending?'先核验上次操作，再完成刷新或记录同步。':'同步只更新辅助记录；已有引用内容由 Zotero 管理。';
  $('recover-bindings').textContent=model.liveJob?.recoveryPending?'核验并恢复上次操作':model.bindings.conflicts?.length?'核对引用变更…':'同步引用记录';
  $('recover-bindings').disabled=model.busy||!pending||!!model.liveJob?.recoveryError||!!model.liveJob?.checkError;
  $('cancel').disabled=model.busy||model.mappingWorking||!!(model.liveJob&&['ready','running','verifying','finalizing'].includes(model.liveJob.state));
  for(const id of ['style','locale'])$(id).disabled=model.busy||!!currentDocumentSettings()||!editable;
  document.querySelectorAll('#occurrences [data-target-number]').forEach(b=>b.disabled=model.busy||!editable);
  const selectionRules=selectionOptions();
  document.querySelectorAll('#occurrences input').forEach(c=>{
    const occurrence=model.archive?.scan.occurrences.find(o=>o.key===c.dataset.key),ready=occurrence&&ZBSelection.state(occurrence,model.mapping,selectionRules).selectable;
    c.disabled=model.busy||!editable||!ready;
  });
  adapter.activePicker?.setDisabled(model.busy||!editable||!!model.bindings.requiresMigration||blockingIssues().length>0);
  updateTarget();updateNumberCheck();updateSelection();renderStatus();
}
async function action(fn){if(model.busy||disposed)return;model.busy=true;adapter.activePicker?.setDisabled(true);document.querySelectorAll('button').forEach(b=>b.disabled=true);for(const id of ['style','locale'])$(id).disabled=true;try{await fn();}catch(e){adapter.Zotero.logError(e);if(!disposed)message(e.message||String(e),true);}finally{model.busy=false;if(!disposed){if(model.pendingSnapshot){model.pendingSnapshot=false;applyLiveSnapshot();}updateControls();}}}
function assertCurrentScan(){if(model.liveJob&&model.fingerprint!==model.liveJob.snapshot.fingerprint)throw new Error('引用编号已变化，已自动更新检查。请核对最新文献和位置后重试。');}
function updateNumberCheck(){
  const manual=ZBMapping.sequenceStatus(matchingNumbers());
  const s=ZBMapping.sequenceStatus(model.liveJob?model.liveJob.numberCheck:manual.numbers);
  const info=$('number-check');info.className='check-result '+(model.liveJob?.checkError||s.numbers.length&&!s.consecutive?'error':'hint');
  info.hidden=blockingIssues().length>0;
  if(info.hidden){info.textContent='';return;}
  if(!s.numbers.length)info.textContent='未发现可检查的正文引用编号。新增或修改编号后将自动检查。';
  else if(!s.consecutive)info.textContent='编号不连续，缺号：'+ZBMapping.describeRanges(s.missingRanges)+'。选择文献时按实际编号继续，请核对缺号。';
  else info.textContent=`${s.numbers.length} 个编号 · 编号连续`+(manual.numbers.length&&!manual.consecutive?'；待匹配编号不连续，选择文献时按实际编号继续。':'')+(s.startsAtOne?'':`；从 [${s.start}] 开始，请核对前文。`);
  info.title=s.numbers.length?`编号范围：[${s.start}]–[${s.end}]`:'';
}
async function confirmNumberSource(n,ambiguity){
  if(model.mappingWorking)throw new Error('正在保存文献映射，请稍后核对编号来源。');
  const fingerprint=model.fingerprint,choices=[{source:'current',record:ambiguity.current,label:'当前显示编号'},{source:'historical',record:ambiguity.historical,label:'历史输入标签'}],selected={value:0};
  const labels=choices.map(choice=>`${choice.label} [${n}]：《${choice.record.itemData?.title||choice.record.uris[0]}》`);
  if(!Services.prompt.select(window,'确认编号对应文献','当前编号与历史标签对应不同文献，请按本次引用意图选择。',labels.length,labels,selected))return;
  const choice=choices[selected.value];
  if(!adapter.confirmDuplicateBindings(model.mapping,{[n]:choice.record}))return;
  assertCurrentScan();if(fingerprint!==model.fingerprint)throw new Error('引用编号已变化，请核对最新文献后重试。');
  model.labelResolutions[n]={source:choice.source,uris:[...choice.record.uris]};
  model.mapping[n]=choice.record;invalidatePreview();renderMapping();ensureReferences({reset:true});
}
function renderMapping(){if(model.archive)renderOccurrences();}
function renderPreview(plan){
  const details=$('renumber-preview'),body=$('renumber-preview-body');body.replaceChildren();details.hidden=false;
  $('renumber-preview-summary').textContent='编号变化预览';
  const summary=ZBNumberingSummary.build(plan,model.bindings.state);
  const notice=$('renumber-preview-notice');notice.textContent=summary.notice;notice.hidden=!summary.notice;
  const full=$('renumber-preview-full');full.checked=false;
  const show=()=>{ZBNumberingSummary.renderTable(document,body,full.checked?summary.rows:summary.changes);$('renumber-preview-count').textContent=`${summary.changes.length} 项变化 / 共 ${summary.rows.length} 篇文献`;};
  full.onchange=show;show();
  details.open=true;return summary;
}
function renderOccurrences(){
  reconcileSelection();const selectionRules=selectionOptions();
  const body=$('occurrences');body.replaceChildren();
  for(const o of model.archive.scan.occurrences){
    const status=ZBSelection.state(o,model.mapping,selectionRules);
    const row=node('tr'),cell=node('td'),check=node('input');check.type='checkbox';check.disabled=!status.selectable;check.dataset.eligible=String(o.eligible);check.dataset.key=o.key;check.checked=model.selected.has(o.key);check.setAttribute('aria-label',`转换 ${o.raw}，${o.context}`);
    check.addEventListener('change',()=>{if(check.checked&&ZBSelection.state(o,model.mapping,selectionOptions()).selectable)model.selected.add(o.key);else model.selected.delete(o.key);invalidatePreview();updateSelection();});cell.appendChild(check);row.appendChild(cell);
    const marker=node('td');marker.title=o.raw;
    for(const n of o.numbers||[]){
      const locked=referenceState().lockedNumbers.includes(n);
      marker.appendChild(locked&&!ambiguousNumber(n)?node('span',`[${n}]`):targetButton(n,`[${n}]`));
    }
    if(!marker.children.length)marker.textContent=o.raw;
    row.appendChild(marker);const context=node('td',o.context);context.title=o.context;row.appendChild(context);const state=node('td',status.selectable?(model.liveJob?'正文，可转换':`第 ${o.paragraph+1} 段，可转换`):status.reason);state.title=state.textContent;row.appendChild(state);body.appendChild(row);
  }
}
function applyLiveSnapshot(){
  const job=model.liveJob,scan=job.scan;
  if(!model.fingerprint&&job.referenceSelection?.fingerprint===job.snapshot.fingerprint)model.mapping={...job.referenceSelection.mapping};
  if(model.fingerprint!==job.snapshot.fingerprint){model.labelResolutions={};invalidatePreview();}
  model.bindings=job.bindings;
  const next=ZBLiveCore.reconcileScan(model.archive?.scan,scan,model.mapping,model.selected,model.bindings);
  if(job.state==='pending')model.mapping=next.mapping;
  if(job.state==='pending')for(const n of scan.numbers){
    const owners=model.bindings.state?.displayOwners.get(n)||[];
    if(!model.mapping[n]&&owners.length===1)model.mapping[n]=owners[0].record;
  }
  model.selected=next.selected;model.archive={scan};model.path=job.snapshot.path;model.fingerprint=job.snapshot.fingerprint;
  $('filename').textContent=job.snapshot.name;
  $('scan-summary').textContent=`${scan.occurrences.filter(o=>o.eligible).length} 处待转换位置 · ${scan.numbers.length} 个原编号；已有引用和参考文献表受保护。`;
  renderMapping();ensureReferences({reset:true});updateControls();
}
function jobChanged({type,job}){
  if(type==='snapshot'){
    if(model.busy){model.pendingSnapshot=true;adapter.activePicker?.update(referenceState());}
    else applyLiveSnapshot();
  }else if(type==='check-error'){
    message(job.checkError,true);updateControls();
  }else{
    if(type==='done')message('Word 已完成引用插入与刷新，请回到文档查看并保存。');
    if(type==='needs-recovery')message('提交后验证未通过，已停止最终写入。请核对状态区列出的项目。',true);
    if(type==='error'||type==='cancelled')message(job.message||'已取消引用操作。',type==='error');
    updateControls();
  }
}
async function loadDocument(path){
  const {bytes,archive}=await adapter.readDocument(path);
  model.path=path;model.bytes=bytes;model.archive=archive;model.mapping={};model.selected.clear();
  $('filename').textContent=path.split(/[\\/]/).at(-1);$('filename').title=path;
  const eligible=archive.scan.occurrences.filter(o=>o.eligible).length;
  $('scan-summary').textContent=`发现 ${archive.scan.occurrences.length} 处候选，其中 ${eligible} 处可转换，涉及 ${archive.scan.numbers.length} 个编号。`+(archive.excluded.length?' 其他位置未转换：'+archive.excluded.map(x=>`${x.part}（${x.count} 处）`).join('；'):'');
  renderMapping();ensureReferences({reset:true});updateNumberCheck();message('请为编号选择文献，并勾选需要转换的位置。');
}
window.ZBTest.loadDocument=loadDocument;
window.ZBTest.refresh=()=>{renderMapping();ensureReferences({reset:true});updateControls();};
$('open').addEventListener('click',()=>action(async()=>{const path=await adapter.pickFile();if(path)await loadDocument(path);}));
$('recover-bindings').addEventListener('click',()=>action(async()=>{
  if(model.liveJob.recoveryPending){assertCurrentScan();liveService.resume(model.liveJob.id);message('已提交核验恢复，请等待 Word 完成。');return;}
  if(!model.bindings.conflicts?.length){
    assertCurrentScan();liveService.sync(model.liveJob.id);
    message('已提交绑定记录同步，请等待 Word 完成核对；引用内容和显示编号不会改变。');
    return;
  }
  const confirmed={...model.bindings.mapping};
  for(const n of model.bindings.conflicts||[]){
    const detail=model.bindings.conflictDetails?.[n],current=detail?.current;
    if(!current)throw new Error(`编号 [${n}] 的当前引用内容暂时无法读取，请回到 Word 核对后重试。`);
    const title=current.itemData?.title||current.uris?.[0]||'未知文献';
    if(!Services.prompt.confirm(window,'确认显式替换',`编号 [${n}] 的引用内容现在是《${title}》。\n只有确认这是你在 Zotero 中用 Add/Edit Citation 做出的显式替换时，才可更新绑定。\n普通匹配不会覆盖已有绑定。是否确认？`))return;
    confirmed[n]=current;
  }
  for(const unknown of model.bindings.untracked){
    if(model.bindings.state.ledgerPresent)continue;
    const input={value:''},title=unknown.record.itemData?.title||unknown.record.uris[0];
    if(!Services.prompt.prompt(window,'恢复旧版原编号绑定',`文献：${title}\n出现在 ${unknown.citations.length} 个引用字段。请输入这篇文献在原稿中的编号（1～99999）。\n最终显示编号由 Zotero 排版，可能与原编号不同；请按原稿核对。`,input,null,{}))return;
    if(!/^[1-9]\d{0,4}$/.test(input.value.trim()))throw new Error('原编号必须为 1 至 99999 的整数。');
    const n=input.value.trim();if(confirmed[n])throw new Error(`原编号 [${n}] 已有绑定，请重新核对。`);
    confirmed[n]=unknown.record;
  }
  const recovery=ZBLiveCore.recoverBindings(model.liveJob.snapshot,confirmed);
  const summary=recovery.expected.newNumbers.map(({number,record})=>`历史标签 [${number}] ${record.itemData.title}`).join('\n');
  if(!Services.prompt.confirm(window,'确认原编号对应关系',summary+'\n\n应用后将把这些对应关系保存到当前 Word 文档。现有引用内容由 Zotero 保持。是否应用？'))return;
  assertCurrentScan();liveService.recover(model.liveJob.id,await adapter.validateLiveMapping(confirmed,Object.keys(confirmed),{existing:nativeRecords()}));
  message('已提交原编号恢复，请等待 Word 完成；重新打开后已有绑定受保护。');
}));
$('select-all').addEventListener('click',()=>action(async()=>{
  await validateSelectionMapping(model.archive.scan.numbers,{strict:false});assertCurrentScan();
  const result=ZBSelection.reconcile(model.archive.scan,model.mapping,null,selectionOptions());model.selected=result.selected;
  invalidatePreview();renderOccurrences();
  const missing=result.skipped.filter(o=>o.missing.length),uncertain=result.skipped.filter(o=>o.ambiguous.length),numbers=[...new Set(missing.flatMap(o=>o.missing))];
  message(`已选择 ${model.selected.size} 处可转换位置。`+(missing.length?` 跳过 ${missing.length} 处缺少有效文献绑定的位置（${numbers.slice(0,12).map(n=>`[${n}]`).join('、')}${numbers.length>12?'等':''}）。`:'')+(uncertain.length?` ${uncertain.length} 处需先确认编号来源。`:''));
}));
$('select-none').addEventListener('click',()=>{model.selected.clear();invalidatePreview();renderOccurrences();updateControls();message('已取消全部位置选择。');});
$('cancel').addEventListener('click',()=>window.close());
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('list-more').open){event.preventDefault();$('list-more').open=false;$('list-more').querySelector('summary').focus();return;}if(event.key==='Escape'&&!$('cancel').disabled){event.preventDefault();window.close();}});
document.addEventListener('pointerdown',event=>{if(!$('list-more').contains(event.target))$('list-more').open=false;});
$('import-map').addEventListener('click',()=>action(async()=>{const path=await adapter.pickFile(false,'','literature');if(path){const incoming=await adapter.importMapping(path,{live:!!model.liveJob}),allowed=new Set(matchingNumbers().map(String)),changes=Object.fromEntries(Object.entries(incoming).filter(([n])=>allowed.has(n)));assertCurrentScan();const candidate=mergeMapping(changes);if(!adapter.confirmDuplicateBindings(model.mapping,changes))return;assertCurrentScan();model.mapping=candidate;renderMapping();ensureReferences({reset:true});message('已导入文献列表，请核对标题和位置。');}}));
$('export-map').addEventListener('click',()=>action(async()=>{const format=$('list-format').value||'csv',path=await adapter.pickFile(true,'citation-literature-list.'+format,format);if(path){const actual=/\.(csv|tsv|json)$/i.exec(path)?.[1]?.toLowerCase()||format;await adapter.writeNew(path,new TextEncoder().encode(ZBLiterature.stringify(adapter.exportMapping(model.mapping,{live:!!model.liveJob}),actual)));message('文献列表已保存：'+path);}}));
$('convert').addEventListener('click',()=>action(async()=>{
  const keys=[...model.selected],selected=ZBCore.selectedOccurrences(model.archive.scan,keys),numbers=[...new Set(selected.flatMap(o=>o.numbers))];
  const mapping=await validateSelectionMapping(numbers);assertSelectedCurrent(keys,mapping);
  if(model.liveJob){
    assertCurrentScan();
    const capability=await adapter.styleCapabilities($('style').value);
    if(!capability.firstUse)throw new Error(capability.reason+' 请使用 Zotero 原生插入，或选择按首次出现顺序的数字样式。');
    const plan=liveService.prepare(model.liveJob.id,selected.map(o=>o.key),mapping,{styleID:$('style').value,locale:$('locale').value,zoteroVersion:adapter.Zotero.version,numeric:true,labelResolutions:model.labelResolutions});
    await adapter.previewLive(plan,$('locale').value);assertCurrentScan();model.previewPlan=plan;renderMapping();const summary=renderPreview(plan);
    if(plan.preview.numeric&&summary.needsConfirmation){
      const io={summary,Zotero:adapter.Zotero,accepted:false};
      window.openDialog('chrome://zotero-batch-citations/content/renumber-confirm.xhtml','zbc-renumber-confirm','chrome,modal,centerscreen,resizable',io);
      if(!io.accepted)return;
      assertCurrentScan();
    }
    await validateSelectionMapping(numbers);assertSelectedCurrent(keys,mapping);
    liveService.submitPrepared(model.liveJob.id,plan);
    message('已提交到 Word。请等待当前文档完成插入和刷新；无需关闭文档。');
    return;
  }
  await adapter.assertUnchanged(model.path,model.bytes);
  const path=await adapter.pickFile(true,model.path.split(/[\\/]/).at(-1).replace(/\.docx$/i,'-zotero.docx'));if(!path)return;
  if(!/\.docx$/i.test(path))throw new Error('导出文件名必须以 .docx 结尾。');
  const styleID=$('style').value,locale=$('locale').value;
  const rendered=await adapter.render(selected,mapping,styleID,locale);
  const out=ZBArchive.convert(model.archive,selected.map(o=>o.key),mapping,rendered,{styleID,locale,zoteroVersion:adapter.Zotero.version},adapter.env);
  await validateSelectionMapping(numbers);assertSelectedCurrent(keys,mapping);
  await adapter.assertUnchanged(model.path,model.bytes);await adapter.writeNew(path,out.bytes);
  message(`已导出：${path}\n转换 ${out.count} 处引用，生成 1 处参考文献表，保留 ${out.skipped} 处未选或受保护的候选。\n请用 Microsoft Word 打开副本，点击 Zotero → Refresh（刷新），再用 Add/Edit Citation 检查引用。`);
}));
window.addEventListener('DOMContentLoaded',()=>action(async()=>{
  adapter.Zotero.UIProperties?.registerRoot(document.documentElement);
  model.initialized=true;ZBPickerLayout.mount(adapter);ensureReferences();
  const info=adapter.checkAPIs();$('version').textContent=`Zotero ${info.version} · ${info.platform}`;
  const styles=await adapter.styles();
  for(const style of styles)$('style').appendItem(style.title,style.id);
  const preferred=styles.find(s=>s.id.endsWith('/china-national-standard-gb-t-7714-2015-numeric'))||styles.find(s=>s.id.endsWith('/ieee'));
  $('style').value=preferred?.id||styles[0]?.id||'';$('locale').value='zh-CN';
  if(!styles.length)throw new Error('请先在 Zotero 设置中安装一个带参考文献表的正文引用样式。');
  if(model.liveJob){
    const job=model.liveJob;
    $('workflow').textContent='选择文献，核对位置，插入当前 Word 文档';
    $('output-heading').textContent='在当前 Word 文档插入';$('convert').textContent='插入并刷新当前文档';
    $('output-hint').textContent='最终编号由引用样式生成；已有引用沿用文档设置。';
    const settings=currentDocumentSettings();
    if(settings){
      $('style').value=settings.style.styleID;$('locale').value=settings.style.locale||'zh-CN';
    }
    applyLiveSnapshot();
    message('请选择文献，并勾选确实需要转换的编号位置。');
  }else{
    $('output-heading').textContent='生成引用副本';$('convert').textContent='导出新的 DOCX';
    $('output-hint').textContent='导出副本后在 Word 中检查 Zotero 引用；原文件保留。';
  }
}));
if(model.liveJob)unsubscribe=liveService.subscribe(model.liveJob.id,jobChanged);
if(adapter.Zotero.Notifier)itemObserver=adapter.Zotero.Notifier.registerObserver({notify(event,type){
  if(disposed||type!=='item'||!model.archive)return;
  model.invalidMappings.clear();invalidatePreview();renderMapping();updateControls();
}},['item'],'batch-citations-selection');
window.addEventListener('unload',function dispose(event){if(event.target!==document)return;window.removeEventListener('unload',dispose);disposed=true;window.clearTimeout(toastTimer);adapter.activePicker?.close();unsubscribe?.();if(itemObserver)adapter.Zotero.Notifier.unregisterObserver(itemObserver);if(model.liveJob)liveService.cancel(model.liveJob.id);});
