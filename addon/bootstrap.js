/* SPDX-License-Identifier: MIT */
var BatchCitations;
function install() {}
function uninstall() {}
async function startup({rootURI}) {
  await Zotero.initializationPromise;
  const registration = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
    .getService(Components.interfaces.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI+'manifest.json'),[['content','zotero-batch-citations',rootURI+'content/']]);
  BatchCitations={
    registration, dialogs:new Set(), dialogJobs:new Map(),
    foreground(window){
      if(!Zotero.isWin)return false;
      let library;
      try{
        const base=window.docShell.treeOwner.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIBaseWindow);
        const {ctypes}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
        const hwnd=ctypes.voidptr_t(ctypes.UInt64(base.nativeHandle));
        library=ctypes.open('user32.dll');
        const process=library.declare('GetWindowThreadProcessId',ctypes.winapi_abi,ctypes.uint32_t,ctypes.voidptr_t,ctypes.uint32_t.ptr),pid=ctypes.uint32_t();
        process(hwnd,pid.address());
        if(pid.value!==Services.appinfo.processID)return false;
        const activate=library.declare('SetForegroundWindow',ctypes.winapi_abi,ctypes.int,ctypes.voidptr_t);
        // Windows may refuse when a different application received intervening input.
        // Word grants permission just before start/focus; never alter topmost state.
        return !!activate(hwnd);
      }catch(e){Zotero.logError?.(e);return false;}
      finally{library?.close();}
    },
    focus(window){
      if(!window||window.closed)return;
      for(const step of [
        ()=>{if(window.windowState===2)window.restore?.();},
        ()=>Zotero.Utilities?.Internal?.activate?.(window),
        ()=>window.focus(),
        ()=>{if(Services.focus)Services.focus.activeWindow=window;}
      ])try{step();}catch(e){Zotero.logError?.(e);}
      this.lastActivation={native:this.foreground(window),focused:Services.focus?.activeWindow===window};
    },
    findDialog(id){
      for(const window of this.dialogs){try{if(!window.closed){if(this.dialogJobs.get(window)===(id||null))return window;continue;}}catch{}this.liveService?.cancel(this.dialogJobs.get(window));this.dialogs.delete(window);this.dialogJobs.delete(window);}
      return null;
    },
    closeLive(id){const window=this.findDialog(id);if(window){this.dialogs.delete(window);this.dialogJobs.delete(window);window.close();}},
    open(window,liveJob=null) {
      const existing=this.findDialog(liveJob?.id);
      if(existing){this.focus(existing);return existing;}
      const width=Math.max(640,Math.min(1000,(window?.screen?.availWidth||1040)-40)),height=Math.max(480,Math.min(840,(window?.screen?.availHeight||900)-40));
      const url='chrome://zotero-batch-citations/content/dialog.xhtml',name=liveJob?'zbc-live-'+liveJob.id:'zotero-batch-citations',features=`chrome,centerscreen,resizable,dialog=no,width=${width},height=${height}`,io={Zotero,liveJob,liveService:this.liveService};
      io.wrappedJSObject=io;
      // Native integration creates an unparented window. Parenting to the library
      // window can restore/raise that window on Windows even if only the child is focused.
      const dialog=liveJob&&Services.ww?Services.ww.openWindow(null,url,name,features,io):window.openDialog(url,name,features,io);
      this.dialogs.add(dialog);this.dialogJobs.set(dialog,liveJob?.id||null);this.focus(dialog);
      const loaded=event=>{
        if(event.target?.documentURI!=='chrome://zotero-batch-citations/content/dialog.xhtml')return;
        dialog.removeEventListener('load',loaded);if(!dialog.closed){
          this.focus(dialog);
          // The native widget can still be unmapped at load. One paint-bound retry
          // handles that transition without a timer that repeatedly steals focus.
          dialog.requestAnimationFrame?.(()=>{if(!dialog.closed)this.focus(dialog);});
        }
      };
      dialog.addEventListener('load',loaded);
      dialog.addEventListener('unload',event=>{
        // openDialog first unloads about:blank. Only remove the actual plugin document.
        if(event.target===dialog.document&&event.target.documentURI===url){this.liveService?.cancel(liveJob?.id);this.dialogs.delete(dialog);this.dialogJobs.delete(dialog);}
      });
      return dialog;
    },
    openLive(job){return this.open(Zotero.getMainWindow(),job);},
    toast(window,text,error=false){
      const doc=window.document;doc.getElementById('zbc-toast')?.remove();
      const toast=doc.createElementNS('http://www.w3.org/1999/xhtml','div');toast.id='zbc-toast';toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');toast.textContent=text;
      toast.style.cssText='position:fixed;z-index:100000;top:18px;left:50%;transform:translateX(-50%);max-width:600px;padding:12px 18px;border:1px solid GrayText;border-inline-start:3px solid '+(error?'#b33':'Highlight')+';border-radius:5px;background:Canvas;color:CanvasText;font:message-box;box-shadow:0 3px 12px #0002;';
      doc.documentElement.appendChild(toast);window.setTimeout(()=>toast.remove(),4500);
    },
    signalWord(message,broadcast=false){
      let library;
      try{
        if(!Zotero.isWin)throw new Error('当前文档功能需要 Windows 桌面 Word。');
        const {ctypes}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
        library=ctypes.open('user32.dll');
        const find=library.declare('FindWindowExW',ctypes.winapi_abi,ctypes.voidptr_t,ctypes.voidptr_t,ctypes.voidptr_t,ctypes.jschar.ptr,ctypes.jschar.ptr);
        const register=library.declare('RegisterWindowMessageW',ctypes.winapi_abi,ctypes.uint32_t,ctypes.jschar.ptr);
        const post=library.declare('PostMessageW',ctypes.winapi_abi,ctypes.int,ctypes.voidptr_t,ctypes.uint32_t,ctypes.uintptr_t,ctypes.intptr_t);
        let previous=ctypes.voidptr_t(),sent=false;
        const id=register(message);
        while(true){
          const hwnd=find(ctypes.voidptr_t(-3),previous,null,'ZoteroBatchCitations.Bridge');
          if(hwnd.isNull())break;
          sent=!!post(hwnd,id,0,0)||sent;
          if(!broadcast)break;previous=hwnd;
        }
        return sent;
      }finally{library?.close();}
    },
    notifyWord(){this.signalWord('ZoteroBatchCitations.JobChanged',true);},
    openWord(window){
      const existing=[...this.dialogJobs].find(([w,id])=>!w.closed&&['pending','ready','running'].includes(this.liveService?.jobs.get(id)?.state))?.[0];
      if(existing){this.focus(existing);return;}
      try{if(!this.signalWord('ZoteroBatchCitations.OpenCurrentDocument'))throw new Error('请先打开 Word 文档并启用 1.1.4 Word 加载项，再点击“批量匹配编号”。');}
      catch(e){this.toast(window,e.message||String(e),true);Zotero.logError(e);}
    },
    randomID(){return Zotero.getMainWindow().crypto.randomUUID().replace(/-/g,'');},
    schedule(fn){Zotero.getMainWindow().setTimeout(fn,50);},
    async startLive(){
      if(!Zotero.isWin||!Zotero.Server?.Endpoints)return;
      const scope={};scope.globalThis=scope;
      for(const name of ['core.js','mapping.js','citation-state.js','live-core.js','live-service.js'])Services.scriptloader.loadSubScript(rootURI+'content/'+name,scope);
      const token=this.randomID()+this.randomID();
      this.liveService=new scope.ZBLiveService.Service(Zotero,this,{token});
      let path=Zotero.Prefs.get('batchCitations.connectionPath');
      if(!path)path=PathUtils.join(Services.dirsvc.get('LocalAppData',Components.interfaces.nsIFile).path,'ZoteroBatchCitations','connection.json');
      this.connectionPath=path;
      await IOUtils.makeDirectory(PathUtils.parent(path),{ignoreExisting:true,permissions:0o700});
      // The connector already listens only on loopback. Do not start a separate network service.
      const port=Zotero.Server.port;
      const service=this.liveService;
      this.endpoint=function(){};
      this.endpoint.prototype={supportedMethods:['POST'],supportedDataTypes:['application/json'],permitBookmarklet:false,init:function(request){return service.request(request);}};
      Zotero.Server.Endpoints['/batch-citations/live']=this.endpoint;
      await IOUtils.writeUTF8(path,JSON.stringify({protocol:1,version:'2.0.0',processID:Services.appinfo.processID,port,token}),{permissions:0o600});
    },
    stopLive(){
      this.liveService?.close();
      if(this.endpoint&&Zotero.Server?.Endpoints['/batch-citations/live']===this.endpoint)delete Zotero.Server.Endpoints['/batch-citations/live'];
      const path=this.connectionPath,token=this.liveService?.token;
      if(path)IOUtils.readUTF8(path).then(text=>{if(JSON.parse(text).token===token)return IOUtils.remove(path);}).catch(e=>Zotero.logError(e));
    },
    add(window) {
      const doc=window.document;
      if(doc.getElementById('zbc-tools-menu'))return;
      const parent=doc.getElementById('menu_ToolsPopup');
      if(!parent){Zotero.logError('Batch Citations: Tools menu not found');return;}
      const menu=doc.createXULElement('menuitem');menu.id='zbc-tools-menu';menu.setAttribute('label','编号批量引用…');
      menu.setAttribute('class','menuitem-iconic');menu.setAttribute('image','chrome://zotero-batch-citations/content/icons/batch-citations.svg');
      menu.addEventListener('command',()=>this.openWord(window));parent.appendChild(menu);
      const compatibility=doc.createXULElement('menuitem');compatibility.id='zbc-compatibility-menu';compatibility.setAttribute('label','编号批量引用：DOCX 文件兼容模式…');
      compatibility.addEventListener('command',()=>this.open(window));parent.appendChild(compatibility);
    }
  };
  Zotero.BatchCitations=BatchCitations;
  for(const window of Zotero.getMainWindows())BatchCitations.add(window);
  try{await BatchCitations.startLive();}catch(e){BatchCitations.liveError=String(e);Zotero.logError(e);}
}
function onMainWindowLoad({window}){BatchCitations?.add(window);}
function onMainWindowUnload(){}
function shutdown() {
  if(!BatchCitations)return;
  BatchCitations.stopLive();
  for(const window of Zotero.getMainWindows())for(const id of ['zbc-tools-menu','zbc-compatibility-menu','zbc-toast'])window.document.getElementById(id)?.remove();
  for(const dialog of BatchCitations.dialogs)if(!dialog.closed)dialog.close();
  BatchCitations.dialogs.clear();BatchCitations.dialogJobs.clear();
  BatchCitations.registration.destruct();
  delete Zotero.BatchCitations;
  BatchCitations=undefined;
}
