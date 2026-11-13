/* SPDX-License-Identifier: MIT */
(function(root,factory){
  const api=factory(typeof module==='object'?require('./live-core.js'):root.ZBLiveCore,typeof module==='object'?require('./core.js'):root.ZBCore);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZBLiveService=api;
})(globalThis,function(live,core){
  'use strict';
  const COMMANDS={batch:'refresh',refresh:'refresh',citation:'addEditCitation',bibliography:'addEditBibliography',preferences:'setDocPrefs'};
  class Service {
    constructor(zotero,owner,{token,now=()=>Date.now(),randomID}={}){
      this.z=zotero;this.owner=owner;this.token=token;this.now=now;this.id=randomID||(()=>this.owner.randomID());this.jobs=new Map();this.referenceSelections=new Map();this.closed=false;
      if(typeof token!=='string'||token.length<32)throw new Error('实时服务缺少安全令牌。');
      // Zotero 7 has no currentCommandPromise. Observe the promise returned by
      // its native entry point, preserving the original call and return value.
      const integration=this.z.Integration,service=this;
      if(typeof integration.execCommand==='function'){
        this.originalExec=integration.execCommand;
        this.execWrapper=function(...args){
          const pending=service.originalExec.apply(this,args);
          if(pending?.then){service.nativeCommandPromise=pending;const clear=()=>{if(service.nativeCommandPromise===pending)service.nativeCommandPromise=null;};pending.then(clear,clear);}
          return pending;
        };
        integration.execCommand=this.execWrapper;
      }
    }
    notify(job,type){
      for(const listener of [...job.listeners])try{listener({type,job});}catch(e){this.z.logError(e);}
      if(['ready','verifying','finalizing','needs-recovery','done','error','cancelled'].includes(type))try{this.owner.notifyWord?.();}catch(e){this.z.logError(e);}
    }
    subscribe(id,listener){const job=this.job(id);job.listeners.add(listener);return ()=>job.listeners.delete(listener);}
    diagnostic(stage,status,started,snapshot){
      try{this.z.debug?.(`[Batch Citations] stage=${stage} status=${status} elapsedMs=${Math.max(0,this.now()-started)} candidates=${snapshot?.candidates?.length||0} fields=${snapshot?.citationFields?.length||0}`);}catch{}
    }
    scanSnapshot(snapshot){
      const started=this.now();this.diagnostic('candidate-scan','start',started,snapshot);
      try{const result=live.scan(snapshot);this.diagnostic('candidate-scan','ok',started,snapshot);return result;}
      catch(e){this.diagnostic('candidate-scan','error',started,snapshot);this.z.logError?.(e);throw new Error('编号识别失败：'+e.message+' 请从 Word 重新打开批量匹配窗口。');}
    }
    state(job,state){job.state=state;this.notify(job,state);}
    expire(){for(const [id,job]of this.jobs)if(this.now()-job.created>15*60*1000){this.state(job,'cancelled');job.listeners.clear();this.jobs.delete(id);}}
    async request({headers={},data}){
      if(headers.origin||headers['sec-fetch-site']||headers.authorization!=='Bearer '+this.token)return [403,'application/json',JSON.stringify({error:'拒绝未经授权的本地请求。'})];
      try{
        if(this.closed)throw new Error('插件已停用。');
        this.expire();
        if(!data||data.protocol!==3||JSON.stringify(data).length>12*1024*1024)throw new Error('协议版本不匹配或请求过大，请同时更新两端组件。');
        if(!['1.1.4','1.1.5','1.1.6','1.1.7','1.1.8','1.1.9','1.1.10','1.1.11','1.1.12','1.1.13','2.0.0'].includes(data.clientVersion))throw new Error('请同时更新 Word 加载项和 Zotero 插件至 2.0.0，以确保原编号绑定可以随文档保存。');
        const result=await this.handle(data.action,data.payload||{});
        return [200,'application/json',JSON.stringify(result)];
      }catch(e){this.diagnostic('request-'+String(data?.action||'unknown').replace(/[^a-z-]/gi,''),'error',this.now(),data?.payload?.snapshot);this.z.logError?.(e);return [400,'application/json',JSON.stringify({error:e.message||String(e)})];}
    }
    job(id){const job=this.jobs.get(id);if(!job)throw new Error('操作已过期，请从 Word 重新发起。');return job;}
    async handle(action,payload){
      if(action==='hello')return {protocol:3,capabilities:live.capabilities(),version:'2.0.0'};
      if(action==='start')return this.start(payload);
      const job=this.job(payload.id);
      if(action==='focus'){const window=this.owner.findDialog?.(job.id);if(window&&job.state==='pending')this.owner.focus(window);else if(!window&&job.command==='batch')this.cancel(job.id);return {state:job.state,open:!!window};}
      if(action==='completed'){
        if(job.state!=='done')throw new Error('Word 尚未完成本次引用操作。');
        if(!job.clientComplete){
          if(payload.snapshot){
            if(payload.snapshot.documentKey!==job.snapshot.documentKey)throw new Error('Word 文档不匹配，未关闭引用窗口。');
            const scan=this.scanSnapshot(payload.snapshot),bindings=live.restoreBindings(payload.snapshot);job.snapshot=payload.snapshot;job.scan=scan;job.bindings=bindings;job.numberCheck=live.checkNumbers(payload.snapshot,scan);job.checkError='';this.notify(job,'snapshot');
          }
          if(job.plan?.autoRefresh){job.plan=null;job.prepared=null;job.finalized=false;job.state='pending';this.notify(job,'snapshot');return {state:'pending',keepOpen:true};}
          job.clientComplete=true;this.notify(job,'completed');this.owner.closeLive?.(job.id);
        }
        return {state:job.state};
      }
      if(action==='snapshot'||action==='checked'){
        if(action==='snapshot'?job.state!=='pending':!['done','error'].includes(job.state))throw new Error('该操作已提交或已取消，不能更新快照。');
        if(payload.snapshot?.documentKey!==job.snapshot.documentKey)throw new Error('Word 文档不匹配，未更新编号检查。');
        const previous=job.bindings?.state;
        await this.resolveSnapshotAliases(payload.snapshot);
        const scan=this.scanSnapshot(payload.snapshot),bindings=live.restoreBindings(payload.snapshot);
        job.snapshot=payload.snapshot;job.scan=scan;job.bindings=bindings;job.numberCheck=live.checkNumbers(payload.snapshot,scan);job.checkError='';this.notify(job,'snapshot');
        const order=state=>(state?.citations||[]).map(c=>c.items.map(item=>item.ref.referenceId+JSON.stringify(item.attributes)).join(',')).join('|');
        const numeric=bindings.state.references.length&&bindings.state.references.every(ref=>(bindings.display.get(ref.referenceId)||[]).some(label=>Number.isInteger(label.display)));
        if(action==='snapshot'&&!this.z.Integration.currentDoc&&!job.recoveryPending&&numeric&&previous&&order(previous)!==order(bindings.state)&&!bindings.issues.some(issue=>issue.blocking)){
          const plan=live.refreshPlan(job.snapshot);plan.autoRefresh=true;this.ready(job,plan);
        }
        return {state:job.state,watching:job.listeners.size>0};
      }
      if(action==='check-error'){
        job.checkError=String(payload.message||'当前文档暂时无法检查。');this.notify(job,'check-error');return {state:job.state};
      }
      if(action==='poll')return {state:job.state,...(job.state==='ready'?{plan:job.plan}:{}),
        ...(job.plan?.autoRefresh?{keepOpen:true}:{}),
        ...(job.state==='finalizing'?{finalization:job.finalization}:{}),
        ...(job.verificationIssues?{issues:job.verificationIssues}:{}),...(job.message?{message:job.message}:{})};
      if(action==='cancel'){this.cancel(job.id);return {state:job.state};}
      if(action==='abandon'){
        if(!['pending','ready','done','cancelled'].includes(job.state)){
          job.message=String(payload.message||'客户端中断；请重新打开并核对上次事务。');
          this.state(job,'needs-recovery');job.abandoned=true;
        }else this.cancel(job.id);
        return {state:job.state};
      }
      if(action==='verify'){
        if(job.state!=='verifying')throw new Error('该操作当前不在待验证状态。');
        if(!payload.snapshot||payload.snapshot.documentKey!==job.snapshot.documentKey)throw new Error('验证快照与当前 Word 文档不匹配。');
        await this.resolveSnapshotAliases(payload.snapshot);
        const result=live.finalizePlan(job.plan,job.snapshot,payload.snapshot);
        job.verificationIssues=result.issues||[];
        if(!result.ok){
          job.finalSnapshot=payload.snapshot;
          this.state(job,'needs-recovery');
          return {state:'needs-recovery',issues:job.verificationIssues,counts:result.counts||null};
        }
        job.finalization={documentKey:payload.snapshot.documentKey,fingerprint:result.fingerprint,
          transactionId:result.transactionId,bindingData:result.bindingData,documentData:result.documentData};
        this.state(job,'finalizing');
        return {state:'finalizing',finalization:job.finalization,counts:result.counts||null};
      }
      if(action==='finalized'){
        if(job.state==='done'&&job.finalized&&payload.transactionId===job.plan.transactionId)return {state:'done'};
        if(job.state!=='finalizing')throw new Error('该操作尚未通过提交后验证。');
        if(payload.documentKey!==job.finalization.documentKey)throw new Error('最终化的文档身份不一致。');
        if(payload.transactionId!==job.plan.transactionId)throw new Error('最终化事务回执不匹配。');
        job.finalized=true;this.state(job,'done');return {state:'done'};
      }
      if(action==='committed'){
        if(job.state!=='ready')throw new Error('该操作已提交或已取消，不能重复执行。');
        if(payload.snapshot?.documentKey!==job.snapshot.documentKey||payload.snapshot?.documentData!==job.plan.documentData)throw new Error('提交的 Word 文档身份与计划不一致。');
        this.state(job,'running');
        // Schedule after returning the HTTP response. Word must finish its COM callback first.
        this.owner.schedule(()=>this.run(job));
        return {state:'running'};
      }
      throw new Error('未知的实时操作。');
    }
    async start({command,snapshot,protocol=0,capabilities=[]}){
      if(!Object.hasOwn(COMMANDS,command))throw new Error('不支持此 Word 操作。');
      if(!Array.isArray(capabilities))throw new Error('Word 加载项的能力清单无效。');
      if(protocol!==3||live.capabilities().some(name=>!capabilities.includes(name)))
        throw new Error('Word 加载项协议或能力不兼容，已停止写入。请同时更新两端组件。');
      if(!snapshot||snapshot.documentKey==null)throw new Error('缺少 Word 文档快照。');
      if(snapshot.pendingTransaction&&!snapshot.transaction)throw new Error('上次未完成事务缺少恢复证据，请保留文档并核对备份。');
      for(const job of this.jobs.values())if(job.command==='batch'&&job.state==='pending'&&this.owner.findDialog&&!this.owner.findDialog(job.id))this.cancel(job.id);
      for(const old of this.jobs.values())if(old.state==='needs-recovery'||old.abandoned){old.abandoned=true;this.owner.closeLive?.(old.id);}
      if([...this.jobs.values()].some(j=>!j.abandoned&&['pending','ready','running','verifying','finalizing'].includes(j.state)))throw new Error('另一个引用操作尚未完成，请先完成或取消。');
      if(this.z.Integration.currentDoc){
        const pending=this.nativeCommandPromise||this.z.Integration.currentCommandPromise;
        if(!pending?.then)throw new Error('请先完成当前 Zotero 引用操作后重试。');
        if(this.waitingNative!==pending){
          this.waitingNative=pending;
          const wake=()=>{if(!this.closed)try{this.owner.notifyWord?.();}catch(e){this.z.logError(e);}};
          pending.then(wake,wake);
          const window=this.z.Integration.currentWindow;
          if(window&&!window.closed)this.owner.focus?.(window);
        }
        return {waitingForNative:true};
      }
      this.waitingNative=null;
      await this.resolveSnapshotAliases(snapshot);
      const scan=this.scanSnapshot(snapshot),bindings=live.restoreBindings(snapshot);
      const settings=live.documentSettings(snapshot.documentData,data=>new this.z.Integration.DocumentData(data),snapshot);
      const job={id:this.id(),command,snapshot,scan,bindings,numberCheck:live.checkNumbers(snapshot,scan),created:this.now(),state:'pending',listeners:new Set(),
        protocol,capabilities:[...capabilities],legacy:false,recoveryPending:!!snapshot.pendingTransaction};
      const saved=this.referenceSelections.get(snapshot.documentKey);
      if(command==='batch'&&saved?.fingerprint===snapshot.fingerprint)job.referenceSelection=JSON.parse(JSON.stringify(saved));
      if(job.recoveryPending){
        try{job.recoveryPlan=live.recoveryPlan(snapshot);}
        catch(e){job.recoveryError=e.message;job.bindings.issues.push({code:'unfinished-transaction',severity:'error',blocking:true,message:e.message,action:'请保留当前文档并核对备份；不会自动覆盖。'});}
      }
      this.jobs.set(job.id,job);
      try{
        if(command==='batch'){const started=this.now();this.diagnostic('dialog-open','start',started,snapshot);try{this.owner.openLive(job);this.diagnostic('dialog-open','ok',started,snapshot);}catch(e){this.diagnostic('dialog-open','error',started,snapshot);throw e;}}
        else{
          await this.z.Styles.init();
          const styles=this.z.Styles.getVisible().filter(s=>s.class!=='note'&&s.hasBibliography);
          const preferred=styles.find(s=>s.styleID.endsWith('/ieee'))||styles[0];
          if(!settings&&!preferred)throw new Error('请先在 Zotero 安装一个带参考文献表的正文样式。');
          if(job.recoveryPending)throw new Error('请先打开批量匹配窗口，核对并完成上次未完成事务。');
          if(command==='citation')throw new Error('请使用 Word 中 Zotero 原生 Add/Edit Citation 编辑引用，再打开批量匹配核对绑定。');
          const plan=live.refreshPlan(snapshot);
          plan.documentData=settings?snapshot.documentData:core.documentData(preferred.styleID,'zh-CN',this.z.version);
          if(command==='bibliography'){plan.expected.allowBibliography=true;plan.expected.beforeBibliographyCount=snapshot.bibliographyCount||0;}
          this.ready(job,plan);
        }
      }catch(e){job.message=e.message;this.state(job,'error');throw e;}
      return {id:job.id,protocol:3,capabilities:live.capabilities()};
    }
    ready(job,plan){
      if(job.state!=='pending')throw new Error('操作已取消或提交，请重新扫描。');
      if(this.z.Integration.currentDoc)throw new Error('Zotero 正在处理原生引用，请等待完成后再提交。');
      const merges=(plan.operations||[]).filter(op=>op.kind==='mergeAdjacent');
      if(merges.length&&(!job.capabilities.includes('structuredFields')||!job.capabilities.includes('mergeAdjacent')))
        throw new Error('当前 Word 加载项不支持结构化相邻引用合并，已停止写入。请更新加载项。');
      if(job.protocol>=2){
        if(job.capabilities.includes('stagedLedger'))plan.staged=true;
        plan.protocol=job.protocol;plan.capabilities=[...job.capabilities];
      }
      // A pending dialog may receive updated Word preferences after its first scan.
      live.documentSettings(plan.documentData,data=>new this.z.Integration.DocumentData(data));
      if(typeof plan.bindingData!=='string'||!plan.expected?.graph)throw new Error('引用计划缺少完整账本或预期图，未提交到 Word。');
      const data=new this.z.Integration.DocumentData(plan.documentData);
      plan.transactionId=plan.transactionId||this.id();
      data.prefs.zbcTransaction=plan.transactionId;
      plan.documentData=data.serialize();job.plan=plan;this.state(job,'ready');
    }
    submit(id,keys,mapping,options){
      const job=this.job(id);this.ready(job,live.plan(job.snapshot,keys,mapping,{...options,parseLegacy:data=>new this.z.Integration.DocumentData(data)}));return job;
    }
    prepare(id,keys,mapping,options){const job=this.job(id);if(job.state!=='pending'||job.recoveryPending)throw new Error('当前不能准备新的引用计划。');job.prepared=live.plan(job.snapshot,keys,mapping,{...options,parseLegacy:data=>new this.z.Integration.DocumentData(data)});return job.prepared;}
    submitPrepared(id,plan){const job=this.job(id);if(job.prepared!==plan||plan.fingerprint!==job.snapshot.fingerprint)throw new Error('预览后文档发生变化，请重新核对。');this.ready(job,plan);job.prepared=null;return job;}
    recover(id,mapping){const job=this.job(id);this.ready(job,live.recoverBindings(job.snapshot,mapping));return job;}
    sync(id){const job=this.job(id);this.ready(job,live.syncPlan(job.snapshot));return job;}
    resume(id){const job=this.job(id);if(!job.recoveryPlan)throw new Error(job.recoveryError||'没有可验证的恢复计划。');this.ready(job,job.recoveryPlan);return job;}
    saveReferenceSelection(id,{fingerprint,mapping}){
      const job=this.job(id);
      if(job.state!=='pending'||fingerprint!==job.snapshot.fingerprint)throw new Error('引用编号已变化，请重新选择文献。');
      const saved=JSON.parse(JSON.stringify({fingerprint,mapping}));
      this.referenceSelections.set(job.snapshot.documentKey,saved);job.referenceSelection=saved;
    }
    cancel(id){const job=this.jobs.get(id);if(job&&['pending','ready'].includes(job.state))this.state(job,'cancelled');}
    async resolveSnapshotAliases(snapshot){
      const uri=this.z.URI,relations=this.z.Relations;if(!uri?.getURIItem||!uri.getItemURI)return;
      let ledger;try{ledger=JSON.parse(snapshot.bindingData||'{"entries":{}}');}catch{return;}
      const native=new Set((snapshot.citationFields||[]).flatMap(field=>{try{return JSON.parse(field.code.split('CSL_CITATION ')[1]).citationItems.flatMap(item=>item.uris);}catch{return [];}}));
      const aliases=[];
      for(const old of new Set(Object.values(ledger.entries||{}).flatMap(entry=>entry.uris||[]))){
        if(native.has(old))continue;
        let items=[];try{const item=await uri.getURIItem(old);if(item&&!item.deleted)items.push(item);}catch{}
        if(relations?.getByPredicateAndObject&&relations.replacedItemPredicate)items.push(...await relations.getByPredicateAndObject('item',relations.replacedItemPredicate,old));
        items=items.filter(item=>!item.deleted);const ids=new Set(items.map(item=>item.libraryID+':'+item.id));
        if(ids.size===1){const current=uri.getItemURI(items[0]);if(native.has(current))aliases.push({uris:[old,current]});}
      }
      if(aliases.length)snapshot.uriAliases=aliases;
    }
    async run(job){
      try{
        // A carrier sync only rewrites the ledger after the same document has
        // passed verification; it must not trigger a native refresh.
        if(!job.plan?.syncOnly)await this.nativeRun(job);
        if(job.abandoned){this.state(job,'needs-recovery');return;}
        // Native command completion only proves Zotero returned. For a capable
        // Word client the document is re-read and compared with the plan before
        // the transaction is finalized and the window may close.
        this.state(job,'verifying');
      }
      catch(e){job.message=e.message||String(e);this.state(job,'needs-recovery');this.z.logError(e);}
    }
    async nativeRun(job){
      const z=this.z,I=z.Integration;
      if(this.closed||I.currentDoc)throw new Error('Zotero 正忙或插件已停用，引用域已保留，请稍后刷新。');
      const deferred=z.Promise.defer();I.currentCommandPromise=deferred.promise;I.currentDoc=true;
      let doc,session;
      try{
        const app=I.getApplication('WinWord',COMMANDS[job.command],job.snapshot.path);
        // Windows' JS wrapper calls indexOf() on this value, even for unsaved docs.
        // A non-path identifier selects the native active-document fallback; the
        // per-operation nonce below still has to match before any citation update.
        // Saved/closed/reopened documents can leave a stale ROT moniker behind.
        // Commit already activates the captured target; the nonce below proves
        // its identity before any native operation, independently of its path.
        doc=await app.getDocument('__zbc_active__');
        if(await doc.getDocumentData()!==job.plan.documentData)throw new Error('Word 目标文档不匹配，已停止。请激活原文档后重新发起。');
        I.currentDoc=doc;
        let imported;[session,imported]=await I.getSession(app,doc,'WinWord',COMMANDS[job.command]);
        if(imported)throw new Error('文档需要先完成 Zotero 官方导入。');
        I.currentSession=session;
        const iface=new I.Interface(app,doc,session);
        const command=job.command==='bibliography'&&job.snapshot.bibliographyCount>0?'refresh':COMMANDS[job.command];
        if(typeof iface[command]!=='function')throw new Error('当前 Zotero 的 Word 接口与本插件不兼容。');
        await iface[command]();
        if(job.command==='citation')await iface.refresh();
        await doc.setDocumentData(session.data.serialize());
      }finally{
        try{if(session?.progressBar)await session.progressBar.hide();}
        finally{
          try{if(doc){try{await doc.cleanup();}finally{await doc.complete();}}}
          finally{I.currentDoc=false;I.currentWindow=false;deferred.resolve();}
        }
      }
    }
    close(){this.closed=true;this.referenceSelections.clear();if(this.execWrapper&&this.z.Integration.execCommand===this.execWrapper)this.z.Integration.execCommand=this.originalExec;for(const job of this.jobs.values()){if(['pending','ready'].includes(job.state))this.state(job,'cancelled');job.listeners.clear();}}
  }
  return {Service};
});
