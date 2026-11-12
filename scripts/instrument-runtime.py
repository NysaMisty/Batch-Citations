"""Instrument a COPY of Zotero in work/runtimes/ to install test XPIs after startup.

The installed Zotero and its real profile must never be passed to this script.
"""
import argparse,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('runtime');a=p.parse_args()
runtime=Path(a.runtime).resolve()
allowed=Path(__file__).resolve().parents[2]/'runtimes'
if not runtime.is_relative_to(allowed) or not runtime.name.startswith(('runtime','Zotero_')):
    raise SystemExit('Only a disposable work runtime is allowed')
jar=runtime/'app'/'omni.ja'
target='chrome/content/zotero/xpcom/zotero.js'
marker='// ZBC DISPOSABLE RUNTIME INSTRUMENTATION'
hook=r'''
// ZBC DISPOSABLE RUNTIME INSTRUMENTATION
var zbcHarnessTimer=setInterval(async()=>{
  if(!Zotero.initialized || !Zotero.getMainWindow()?.document.getElementById('menu_ToolsPopup'))return;
  clearInterval(zbcHarnessTimer);
  const zbcProfile=Services.dirsvc.get('ProfD',Components.interfaces.nsIFile).path;
  const zbcConfig=PathUtils.join(zbcProfile,'runtime-harness.json');
  if(!(await IOUtils.exists(zbcConfig)))return;
  const config=JSON.parse(await IOUtils.readUTF8(zbcConfig));
  try{
    const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    for(const id of ['batch-citations@nanyan.local','zbc-test-runner@nanyan.local']){
      const file=Zotero.File.pathToFile(PathUtils.join(config.packages,id+'.xpi'));
      const install=await AddonManager.getInstallForFile(file);
      await install.install();
    }
  }catch(e){await IOUtils.writeUTF8(config.result,JSON.stringify({ok:false,harnessError:String(e),stack:e.stack},null,2));}
},200);
'''
with zipfile.ZipFile(jar) as z:
    data=[(info,z.read(info.filename)) for info in z.infolist()]
if any(marker.encode() in b for i,b in data if i.filename==target):
    print('Already instrumented');raise SystemExit(0)
tmp=jar.with_suffix('.test.ja')
with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as z:
    for info,b in data:
        z.writestr(info.filename,b+hook.encode() if info.filename==target else b)
tmp.replace(jar)
print('Instrumented disposable runtime:',runtime)
