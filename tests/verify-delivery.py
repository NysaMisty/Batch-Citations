"""Bind 1.1.7+ acceptance evidence to the exact current addon and Word binary."""
import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

project = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project / 'scripts'))
from build import content_hash, sha, verify_assembly
from version import synchronize

sys.stdout.reconfigure(encoding='utf8')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('inputs', type=Path, help='release input JSON from the isolated host tests')
inputs = json.loads(parser.parse_args().inputs.read_text(encoding='utf-8-sig'))
version = synchronize(check=True)
assert inputs['version'] == version
workspace = project.parent.resolve()
source_fixture = workspace / inputs['sourceFixture']
source_hash = sha(source_fixture.read_bytes())
manifest = json.loads((project / 'addon/manifest.json').read_text(encoding='utf-8-sig'))
package_name = manifest['applications']['zotero']['id'] + '.xpi'
evidence = project / 'docs/test-results'
addon_hash = content_hash((p.relative_to(project / 'addon').as_posix(), p.read_bytes()) for p in (project / 'addon').rglob('*') if p.is_file())
assembly_hash = verify_assembly()['assemblySHA256']
proof = {'ok': True, 'version': version, 'addonContentSHA256': addon_hash, 'assemblySHA256': assembly_hash, 'hosts': [], 'independent': {}, 'evidenceFiles': {}}


def root(name):
    directory = (workspace / name).resolve()
    assert directory.is_relative_to(workspace) and directory.name.startswith('test-')
    return directory


def read(directory, name):
    data = json.loads((directory / name).read_text(encoding='utf-8-sig'))
    assert data.get('ok'), (str(directory), name, data.get('error'))
    return data


def copy(directory, name, destination):
    path = evidence / destination
    shutil.copy2(directory / name, path)
    proof['evidenceFiles'][path.relative_to(project).as_posix()] = sha(path.read_bytes())


def package(directory):
    with zipfile.ZipFile(directory / 'packages' / package_name) as archive:
        assert archive.testzip() is None
        assert content_hash((name, archive.read(name)) for name in archive.namelist()) == addon_hash, 'Tested addon differs from the release source'


def restored(directory):
    data = read(directory, 'host-restoration.json')
    assert all(data.get(key) for key in ['normalWordLaunch', 'registrationRestored', 'nativeTemplateUnchanged', 'userTemplateUnchanged'])


