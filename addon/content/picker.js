/* SPDX-License-Identifier: MIT */
globalThis.ZBPicker={
  owners:new WeakMap(),
  open(adapter,{focusNumber,mapping={},numbers,lockedNumbers=[],live=false,existing={},persistent=false,onApply,onChange}){
    const parent=adapter.window,active=this.owners.get(parent);
    if(active){active.adapters.add(adapter);adapter.activePicker=active.picker;active.focus(focusNumber);return active.promise;}
    let session=new ZBMapping.OrderedSession(numbers,mapping,lockedNumbers,{unique:false,focusNumber,allowEmpty:persistent}),baseline={...mapping},revision=0,focusRevision=0,disabled=false;
    const validate=(candidate,keys)=>live?adapter.validateLiveMapping(candidate,keys,{existing}):adapter.validateMapping(candidate,keys);
    const H='http://www.w3.org/1999/xhtml',owners=this.owners,owner={adapters:new Set([adapter])};
    owners.set(parent,owner);
    owner.promise=new Promise((resolve,reject)=>{
      const picker=parent,doc=parent.document,host=doc.getElementById('zbc-reference-workspace');
      let view,settled=false,installed=false,nativeReady=false,working=false,toastTimer,geometryObserver,geometryFrame,panel,status,heading,list,skip,indicator,dragNumber=null,pending=Promise.resolve(),queued=0,lastChoice=null,selectionGesture=null,nativeTree;
      const handle={window:parent,document:doc,close:()=>finish(null),get closed(){return settled;},get itemsView(){return view?.itemsView;},update,setDisabled(value){if(disabled===value)return;disabled=value;render();tick(true);}};
      handle.ZBCPicker={get session(){return session;},get working(){return working;},get idle(){return pending;},get ready(){return nativeReady&&!settled;},tick,get error(){return status?.textContent;}};
      function finish(value,error){
        if(settled)return;settled=true;
        parent.clearTimeout(toastTimer);geometryObserver?.disconnect();picker.cancelAnimationFrame(geometryFrame);picker.removeEventListener('resize',scheduleGeometry);parent.removeEventListener('unload',parentClosed);
        if(view){view.onSelect=view.onActivate=view.onError=null;view.itemsView?.selection?.clearSelection?.();}
        nativeTree?.removeEventListener('dblclick',trackPointer,true);nativeTree?.removeEventListener('keydown',trackKey,true);
        panel?.remove();if(host)host.hidden=true;doc.body.classList.remove('zbc-selecting');
        if(owners.get(parent)===owner)owners.delete(parent);
        for(const ownerAdapter of owner.adapters)if(ownerAdapter.activePicker===handle)ownerAdapter.activePicker=null;
        if(error)reject(error);else resolve(value);
      }
      function update(state={}){
        revision++;if(state.numbers)numbers=state.numbers;if(state.lockedNumbers)lockedNumbers=state.lockedNumbers;if(state.existing)existing=state.existing;
        if(state.mapping)baseline={...state.mapping};
        const focus=state.focusNumber??session.currentNumber;
        session=new ZBMapping.OrderedSession(numbers,baseline,lockedNumbers,{unique:false,allowEmpty:persistent,focusNumber:numbers.includes(focus)&&!lockedNumbers.includes(focus)?focus:undefined});
        lastChoice=null;selectionGesture=null;queued=0;working=false;clearDrag();view?.itemsView?.selection?.clearSelection?.();if(installed){render();tick(true);}
      }
      function parentClosed(event){if(event.target===parent.document)finish(null);}
      owner.focus=number=>{
        if(number!==undefined){
          try{session.edit(number);focusRevision++;lastChoice=null;selectionGesture=null;if(installed){render();tick(true);reveal(number);}}
          catch(e){if(installed)notify(e.message,true);}
        }
        if(!settled){doc.getElementById('workspace').selectedIndex=0;doc.getElementById('zotero-tb-search')?.focus();}
      };
      function syncGeometry(){
        geometryFrame=null;if(settled||!panel)return;
        const doc=picker.document,table=doc.getElementById('zotero-items-pane-content'),container=doc.getElementById('zotero-items-tree-container');
        const bounds=table.getBoundingClientRect();
        if(bounds.width<=0)return;
        globalThis.ZBPickerLayout?.mount(adapter).apply();
        const row=doc.querySelector('#zotero-items-tree .row[aria-selected],#zotero-items-tree .row'),height=row?.getBoundingClientRect().height;
        const hint=panel.querySelector('.zbc-picker-instructions'),help=panel.querySelector('.zbc-picker-help');
        if(hint&&skip){const measure=doc.createElementNS(H,'canvas').getContext('2d');measure.font=picker.getComputedStyle(hint).font;const required=heading.scrollWidth+skip.getBoundingClientRect().width+(help?.getBoundingClientRect().width||14)+measure.measureText(hint.textContent).width+48;panel.classList.toggle('zbc-compact-header',panel.clientWidth<required);}
        const values={};
        if(height>=24)values['--zbc-picker-row-height']=Math.min(30,Math.max(28,height))+'px';
        for(const [key,value]of Object.entries(values))if(panel.style.getPropertyValue(key)!==value)panel.style.setProperty(key,value);
      }
      function scheduleGeometry(){if(!settled&&!geometryFrame)geometryFrame=picker.requestAnimationFrame(syncGeometry);}
      function notify(text,error=false){parent.clearTimeout(toastTimer);status.textContent=text;status.className=error?'zbc-picker-error':'zbc-picker-hint';status.hidden=false;if(!error)toastTimer=parent.setTimeout(()=>{status.hidden=true;},4500);}
      const target=()=>session.currentNumber;
      function reveal(number){
        const row=list.querySelector(`[data-number="${number}"]`);if(!row)return;
        const rect=row.getBoundingClientRect(),bounds=list.getBoundingClientRect();
        if(rect.top<bounds.top)list.scrollTop+=rect.top-bounds.top;
        else if(rect.bottom>bounds.bottom)list.scrollTop+=rect.bottom-bounds.bottom;
      }
      function currentRecord(){
        const ids=view?.itemsView?.getSelectedItems(true)||[];
        if(ids.length!==1)throw new Error('请选择一条普通文献。');
        return adapter.itemRecord(adapter.Zotero.Items.get(ids[0]));
      }
      function tick(){
        if(settled)return;
        if(picker.closed){finish(null);return;}
        if(installed)onChange?.({working,focusNumber:target()});
      }
      function selectTarget(number,event){
        if(event?.type==='keydown'&&!['Enter',' '].includes(event.key))return;
        event?.preventDefault();event?.stopPropagation();
        if(disabled||!session.editable(number))return;
        session.edit(number);focusRevision++;lastChoice=null;selectionGesture=null;render();tick();reveal(number);
        list.querySelector(`[data-number="${number}"]`)?.focus();
      }
      function nativeItemID(event){
        const row=event?.target?.closest?.('.row');if(!row)return null;
        const match=String(row.id||'').match(/-row-(\d+)$/);if(!match)return null;
        return view?.itemsView?.getRow?.(Number(match[1]))?.ref?.id??null;
      }
      function trackPointer(event){
        if(event.button!==undefined&&event.button!==0)return;
        const id=nativeItemID(event);if(id===null)return;
        if(event.type!=='dblclick'||event.detail!==2)return;
        // Browsing a row only changes its native highlight. Commit after the
        // native double-click activation, using the target captured for it.
        selectionGesture={id,number:target(),revision,consumed:false};
      }
      function trackKey(event){
        if(event.altKey||event.ctrlKey||event.metaKey||event.repeat||event.key!=='Enter')return;
        const gesture={number:target(),revision,consumed:false,before:[...(view?.itemsView?.getSelectedItems(true)||[])],key:event.key};
        selectionGesture=gesture;
        // Enter is the keyboard equivalent of double-click. Navigation and
        // type-to-search remain browsing actions and never apply a mapping.
        Promise.resolve().then(()=>{
          if(selectionGesture!==gesture)return;
          consumeSelection();
          if(selectionGesture===gesture)selectionGesture=null;
        });
      }
      function consumeSelection(){
        const gesture=selectionGesture,ids=view?.itemsView?.getSelectedItems(true)||[];
        if(!gesture||gesture.consumed||gesture.revision!==revision||ids.length!==1||gesture.id!==undefined&&gesture.id!==ids[0])return pending;
        if(gesture.before&&gesture.key!=='Enter'&&gesture.before.length===1&&gesture.before[0]===ids[0])return pending;
        // Consume before awaiting validation: one down/up/activation sequence saves once.
        // Library refresh/reselection notifications without input never create a binding.
        gesture.consumed=true;return accept(gesture.number);
      }
      function render(){
        const scrollTop=list.scrollTop;
        heading.textContent=(target()===null?(session.numbers.length?'选择编号可更换文献':'暂无待匹配编号'):`当前 [${target()}]`)+` · 已选 ${session.count} / ${session.numbers.length}`;heading.title=heading.textContent;
        list.replaceChildren();
        for(const n of session.numbers){
          const row=picker.document.createElementNS(H,'li');
          row.className=n===target()?'zbc-picker-current':'';row.dataset.number=String(n);
          if(n===target())row.setAttribute('aria-current','step');
          const item=session.mapping[n],locked=!session.editable(n),index=session.numbers.indexOf(n);
          if(!locked){
            row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`选择编号 [${n}] 的文献`);
            row.addEventListener('click',event=>{if(event.target?.closest?.('.zbc-picker-actions'))return;selectTarget(n,event);});
            row.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))selectTarget(n,event);});
          }
          const handle=picker.document.createElementNS(H,'span');handle.className='zbc-picker-handle';handle.textContent='≡';handle.draggable=!!item&&!locked&&!working&&!disabled;
          handle.setAttribute('role','img');handle.setAttribute('aria-label',locked?'已绑定，不能排序':'拖拽调整文献顺序');handle.setAttribute('aria-disabled',String(!handle.draggable));handle.title=locked?'已绑定编号不能移动':item?'拖拽排序；也可使用右侧上移、下移按钮':'请先选择文献';row.appendChild(handle);
          handle.addEventListener('dragstart',event=>{
            if(!handle.draggable){event.preventDefault();return;}
            clearDrag();dragNumber=n;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-zbc-ordered-slot',String(n));row.classList.add('zbc-picker-dragging');
          });
          handle.addEventListener('dragend',clearDrag);
          const number=picker.document.createElementNS(H,'span');number.className='zbc-picker-number';number.textContent=`[${n}]`;row.appendChild(number);
          const label=picker.document.createElementNS(H,'span');label.className='zbc-picker-title';
          label.textContent=item?.itemData?.title||'选择文献…';label.title=label.textContent;row.appendChild(label);
          if(!locked){row.setAttribute('aria-pressed',String(n===target()));}
          else{const state=picker.document.createElementNS(H,'span');state.className='zbc-picker-state';state.textContent='已绑定';row.appendChild(state);}
          const actions=picker.document.createElementNS(H,'span');actions.className='zbc-picker-actions';row.appendChild(actions);
          for(const type of ['click','mousedown','mouseup','keydown','command'])actions.addEventListener(type,event=>event.stopPropagation());
          for(const [action,text,description,to]of [['up','↑','上移',session.numbers[index-1]],['down','↓','下移',session.numbers[index+1]],['clear','×','清除',null]]){
            const button=picker.document.createXULElement('button');button.dataset.action=action;button.setAttribute('label',text);button.setAttribute('tooltiptext',`${description}编号 [${n}] 的文献`);button.setAttribute('aria-label',`${description}编号 [${n}] 的文献`);
            button.disabled=disabled||working||locked||(action==='clear'?!item:!session.canMove(n,to));
            button.addEventListener('command',()=>{
              if(button.disabled)return;
              if(action==='clear')return change(candidate=>candidate.clear(n),`已清空编号 [${n}] 的文献。`);
              return reorder(n,to,action);
            });actions.appendChild(button);
          }
          list.appendChild(row);
        }
        list.scrollTop=scrollTop;
        skip.disabled=disabled||working||target()===null;tick();
        scheduleGeometry();
      }
      function clearDropIndicators(){list?.querySelectorAll('[data-drop]').forEach(row=>delete row.dataset.drop);if(indicator)indicator.hidden=true;}
      function clearDrag(){dragNumber=null;clearDropIndicators();list?.querySelectorAll('.zbc-picker-dragging').forEach(row=>row.classList.remove('zbc-picker-dragging'));}
      function dropTarget(event){
        const row=event.target.closest?.('li[data-number]');
        if(!row||row.parentNode!==list)return null;
        const rect=row.getBoundingClientRect(),index=session.numbers.indexOf(Number(row.dataset.number));
        const boundary=index+(event.clientY<rect.top+rect.height/2?0:1),from=session.numbers.indexOf(dragNumber);
        const to=session.numbers[Math.max(0,Math.min(session.numbers.length-1,boundary>from?boundary-1:boundary))];
        return {boundary,to};
      }
      function dragOver(event){
        if(disabled||working||dragNumber===null)return;
        const destination=dropTarget(event);
        if(!destination||!session.canMove(dragNumber,destination.to)){clearDropIndicators();return;}
        event.preventDefault();event.dataTransfer.dropEffect='move';
        const {boundary}=destination,anchor=list.children[Math.min(boundary,list.children.length-1)],after=boundary===list.children.length;
        if(indicator.dataset.boundary!==String(boundary)||indicator.hidden){clearDropIndicators();anchor.dataset.drop=after?'after':'before';indicator.dataset.boundary=String(boundary);}
        const rect=anchor.getBoundingClientRect(),bounds=list.getBoundingClientRect(),y=after?rect.bottom:rect.top;
        indicator.style.left=(bounds.left+8)+'px';indicator.style.width=Math.max(0,list.clientWidth-16)+'px';indicator.style.top=(Math.max(bounds.top,Math.min(bounds.bottom,y))-1)+'px';indicator.hidden=false;
        // Hovering either half of the source is a legal, unchanged move.
        const source=list.querySelector(`[data-number="${dragNumber}"]`);
        if(!source?.contains(event.target)){
          if(event.clientY<bounds.top+28)list.scrollTop-=18;else if(event.clientY>bounds.bottom-28)list.scrollTop+=18;
        }
      }
      function drop(event){
        if(disabled||working||dragNumber===null)return;
        const destination=dropTarget(event),from=dragNumber;clearDrag();
        if(!destination||!session.canMove(from,destination.to))return;
        event.preventDefault();event.dataTransfer.dropEffect='move';reorder(from,destination.to);
      }
      function enqueue(operation){
        const currentRevision=revision;queued++;working=true;tick();
        const task=pending.then(async()=>{
          if(settled||currentRevision!==revision)return;
          try{await operation(()=>!settled&&currentRevision===revision);}
          catch(error){if(!settled&&currentRevision===revision){lastChoice=null;notify(error.message||String(error),true);}}
          finally{if(!settled&&currentRevision===revision){queued--;working=queued>0;render();tick();}}
        });
        pending=task;return task;
      }
      function change(mutate,success,{record,number}={}){
        if(disabled||!nativeReady||settled)return Promise.resolve();
        const currentFocusRevision=focusRevision;
        return enqueue(async isCurrent=>{
          const candidate=new ZBMapping.OrderedSession(numbers,baseline,lockedNumbers,{unique:false,allowEmpty:persistent});
          candidate.currentNumber=session.currentNumber;mutate(candidate);
          const changes=candidate.changes(),assigned=Object.fromEntries(Object.entries(changes).filter(([,item])=>!!item));
          // Resolve only changed entries. The canonical identity can reveal a merged reference.
          const checked=await validate(assigned,Object.keys(assigned));if(!isCurrent())return;
          const patch={...changes,...checked};
          if(!adapter.confirmDuplicateBindings(baseline,patch,{parent:picker})){
            if(isCurrent()){lastChoice=null;notify('已取消重复绑定，文献列表保持不变。');}return;
          }
          if(!isCurrent())return;
          const canonical=Object.keys(patch).length?(onApply?await onApply(patch,{isCurrent}):{...candidate.mapping,...checked}):baseline;
          if(!isCurrent())return;
          const focus=focusRevision===currentFocusRevision?candidate.currentNumber:session.currentNumber;
          baseline={...canonical};
          session=new ZBMapping.OrderedSession(numbers,baseline,lockedNumbers,{unique:false,allowEmpty:persistent});
          session.currentNumber=focus===null||session.editable(focus)?focus:session.currentNumber;
          if(record&&view.itemsView?.getSelectedItems(true)?.[0]===record.id)view.itemsView.selection.clearSelection();
          if(!record)lastChoice=null;notify(success);render();tick();
        });
      }
      function reorder(from,to,focusAction){
        return change(candidate=>candidate.move(from,to),from===to?'文献顺序保持不变。':`已将文献移至编号 [${to}]。`).then(()=>{
          if(settled)return;reveal(to);const row=list.querySelector(`[data-number="${to}"]`),button=focusAction&&row?.querySelector(`[data-action="${focusAction}"]`);
          (button&&!button.disabled?button:row)?.focus();
        });
      }
      function accept(number){
        if(disabled||!nativeReady||settled||number===null||!session.editable(number))return Promise.resolve();
        const ids=view?.itemsView?.getSelectedItems(true)||[];if(!ids.length)return Promise.resolve();
        try{
          const record=currentRecord(),key=revision+':'+number+':'+record.id;
          if(lastChoice===key)return pending;lastChoice=key;
          return change(candidate=>{candidate.edit(number);if(adapter.sameIdentity(candidate.mapping[number],record))return;candidate.assign(record);},`已为编号 [${number}] 更新文献。`,{record,number});
        }catch(error){notify(error.message||String(error),true);return Promise.resolve();}
      }
      function install(){
        if(installed||settled)return;
        try{
          installed=true;
          panel=doc.createElementNS(H,'section');panel.id='zbc-picker-panel';
          const header=doc.createElementNS(H,'div');header.className='zbc-picker-header';panel.appendChild(header);
          heading=doc.createElementNS(H,'h2');heading.id='zbc-picker-heading';header.appendChild(heading);
          {
            const hint=doc.createElementNS(H,'span');hint.className='zbc-picker-instructions';hint.textContent='双击文献保存 · 点击整行更换';header.appendChild(hint);
            const help=doc.createElementNS(H,'span');help.className='zbc-picker-help';help.tabIndex=0;help.setAttribute('role','note');help.setAttribute('aria-label','文献选择操作说明');help.textContent='ⓘ';
            const tips='双击文献保存到当前编号；单击仅浏览，点击编号、标题或行内空白可更换目标。拖拽或↑↓排序、×清除均立即生效。文档只在点击插入并刷新后更新。';help.title=tips;
            const tooltip=doc.createElementNS(H,'span');tooltip.className='zbc-picker-tooltip';tooltip.textContent=tips;help.appendChild(tooltip);header.appendChild(help);
            skip=doc.createXULElement('button');skip.id='zbc-skip';skip.setAttribute('label','跳过当前编号');skip.addEventListener('command',()=>{if(working||disabled)return;session.skip();focusRevision++;lastChoice=null;selectionGesture=null;render();tick(true);notify('已跳过，原编号的文献保持不变。');});header.appendChild(skip);
            list=doc.createElementNS(H,'ol');list.id='zbc-picker-queue';panel.appendChild(list);
            indicator=doc.createElementNS(H,'div');indicator.id='zbc-drop-indicator';indicator.hidden=true;indicator.setAttribute('aria-hidden','true');panel.appendChild(indicator);
            list.addEventListener('dragover',dragOver);list.addEventListener('drop',drop);
            list.addEventListener('dragleave',event=>{
              if(list.contains(event.relatedTarget))return;
              const rect=list.getBoundingClientRect();
              if(event.clientX>=rect.left&&event.clientX<rect.right&&event.clientY>=rect.top&&event.clientY<rect.bottom)return;
              clearDropIndicators();
            });
          }
          status=doc.createElementNS(H,'p');status.id='zbc-picker-status';status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.appendChild(status);
          const container=doc.getElementById('zotero-items-tree-container');container.appendChild(panel);
          geometryObserver=new picker.ResizeObserver(scheduleGeometry);
          for(const element of [container,doc.getElementById('zotero-items-pane-content')])geometryObserver.observe(element);
          picker.addEventListener('resize',scheduleGeometry);scheduleGeometry();
          // Single-click selection changes only the native highlight. Commit on
          // explicit double-click; Enter remains the keyboard confirmation.
          nativeTree=doc.getElementById('zotero-items-tree');
          nativeTree?.addEventListener('dblclick',trackPointer,true);nativeTree?.addEventListener('keydown',trackKey,true);
          view.onSelect=()=>{scheduleGeometry();return consumeSelection();};view.onActivate=()=>{scheduleGeometry();return consumeSelection();};view.onError=error=>notify(error.message,true);
          render();tick(true);reveal(target());
        }catch(e){finish(null,e);}
      }
      try{
        if(!host)throw new Error('主窗口缺少文献选择工作区，请重新打开批量匹配窗口。');
        owner.picker=handle;adapter.activePicker=handle;
        host.hidden=false;doc.body.classList.add('zbc-selecting');
        parent.addEventListener('unload',parentClosed);
        view=ZBLibrary.mount(adapter);install();notify('正在加载文献资料库…');
        view.ready.then(()=>{if(!settled){nativeReady=true;view.itemsView.selection.clearSelection();render();tick(true);}},error=>finish(null,error));
      }catch(e){finish(null,e);}
    });
    return owner.promise;
  }
};
