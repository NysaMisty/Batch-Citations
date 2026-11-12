/* SPDX-License-Identifier: MIT */
// Mount Zotero's own collection tree, item tree and quick search in our workspace.
// The views belong to the main window; choosing references never opens a dialog.
globalThis.ZBLibrary={
  views:new WeakMap(),
  mount(adapter){
    const win=adapter.window,cached=this.views.get(win);if(cached)return cached;
    const doc=win.document,z=adapter.Zotero,views=this.views;
    let disposed=false,selection=Promise.resolve();
    const view={itemsView:null,collectionsView:null,onSelect:null,onActivate:null,onError:null,
      dispose(){
        if(disposed)return;disposed=true;view.onSelect=view.onActivate=view.onError=null;
        win.removeEventListener('unload',unload);
        doc.getElementById('zotero-tb-search').removeEventListener('command',search);
        for(const tree of [view.collectionsView,view.itemsView])tree?.unregister();
        if(views.get(win)===view)views.delete(win);
      }};
    function unload(event){if(event.target===doc)view.dispose();}
    function search(){view.itemsView?.setFilter('search',doc.getElementById('zotero-tb-search-textbox').value);}
    async function selectCollection(){
      if(disposed||!view.collectionsView?.selection.count)return;
      const row=view.collectionsView.getRow(view.collectionsView.selection.focused),items=view.itemsView;
      if(!row||!items)return;
      if((items.collectionTreeRows?.[0]||items.collectionTreeRow)?.id===row.id){view.collectionsView.runListeners('select');return;}
      row.setSearch('');z.Prefs.set('lastViewedFolder',row.id);
      items.setItemsPaneMessage(z.getString('pane.items.loading'));
      const library=z.Libraries.get(row.ref.libraryID);
      if(!library.getDataLoaded('item'))await library.waitForDataLoad('item');
      if(disposed)return;
      if(items.changeCollectionTreeRows)await items.changeCollectionTreeRows([row]);else await items.changeCollectionTreeRow(row);
      if(disposed)return;
      items.clearItemsPaneMessage();view.collectionsView.runListeners('select');view.onSelect?.();
    }
    views.set(win,view);win.addEventListener('unload',unload);
    view.ready=(async()=>{
      const CollectionTree=win.require('zotero/collectionTree');
      let ItemTree;
      try{ItemTree=win.require('zotero/collectionViewItemTree');}catch{ItemTree=win.require('zotero/itemTree');}
      z.UIProperties.registerRoot(doc.getElementById('zbc-reference-workspace'));
      view.itemsView=await ItemTree.init(doc.getElementById('zotero-items-tree'),{
        id:'zbc-reference-workspace',singleSelection:true,multiSelect:false,regularOnly:true,
        dragAndDrop:false,persistColumns:true,columnPicker:true,emptyMessage:z.getString('pane.items.loading'),
        onSelectionChange:()=>{view.itemsView?.runListeners('select');view.onSelect?.();},onActivate:()=>view.onActivate?.()
      });
      if(disposed){view.itemsView.unregister();return view;}
      view.collectionsView=await CollectionTree.init(doc.getElementById('zotero-collections-tree'),{
        hideSources:['duplicates','trash','feeds'],filterLibraryIDs:false,
        onSelectionChange:()=>{selection=selection.then(selectCollection).catch(e=>{z.logError(e);view.onError?.(e);});return selection;}
      });
      if(disposed){view.collectionsView.unregister();return view;}
      await view.collectionsView.makeVisible();await selection;await selectCollection();
      if(disposed)return view;
      z.updateQuickSearchBox(doc);doc.getElementById('zotero-tb-search').addEventListener('command',search);
      return view;
    })().catch(error=>{view.dispose();throw error;});
    return view;
  }
};