for host in inputs['hosts']:
    zotero = host['zoteroVersion']
    ui_root, live_root, activation_root = [root(host[key]) for key in ['ui', 'live', 'activation']]
    ui = read(ui_root, 'result.json')
    live = read(live_root, 'word-iteration-result.json')
    activation = read(activation_root, 'word-auto-result.json')
    assert ui['version'] == live['zoteroVersion'] == zotero
    assert all(row['fits'] and row['actionsFit'] and row['centered'] for row in ui['mainGeometry'])
    assert len(ui['mainGeometry']) == 6
    geometry = ui['pickerLayout']['largeGeometry']
    assert len(geometry) == 12 and all(row['fits'] and row['actionsFit'] and row['aligned'] and row['sameLine'] for row in geometry)
    assert {row['layout'] for row in geometry} == {'stacked', 'side'} and {row['scheme'] for row in geometry} == {'light', 'dark'}
    assert ui['pickerLayout']['persistent'] and ui['pickerLayout']['allLayoutsRetainMapping']
    assert len(ui['pickerLayout']['boundaryGeometry']) == 6 and all(row['fits'] for row in ui['pickerLayout']['boundaryGeometry'])
    for required in ['opening the main window directly exposes one native library and numbered queue', 'redundant number selector and three confirmation buttons are absent', 'native single click highlights a reference without applying a mapping', 'native double click immediately binds the selected reference once', 'native double click saves the current number without a draft', 'unmatched keyboard input expires before automatic native reselection', 'native library refresh does not bind an automatically reselected item', 'mapping selection does not select or write document positions', 'partial immediate mapping keeps untouched numbers and the native library', 'explicit clear immediately updates its numbered slot', 'number title and whitespace share the selected row feedback', 'automatic application failure reports an error and preserves applied mapping', 'occurrence number targets the shared native picker', 'repeated layout switches retain both scroll positions and native sorting', 'resize fallback restores side preference automatically without another click', 'new main window restores layout preference without document or export state', 'empty queue can switch layouts without resetting native browsing', 'long titles remain single line with complete tooltip', 'locked binding is immutable and cannot be crossed by sorting', 'bulk skips whole compound positions until all numbered references are bound', 'clearing a binding immediately unchecks every related compound position', 'library deletion notification prunes a selected range without another user click', 'conversion revalidates URI binding before any output picker or write', 'compatibility conversion accepts shared references after per-number identity validation', 'duplicate reuse requires explicit confirmation with cancel as default', 'drag reorder shows one insertion line', 'replacement preserves every untouched mapping', 'number details area is removed while the numbered queue remains', 'citation position tab remains separate and usable']:
        assert required in ui['checks']
    for directory in [ui_root, live_root, activation_root]:
        package(directory)
    assert live['assemblySHA256'].lower() == activation['wordAddinSHA256'].lower() == assembly_hash
    for directory in [live_root, activation_root]:
        assert sha((directory / 'installed/ZoteroBatchCitations.dll').read_bytes()) == assembly_hash
        restored(directory)
        assert len(read(directory / 'ribbon', 'ribbon-result.json')['checks']) == 7
    assert live['sourceUnchanged'] and source_hash == live['sourceHash'].lower()
    for required in ['immediate reference mapping leaves real Word text and fields unchanged', 'closing and reopening the unchanged real Word document retains the applied UI mapping', 'real partial picker application converts only two fully bound positions and preserves the incomplete compound marker', 'confirmed duplicate labels produce one real reference and retain both historical mappings', 'duplicate numbering preview shares one final reference number', 'individual picker fills the missing number without modifying committed neighboring mappings', 'completed partial and duplicate application survives native refresh save and reopen']:
        assert required in live['checks']
    assert 'live opening directly synchronizes all seventeen picker numbers without a refresh hook' in live['checks']
    io = next(detail['ui'] for detail in live['details'] if detail['fixture'] == 'literature-io-ui')
    assert io['ok'] and io['secondaryMenu'] and io['formats'] == ['csv', 'tsv', 'json']
    for required in ['backup restore controls are secondary and initially collapsed', 'backup guidance describes current lists library and no manual URLs', 'imported duplicate labels require explicit cancel-default confirmation', 'import keeps the persistent numbered queue synchronized']:
        assert required in io['checks']
    assert any('minimized pending window' in name for name in activation['checks'])
    assert any('reuse and focus' in name for name in activation['checks'])
    assert activation['foreground']['visible'] and not activation['foreground']['apiErrors']
    for directory, name, kind in [(ui_root, 'result.json', 'host'), (live_root, 'word-iteration-result.json', 'iteration'), (activation_root, 'word-auto-result.json', 'activation'), (live_root, 'host-restoration.json', 'restoration'), (activation_root, 'host-restoration.json', 'activation-restoration')]:
        copy(directory, name, f'zotero-{zotero}-{kind}-{version}.json')
    proof['hosts'].append({'zoteroVersion': zotero, 'hostChecks': len(ui['checks']), 'iterationChecks': len(live['checks']), 'activationChecks': len(activation['checks']), 'literatureUIChecks': len(io['checks']), 'restored': True, 'foreground': activation['foreground'], 'wordVersion': live['wordVersion'], 'wordBuild': live['wordBuild'], 'devicePixelRatio': sorted({row['devicePixelRatio'] for row in geometry})})
    for name, destination in [('main-1000-literature.png', f'main-{zotero}-{version}.png'), ('picker-side-1000-light.png', f'picker-{zotero}-{version}.png'), ('picker-stacked-640-light.png', f'picker-stacked-{zotero}-{version}.png')]:
        shutil.copy2(ui_root / name, project / 'docs/images' / destination)

for key, label in [('safety', 'safety'), ('integrity', 'integrity'), ('pipeline', 'pipeline')]:
    directory = root(inputs[key])
    name = 'results.json' if key == 'pipeline' else 'result.json'
    if key == 'pipeline':
        data = json.loads((directory / name).read_text(encoding='utf-8-sig'))
        assert data['failed'] == 0 and data['passed'] > 0
        count = data['passed']
    else:
        data = read(directory, name)
        count = len(data['checks'])
    assert data.get('wordAddinSHA256', data.get('assemblySHA256', '')).lower() == assembly_hash
    proof['independent'][label] = count
    copy(directory, name, f'word-{label}-{version}.json')

tap_path = evidence / f'unit-tests-{version}.tap'
tap = tap_path.read_text(encoding='utf-8-sig')
assert re.search(r'^# fail 0$', tap, re.M)
proof['unitTests'] = int(re.search(r'^# tests (\d+)$', tap, re.M)[1])
proof['evidenceFiles'][tap_path.relative_to(project).as_posix()] = sha(tap_path.read_bytes())
(evidence / f'release-proof-{version}.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(proof, ensure_ascii=False, indent=2))
