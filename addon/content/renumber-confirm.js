/* SPDX-License-Identifier: MIT */
'use strict';
window.addEventListener('load',()=>window.requestAnimationFrame(()=>{
  const width=Math.min(640,window.screen.availWidth-40),height=Math.min(480,window.screen.availHeight-40);
  window.resizeTo(width,height);
  window.moveTo(window.screen.availLeft+(window.screen.availWidth-width)/2,window.screen.availTop+(window.screen.availHeight-height)/2);
}),{once:true});
window.addEventListener('DOMContentLoaded',()=>{
  const io=window.arguments[0].wrappedJSObject||window.arguments[0],H='http://www.w3.org/1999/xhtml';
  try{
  io.accepted=false;io.Zotero?.UIProperties?.registerRoot(document.documentElement);
  const full=document.getElementById('renumber-full'),summary=io.summary;
  const fill=()=>ZBNumberingSummary.renderTable(document,document.getElementById('renumber-summary-lines'),full.checked?summary.rows:summary.changes);
  document.getElementById('renumber-count').textContent=`${summary.changes.length} 项变化 / 共 ${summary.rows.length} 篇文献`;
  const notice=document.getElementById('renumber-notice');notice.textContent=summary.notice;notice.hidden=!summary.notice;
  fill();full.addEventListener('change',fill);
  document.addEventListener('dialogaccept',()=>{io.accepted=true;});
  document.addEventListener('dialogcancel',()=>{io.accepted=false;});
  }catch(e){
    io.accepted=false;io.Zotero?.logError?.(e);
    const error=document.getElementById('renumber-confirm-error');error.hidden=false;error.textContent='编号核对窗口未能加载，请取消后重试。';
    document.querySelector('dialog').getButton('accept').disabled=true;
  }
});
