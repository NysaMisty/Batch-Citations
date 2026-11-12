"""Create an isolated 1.1.5 screenshot profile from the preserved pre-edit addon."""
import argparse,json,subprocess,sys,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('name');args=p.parse_args()
project=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(project/'scripts'/'prepare-runtime.py'),args.name,'--capture-ui'],check=True)
root=project.parent/'test-runs'/'active'/('test-'+args.name)
baseline=project.parent/'test-runs'/'active'/'test-v116-baseline'/'addon'
assert json.loads((baseline/'manifest.json').read_text(encoding='utf8'))['version']=='1.1.5'
config=json.loads((root/'profile'/'runtime-harness.json').read_text(encoding='utf8'))
bootstrap='async function startup(){await Zotero.initializationPromise;Services.scriptloader.loadSubScript('+json.dumps((project/'tests'/'ui-baseline-runtime.js').as_uri())+');await runBaselineUI(Zotero,'+json.dumps(config)+');}\nfunction shutdown(){}\nfunction install(){}\nfunction uninstall(){}'
(root/'runner'/'bootstrap.js').write_text(bootstrap,encoding='utf8')
for name,source in [('batch-citations@nanyan.local',baseline),('zbc-test-runner@nanyan.local',root/'runner')]:
    with zipfile.ZipFile(root/'packages'/(name+'.xpi'),'w',zipfile.ZIP_DEFLATED) as archive:
        for file in source.rglob('*'):
            if file.is_file():archive.write(file,file.relative_to(source).as_posix())
