'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const summary=require('../addon/content/numbering-summary.js');
const {item}=require('./helpers/citations.cjs');
function fixture(pairs,inserted=[]){
  const references=pairs.filter(p=>p[1]!==null).map(([id,old])=>({...item(id,`Title ${id}`),referenceId:`r${id}`}));
  const state={references,display:new Map(references.map(ref=>[ref.referenceId,pairs.find(p=>p[0]===ref.id)[1].map(display=>({display}))]))};
  const plan={preview:{numeric:true,order:pairs.map(([id,old,number])=>({...item(id,`Title ${id}`),number}))},expected:{newNumbers:inserted.map(id=>({record:item(id,`Title ${id}`)}))}};
  return {plan,state};
}
test('summary hides unchanged rows, highlights insertion and merges a contiguous forward shift',()=>{
  const {plan,state}=fixture([[1,[1],1],[2,[2],2],[8,null,3],[3,[3],4],[4,[4],5],[5,[5],6],[6,[6],7],[7,[7],8]],[8]);
  const result=summary.build(plan,state);
  assert.deepEqual(result.lines,['新增：《Title 8》 → [3]','原 [3]–[7] 整体顺延 1 位，现为 [4]–[8]','其余编号不变']);
  assert.equal(result.details.length,8);
  assert.match(result.details[0],/\[1\] → \[1\]/);
});
test('backward shifts merge only consecutive old and new numbers',()=>{
  const {plan,state}=fixture([[5,[5],3],[6,[6],4],[8,[8],6],[9,[9],7]]);
  assert.deepEqual(summary.build(plan,state).lines,['原 [5]–[6] 整体提前 2 位，现为 [3]–[4]','原 [8]–[9] 整体提前 2 位，现为 [6]–[7]']);
});
test('reusing an unchanged reference is highlighted instead of hidden',()=>{
  const {plan,state}=fixture([[1,[1],1],[2,[2],2]],[2]);
  assert.deepEqual(summary.build(plan,state).lines,['复用：《Title 2》 → [2]','其余编号不变']);
  assert.match(summary.build(plan,state).details[1],/复用/);
});
test('a reused reference that moves is highlighted and its old number remains explicit',()=>{
  const {plan,state}=fixture([[3,[3],1],[1,[1],2],[2,[2],3]],[3]);
  assert.equal(summary.build(plan,state).lines[0],'复用：《Title 3》 → [1]（原 [3]）');
  assert.equal(summary.build(plan,state).details.length,3);
});
test('swaps, gaps and irregular moves cannot disappear in a merged run',()=>{
  const {plan,state}=fixture([[2,[2],1],[1,[1],2],[4,[4],4],[3,[3],6]]);
  const result=summary.build(plan,state);
  assert.ok(result.lines.includes('《Title 2》：[2] → [1]'));
  assert.ok(result.lines.includes('《Title 1》：[1] → [2]'));
  assert.ok(result.lines.includes('《Title 3》：[3] → [6]'));
  assert.equal(result.details.length,4);
});
test('ambiguous old displays and number conflicts are explicit and never merged',()=>{
  const {plan,state}=fixture([[1,[1,2],3],[2,[2],4],[3,[3],4],[4,[],5]]);
  const result=summary.build(plan,state);
  assert.ok(result.lines.some(text=>text.includes('原编号无法唯一确认')));
  assert.ok(result.lines.some(text=>text.includes('编号冲突')));
  assert.equal(result.lines.filter(text=>text.includes('整体')).length,0);
  for(const id of [1,2,3,4])assert.ok(result.lines.some(text=>text.includes(`Title ${id}`)));
});
test('an unverifiable preview shows order and never invents final numeric values',()=>{
  const {plan,state}=fixture([[1,[1],2],[2,null,1]],[2]);
  plan.preview.numeric=false;plan.preview.limited='最终编号由 Zotero 刷新生成。';
  const result=summary.build(plan,state);
  assert.equal(result.lines[0],plan.preview.limited);
  assert.ok(result.lines.some(text=>text==='新增：《Title 2》（最终编号待确认）'));
  assert.ok(!result.lines.some(text=>/→ \[|整体/.test(text)));
  assert.equal(result.details.length,2);
});
test('unknown insertion provenance is never guessed and all unchanged documents stay compact',()=>{
  const {plan,state}=fixture([[1,[1],1],[2,null,2]]);
  delete plan.expected;
  assert.ok(summary.build(plan,state).lines.includes('新增/复用：《Title 2》 → [2]'));
  const unchanged=fixture([[1,[1],1],[2,[2],2]]);
  assert.deepEqual(summary.build(unchanged.plan,unchanged.state).lines,['编号不变']);
});
test('presentation leaves every plan operation, label, field and preview value unchanged',()=>{
  const {plan,state}=fixture([[1,[1],1],[2,null,2]],[2]);
  plan.operations=[{start:20,end:23,code:'native field',raw:'[8]'}];plan.bindingData='original-label-map';
  const before=JSON.stringify(plan);
  function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}}
  freeze(plan);freeze(state.references);
  summary.build(plan,state);summary.build(plan,state);
  assert.equal(JSON.stringify(plan),before);
});
test('a long regular shift stays compact while complete details retain every reference',()=>{
  const pairs=[[9999,null,1],...Array.from({length:1000},(_,i)=>[i+1,[i+1],i+2])];
  const {plan,state}=fixture(pairs,[9999]),result=summary.build(plan,state);
  assert.equal(result.lines.length,2);assert.equal(result.details.length,1001);
  assert.equal(result.lines[1],'原 [1]–[1000] 整体顺延 1 位，现为 [2]–[1001]');
});
test('preview table separates titles from changes and excludes unchanged reused references',()=>{
  const {plan,state}=fixture([[1,[1],1],[8,null,2],[2,[2],3],[3,[3],4]],[1,8]);
  const result=summary.build(plan,state);
  assert.equal(result.rows.length,4);
  assert.deepEqual(result.changes.map(row=>row.name),['Title 8','Title 2','Title 3']);
  assert.deepEqual(result.changes.map(row=>row.change),['新增 → [2]','[2] → [3]','[3] → [4]']);
  assert.equal(result.changes[0].kind,'new');
  assert.equal(result.rows[0].change,'[1] → [1]');
  assert.equal(result.needsConfirmation,true);
});
test('table preview never displays inferred numbers as verified in a nonnumeric style',()=>{
  const {plan,state}=fixture([[1,[1],2],[2,null,1]],[2]);plan.preview.numeric=false;
  const result=summary.build(plan,state);
  assert.ok(result.notice.includes('最终编号'));
  assert.ok(result.rows.every(row=>!row.change.includes('→ [')&&row.change.includes('待确认')));
  assert.ok(result.changes.every(row=>row.kind!=='existing'));
});
