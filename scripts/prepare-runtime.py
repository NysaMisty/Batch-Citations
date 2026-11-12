"""Create disposable profiles; never use the user's Zotero profile or library."""
import argparse, json, zipfile
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('name')
parser.add_argument('--keep-open',action='store_true')
parser.add_argument('--word-test',action='store_true')
parser.add_argument('--live-test',action='store_true')
parser.add_argument('--hold-batch',action='store_true',help='Keep the live dialog open for event-driven UI tests')
parser.add_argument('--capture-ui',action='store_true',help='Save an in-process screenshot of the isolated plugin window')
args=parser.parse_args()
project=Path(__file__).resolve().parents[1]
base=project.parent/'test-runs'/'active'/('test-'+args.name)
if base.exists():
    raise SystemExit('Use a fresh test name; refusing to reuse an existing profile or overwrite evidence: '+str(base))
profile=base/'profile'
(profile/'extensions').mkdir(parents=True,exist_ok=True)
(base/'data').mkdir(parents=True,exist_ok=True)
runner=base/'runner'
runner.mkdir(exist_ok=True)
packages=base/'packages';packages.mkdir(exist_ok=True)
config={'input':str(project/'examples'/'placeholder-demo.docx'),'output':str(base/'converted.docx'),'result':str(base/'result.json'),'keepOpen':args.keep_open,'packages':str(packages)}
config['holdBatch']=args.hold_batch
config['captureUI']=str(base/'dialog-native.png') if args.capture_ui else None
config['automaticUIScript']=(project/'tests'/'automatic-ui-runtime.js').as_uri()
config['pickerScript']=(project/'tests'/'picker-runtime.js').as_uri()
config['selectionScript']=(project/'tests'/'selection-runtime.js').as_uri()
config['iterationScript']=(project/'tests'/'iteration-runtime.js').as_uri()
config['layoutScript']=(project/'tests'/'ui-layout-runtime.js').as_uri()
if args.word_test:
    config.update(keepOpen=True,wordTest=True,wordScript=(project/'tests'/'word-runtime.js').as_uri())
(profile/'runtime-harness.json').write_text(json.dumps(config),encoding='utf-8')
(runner/'manifest.json').write_text(json.dumps({'manifest_version':2,'name':'Disposable test runner','version':'0.1','applications':{'zotero':{'id':'zbc-test-runner@nanyan.local','update_url':'https://example.invalid/zbc-test/updates.json','strict_min_version':'7.0','strict_max_version':'10.0.*'}}}),encoding='utf-8')
test_uri=(project/'tests'/'runtime.js').as_uri()
if args.live_test:
    test_uri=(project/'tests'/'live-runtime.js').as_uri()
test_function='runLiveRuntimeTest' if args.live_test else 'runRuntimeTest'
(runner/'bootstrap.js').write_text('async function startup(){await Zotero.initializationPromise;Services.scriptloader.loadSubScript('+json.dumps(test_uri)+');await '+test_function+'(Zotero,'+json.dumps(config)+');}\nfunction shutdown(){}\nfunction install(){}\nfunction uninstall(){}',encoding='utf-8')
for addon,location in [('batch-citations@nanyan.local',project/'addon'),('zbc-test-runner@nanyan.local',runner)]:
    with zipfile.ZipFile(packages/(addon+'.xpi'),'w',zipfile.ZIP_DEFLATED) as z:
        for f in location.rglob('*'):
            if f.is_file():z.write(f,f.relative_to(location).as_posix())
prefs={
 # The disposable background host must render geometry even when covered by another app.
 'widget.windows.window_occlusion_tracking.enabled':False,
 'extensions.zotero.dataDir':str(base/'data'),'extensions.zotero.useDataDir':True,
 'extensions.zotero.firstRun2':False,'extensions.zotero.sync.autoSync':False,
 'extensions.zotero.batchCitations.connectionPath':str(base/'connection.json'),
 'extensions.zoteroWinWordIntegration.skipInstallation':True,
 'extensions.zoteroMacWordIntegration.skipInstallation':True,
 'extensions.zoteroOpenOfficeIntegration.skipInstallation':True,
 'extensions.zotero.automaticScraperUpdates':False,'extensions.zotero.reportTranslationFailure':False,
 'extensions.autoDisableScopes':0,'extensions.enabledScopes':15,'extensions.startupScanScopes':15,
 'extensions.logging.enabled':True,
 'app.update.auto':False,'app.update.enabled':False,
 'browser.shell.checkDefaultBrowser':False,'toolkit.telemetry.enabled':False,
}
(profile/'user.js').write_text('\n'.join('user_pref('+json.dumps(k)+', '+json.dumps(v)+');' for k,v in prefs.items()),encoding='utf-8')
print(profile)
