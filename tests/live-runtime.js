/* SPDX-License-Identifier: MIT */
// Disposable profile only. This harness never reads the user's Zotero library.
async function runLiveRuntimeTest(Zotero,config){
  const root=PathUtils.parent(config.result),status=PathUtils.join(root,'live-status.json');
  const evidence={version:Zotero.version,checks:[],started:new Date().toISOString()};
  try{
    for(let i=0;i<200&&!Zotero.BatchCitations?.liveService;i++)await Zotero.Promise.delay(100);
    if(!Zotero.BatchCitations?.liveService)throw new Error('Live service did not start: '+(Zotero.BatchCitations?.liveError||'no bootstrap detail'));
    // Observe only synchronous diagnostics from the actual native helper. This
    // distinguishes a Windows permission refusal from a broken Gecko/ctypes API.
    let foregroundErrors=[];
    const nativeForeground=Zotero.BatchCitations.foreground;
    Zotero.BatchCitations.foreground=function(window){
      const log=Zotero.logError;foregroundErrors=[];
      Zotero.logError=function(error){foregroundErrors.push(String(error));return log.call(this,error);};
      try{return nativeForeground.call(this,window);}finally{Zotero.logError=log;}
    };
    await Zotero.Styles.init();
    const items=[];
    for(let i=1;i<=8;i++){
      const item=new Zotero.Item('book');item.libraryID=Zotero.Libraries.userLibraryID;
      item.setField('title','Live synthetic reference '+i);item.setField('date','202'+i);item.setField('publisher','Test Press');
      item.setCreators([{firstName:'Test',lastName:'Author'+i,creatorType:'author'}]);await item.saveTx();items.push(item);
    }
    evidence.checks.push('live endpoint initialized','isolated synthetic library initialized');
    await IOUtils.writeUTF8(status,JSON.stringify({...evidence,state:'ready'}));
    const handled=new Set();let autoSubmit=!config.holdBatch,completionDelay=0,startDelay=0,nativeState=null,ticking=false;
    const originalHandle=Zotero.BatchCitations.liveService.handle.bind(Zotero.BatchCitations.liveService);
    Zotero.BatchCitations.liveService.handle=async(action,payload)=>{
      if(action==='completed'&&completionDelay)await Zotero.Promise.delay(completionDelay);
      const result=await originalHandle(action,payload);
      if(action==='start'&&startDelay)await Zotero.Promise.delay(startDelay);
      return result;
    };
    const timer=Zotero.getMainWindow().setInterval(async()=>{
      if(ticking)return;ticking=true;
      try{
        const service=Zotero.BatchCitations.liveService;
        for(const job of service.jobs.values()){
          if(!autoSubmit||job.command!=='batch'||job.state!=='pending'||handled.has(job.id))continue;
          const win=[...Zotero.BatchCitations.dialogs].find(w=>w.ZBTest?.model.liveJob?.id===job.id&&!w.ZBTest.model.busy);
          if(!win)continue;
          handled.add(job.id);
          const model=win.ZBTest.model;
          model.mapping={...model.bindings.mapping,...Object.fromEntries(job.scan.numbers.map(n=>[n,win.ZBTest.adapter.itemRecord(items[n-1])]))};
          for(const n of job.scan.numbers){const historical=model.bindings.mapping[n],current=model.bindings.state.displayOwners.get(n)?.[0]?.record;if(historical&&current&&!win.ZBTest.adapter.sameIdentity(historical,current))model.labelResolutions[n]={source:'historical',uris:historical.uris};}
          model.selected=new Set(job.scan.occurrences.filter(o=>o.eligible).map(o=>o.key));
          win.document.getElementById('style').value='http://www.zotero.org/styles/ieee';
          win.document.getElementById('locale').value='en-US';
          win.ZBTest.refresh();
          if(win.document.getElementById('convert').disabled)throw new Error('Live commit button is unexpectedly disabled');
          win.document.getElementById('convert').click();
          evidence.checks.push('real live dialog mappings and selected occurrences submitted');
        }
        const commandPath=PathUtils.join(root,'live-control.json');
        if(await IOUtils.exists(commandPath)){
          let command;
          try{command=JSON.parse((await IOUtils.readUTF8(commandPath)).replace(/^\uFEFF/,''));await IOUtils.remove(commandPath);}
          catch(error){
            // Windows may still hold the producer's control file open or expose a partial write.
            // Retry ingestion next tick; command execution failures remain fatal below.
            if(['NotAllowedError','NotFoundError'].includes(error.name)||error instanceof SyntaxError)return;
            throw error;
          }
          if(command.action==='inspect'){
            const dialogs=[...Zotero.BatchCitations.dialogs].filter(w=>w.ZBTest&&!w.closed).map(w=>{
              const m=w.ZBTest.model,d=w.document;
              let nativeHandle=null;try{nativeHandle=w.docShell.treeOwner.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIBaseWindow).nativeHandle;}catch{}
              return {id:m.liveJob?.id,state:m.liveJob?.state,recoveryPending:!!m.liveJob?.recoveryPending,documentKey:m.liveJob?.snapshot.documentKey,fingerprint:m.fingerprint,numbers:m.archive?.scan.numbers,allNumbers:m.liveJob?w.ZBLiveCore.checkNumbers(m.liveJob.snapshot):[],name:d.getElementById('filename').textContent,numberCheck:d.getElementById('number-check').textContent,busy:m.busy,selected:[...m.selected],mapping:Object.keys(m.mapping),mappingRecords:m.mapping,locked:Object.keys(m.bindings?.mapping||{}),requiresMigration:!!m.bindings?.requiresMigration,toast:d.getElementById('message').textContent,toastVisible:!d.getElementById('message').hidden,openHidden:d.getElementById('compatibility').hidden,hasManualCheck:!!d.getElementById('check-numbers'),focused:Services.focus.activeWindow===w,windowState:w.windowState,nativeHandle,activation:Zotero.BatchCitations.lastActivation,foregroundErrors};
            });
            const jobs=[...service.jobs.values()].map(j=>({id:j.id,state:j.state,clientComplete:!!j.clientComplete,listeners:j.listeners.size,numbers:j.scan.numbers,citationTexts:j.snapshot.citationTexts}));
            const current=Zotero.Integration.currentWindow;
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,dialogs,jobs,associations:Zotero.BatchCitations.dialogJobs.size,mainWindowState:Zotero.getMainWindow().windowState,integrationBusy:!!Zotero.Integration.currentDoc,nativeState,nativeWindow:current&&!current.closed?{uri:current.document.documentURI,ready:!!current.document.querySelector('dialog')}:null}));
          }else if(command.action==='ui-layout'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending'),checks=[];
            if(!win)throw new Error('No pending UI layout window');
            Services.scriptloader.loadSubScript(config.layoutScript);
            const geometry=await runUILayoutTests(win,config,(name,value)=>{if(!value)throw new Error(name);checks.push(name);});
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,checks,geometry}));
          }else if(command.action==='iteration-inspect'||command.action==='iteration-submit'||command.action==='iteration-pick-reference'){
            Services.scriptloader.loadSubScript(config.iterationScript);
            const answer=await runIterationControl(Zotero,items,root,command);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify(answer));
          }else if(command.action==='minimize-main'){
            Zotero.getMainWindow().minimize();await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='identity-submit'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending');
            if(!win)throw new Error('No pending identity dialog');
            const m=win.ZBTest.model,api=win.ZBTest.adapter;
            const mapping={...m.bindings.mapping};
            for(const [number,index]of Object.entries(command.mapping||{}))mapping[number]=api.itemRecord(items[index-1]);
            const settings=m.liveJob.snapshot.documentData?win.ZBLiveCore.documentSettings(m.liveJob.snapshot.documentData,t=>new Zotero.Integration.DocumentData(t)):null;
            const styleID=command.styleID||settings?.style.styleID||'http://www.zotero.org/styles/ieee',locale=command.locale||settings?.style.locale||'en-US';
            const capability=await api.styleCapabilities(styleID);if(!capability.firstUse)throw new Error('Style is not first-use numeric: '+styleID);
            const resolutions={};
            for(const [number,source]of Object.entries(command.resolutions||{})){
              const record=source==='historical'?m.bindings.mapping[number]:m.bindings.state.displayOwners.get(Number(number))?.[0]?.record;
              if(!record)throw new Error('Resolution has no native reference');resolutions[number]={source,uris:record.uris};
            }
            const keys=m.archive.scan.occurrences.filter(o=>o.eligible).map(o=>o.key);
            let plan;
            try{plan=service.prepare(m.liveJob.id,keys,mapping,{styleID,locale,numeric:true,zoteroVersion:Zotero.version,labelResolutions:resolutions});}
            catch(error){if(!command.expectReject)throw error;await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,rejected:true,message:error.message}));return;}
            if(command.expectReject)throw new Error('A forbidden mapping was accepted');
            await api.previewLive(plan,locale);
            m.mapping=mapping;m.previewPlan=plan;win.ZBTest.refresh();win.renderPreview(plan);
            const response={ok:true,records:items.map(item=>api.itemRecord(item)),preview:plan.preview,operations:plan.operations.map(op=>({kind:op.kind,sources:op.sourceFields?.length||0})),styleID,locale};
            if(command.failAfterNative){
              const original=service.nativeRun;
              service.nativeRun=async function(job){try{await original.call(this,job);throw new Error('TEST_INTERRUPTED_AFTER_NATIVE_REFRESH');}finally{service.nativeRun=original;}};
            }
            service.submitPrepared(m.liveJob.id,plan);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify(response));
          }else if(command.action==='identity-ui'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending');
            if(!win)throw new Error('No pending UI');
            const d=win.document,checks=[],geometry=[],width=win.outerWidth,height=win.outerHeight;
            const check=(name,value)=>{if(!value)throw new Error(name);checks.push(name);};
            try{
              const hint=d.getElementById('binding-hint'),recovery=d.getElementById('binding-recovery'),message=d.getElementById('message');
              recovery.hidden=false;hint.textContent='原编号 [1] 的引用域与记录不一致，请核对手工编辑结果后恢复。'.repeat(9);message.hidden=false;message.textContent='请核对字段位置和文献身份。'.repeat(20);
              for(const size of [760,1000])for(const scale of [1,1.25,1.5])for(const scheme of ['light','dark'])for(const tab of [0,1]){
                win.resizeTo(size,820);d.documentElement.style.fontSize=(13*scale)+'px';d.documentElement.style.colorScheme=scheme;d.getElementById('workspace').selectedIndex=tab;
                await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
                const h=hint.getBoundingClientRect(),b=d.getElementById('recover-bindings').getBoundingClientRect(),status=d.getElementById('status-panel').getBoundingClientRect(),workspace=d.getElementById('workspace').getBoundingClientRect();
                const overlap=Math.min(h.right,b.right)>Math.max(h.left,b.left)+1&&Math.min(h.bottom,b.bottom)>Math.max(h.top,b.top)+1;
                check(`warning layout ${size}px font ${scale} ${scheme} tab ${tab}`,!overlap&&status.bottom<=workspace.top+1&&hint.scrollWidth<=hint.clientWidth+1&&d.documentElement.scrollWidth<=win.innerWidth+1);
                geometry.push({size,scale,scheme,tab,statusHeight:status.height,workspaceHeight:workspace.height,hintHeight:h.height,buttonTop:b.top});
              }
              check('status uses native stylesheet and normal flow',!!d.querySelector('link[href="chrome://zotero/skin/zotero.css"]')&&win.getComputedStyle(message).position==='static');
              await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,checks,geometry,scope:'Native Zotero window; font scaling and CSS native light/dark colors, not an OS DPI/theme change'}));
            }finally{d.documentElement.style.removeProperty('font-size');d.documentElement.style.removeProperty('color-scheme');win.resizeTo(width,height);win.ZBTest.refresh();}
          }else if(command.action==='identity-resume'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending');
            if(!win)throw new Error('No recovery window');service.resume(win.ZBTest.model.liveJob.id);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='install-identity-style'){
            const xml=await IOUtils.readUTF8(PathUtils.join(root,'identity-style.csl'));
            const installed=await Zotero.Styles.install({string:xml},'isolated identity validation',true);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,...installed}));
          }else if(command.action==='binding-checks'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending'),m=win.ZBTest.model,d=win.document,api=win.ZBTest.adapter,checks=[];
            const check=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
            check('existing original number 2 is restored to its original item',m.mapping[2]?.id===items[1].id&&!!m.bindings.mapping[2]);
            const row=d.querySelector('#zbc-picker-queue [data-number="2"]');
            check('bound number has no ordinary change or clear action',row&&row.querySelector('[data-action="clear"]')?.disabled&&row.textContent.includes('已绑定'));
            const before=JSON.stringify(m.mapping),keys=m.archive.scan.occurrences.filter(o=>o.eligible).map(o=>o.key),options={styleID:'ieee',locale:'en-US',zoteroVersion:Zotero.version};
            let rejected=false;try{service.submit(m.liveJob.id,keys,{...m.mapping,2:api.itemRecord(items[0])},options);}catch(e){rejected=/绑定/.test(e.message);}
            check('service rejects a different item for an already bound original number',rejected&&m.liveJob.state==='pending');
            const reuse=win.ZBLiveCore.plan(m.liveJob.snapshot,keys,{...m.mapping,4:api.itemRecord(items[1])},options);
            check('a new input label reuses an already cited reference without changing its binding',reuse.expected.newNumbers.some(label=>api.sameIdentity(label.record,api.itemRecord(items[1])))&&m.liveJob.state==='pending');
            const path=PathUtils.join(root,'bound-conflict.csv');await IOUtils.writeUTF8(path,'number,uri,title\r\n2,'+Zotero.URI.getItemURI(items[0])+',Conflict');
            const original=api.pickFile;api.pickFile=async()=>path;
            try{d.getElementById('import-map').click();for(let i=0;i<100&&m.busy;i++)await Zotero.Promise.delay(50);}finally{api.pickFile=original;}
            check('conflicting CSV import leaves all bindings unchanged',JSON.stringify(m.mapping)===before&&d.getElementById('message').className==='error');
            const ordered=new win.ZBMapping.OrderedSession([1,2,3],m.mapping,[1,2]);
            rejected=false;try{ordered.clear(2);}catch{rejected=true;}
            check('ordered matching skips and protects committed original numbers',ordered.currentNumber===3&&rejected);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,checks}));
          }else if(command.action==='replacement-record'){
            const item=items[4],sys=new Zotero.Cite.System({automaticJournalAbbreviations:false});
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,record:{id:item.id,uris:[Zotero.URI.getItemURI(item)],itemData:sys.retrieveItem(item.id)}}));
          }else if(command.action==='recover-test'||command.action==='recover-edited-test'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending'),m=win.ZBTest.model,api=win.ZBTest.adapter;
            const confirmed=command.action==='recover-edited-test'?{...m.bindings.mapping,4:api.itemRecord(items[4])}:Object.fromEntries(items.map((item,i)=>[i+1,api.itemRecord(item)]));
            service.recover(m.liveJob.id,confirmed);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='native-command'||command.action==='native-race'){
            if(!['addEditBibliography','refresh'].includes(command.command))throw new Error('Unsupported isolated native command');
            nativeState={command:command.command,state:'running'};
            const I=Zotero.Integration,getApplication=I.getApplication;
            if(command.action==='native-race')I.getApplication=function(...args){
              const app=getApplication.apply(this,args),getDocument=app.getDocument.bind(app);
              app.getDocument=async(...args)=>{const doc=await getDocument(...args),complete=doc.complete.bind(doc);doc.complete=async()=>{await Zotero.Promise.delay(2000);return complete();};return doc;};return app;
            };
            Zotero.Integration.execCommand('WinWord',command.command,'__zbc_active__',999).then(()=>{nativeState.state='done';},e=>{nativeState.state='error';nativeState.error=String(e);}).finally(()=>{I.getApplication=getApplication;});
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='matrix-items'){
            for(let i=items.length+1;i<=9;i++){
              const item=new Zotero.Item('book');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title','Live matrix reference '+i);item.setField('date','2020');await item.saveTx();items.push(item);
            }
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='accept-native'){
            const current=Zotero.Integration.currentWindow;
            if(!current||current.closed||!current.document.querySelector('dialog'))throw new Error('No native dialog to accept');
            current.document.querySelector('dialog').acceptDialog();
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='open'){
            Zotero.BatchCitations.openWord(Zotero.getMainWindow());
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='submit'){
            autoSubmit=true;
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='hold'){
            autoSubmit=false;
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='start-delay'){
            startDelay=Math.max(0,Math.min(2000,command.milliseconds||0));
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='completion-delay'){
            completionDelay=Math.max(0,Math.min(2000,command.milliseconds||0));
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='minimize'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>!w.closed&&w.ZBTest?.model.liveJob?.state==='pending');
            win.minimize();
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='select-all'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>w.ZBTest?.model.liveJob?.state==='pending');
            win.document.getElementById('select-all').click();
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='ui-checks'){
            const win=[...Zotero.BatchCitations.dialogs].find(w=>w.ZBTest?.model.liveJob?.state==='pending'&&!w.ZBTest.model.busy);
            if(!win)throw new Error('No pending live UI');
            Services.scriptloader.loadSubScript(config.automaticUIScript);
            const result=await runAutomaticUITests(Zotero,win,items,root);
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify(result));
          }else if(command.action==='close-dialogs'||command.action==='close-no-notify'){
            autoSubmit=false;
            const original=Zotero.BatchCitations.notifyWord;
            if(command.action==='close-no-notify')Zotero.BatchCitations.notifyWord=()=>{};
            try{for(const w of Zotero.BatchCitations.dialogs)if(!w.closed)w.close();}finally{Zotero.BatchCitations.notifyWord=original;}
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true}));
          }else if(command.action==='update'){
            items[command.item||0].setField('title',command.title);await items[command.item||0].saveTx();
            await IOUtils.writeUTF8(PathUtils.join(root,'live-control-result.json'),JSON.stringify({ok:true,title:command.title}));
          }else if(command.action==='stop'){
            Zotero.getMainWindow().clearInterval(timer);
            await IOUtils.writeUTF8(status,JSON.stringify({...evidence,state:'stopped',finished:new Date().toISOString()}));
            Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
          }
        }
      }catch(e){await IOUtils.writeUTF8(status,JSON.stringify({...evidence,state:'error',error:String(e),stack:e.stack}));Zotero.logError(e);}
      finally{ticking=false;}
    },200);
  }catch(e){await IOUtils.writeUTF8(status,JSON.stringify({...evidence,state:'error',error:String(e),stack:e.stack}));}
}
