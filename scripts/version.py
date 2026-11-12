"""Set or verify the one release version across runtime, installer and package metadata."""
import argparse
import json
import re
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r'\d+\.\d+\.\d+')
TEXT_FIELDS = {
    'README.md': [
        (r'\A# 编号批量引用 · Batch Citations (\d+\.\d+\.\d+)', 1),
        (r'zotero-batch-citations-(\d+\.\d+\.\d+)(?:-bundle\.zip|-word\.zip|\.xpi)', 3),
        (r'DEVELOPMENT-(\d+\.\d+\.\d+)\.md', 1),
        (r'images/picker-\d+\.\d+\.\d+-(\d+\.\d+\.\d+)\.png', 1),
    ],
    'addon/bootstrap.js': [(r"version:'(\d+\.\d+\.\d+)'", 1)],
    'addon/content/dialog.xhtml': [(r'id="version" hidden="hidden">(\d+\.\d+\.\d+)<', 1)],
    'addon/content/live-service.js': [(r"version:'(\d+\.\d+\.\d+)'", 1), (r'至 (\d+\.\d+\.\d+)，', 1)],
    'word-addin/BridgeClient.cs': [(r'clientVersion = "(\d+\.\d+\.\d+)"', 1)],
    'word-addin/Connect.cs': [(r'Assembly(?:File)?Version\("(\d+\.\d+\.\d+)\.0"\)', 2), (r'clientVersion = "(\d+\.\d+\.\d+)"', 1)],
    'word-addin/install.ps1': [(r"ZoteroBatchCitations\\word\\(\d+\.\d+\.\d+)'", 1), (r'InprocServer32\\(\d+\.\d+\.\d+)\.0', 1), (r"FriendlyName', 'Zotero Batch Citations (\d+\.\d+\.\d+)'", 1)],
}


def synchronize(project=PROJECT, target=None, check=False):
    project = Path(project)
    current = json.loads((project / 'package.json').read_text(encoding='utf8'))['version']
    version = target or current
    if not SEMVER.fullmatch(version):
        raise ValueError('Use a numeric x.y.z version')
    updates = {}
    for name in ['package.json', 'package-lock.json', 'addon/manifest.json']:
        path = project / name
        data = json.loads(path.read_text(encoding='utf8'))
        values = [data['version']]
        if name == 'package-lock.json':
            values.append(data['packages']['']['version'])
            data['packages']['']['version'] = version
        if check and any(value != version for value in values):
            raise ValueError('Version mismatch: ' + name)
        data['version'] = version
        updates[path] = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    for name, fields in TEXT_FIELDS.items():
        path = project / name
        text = path.read_text(encoding='utf8')
        for pattern, count in fields:
            matches = list(re.finditer(pattern, text))
            if len(matches) != count:
                raise ValueError('Unexpected version metadata: ' + name)
            if check and any(match[1] != version for match in matches):
                raise ValueError('Version mismatch: ' + name)
            for match in reversed(matches):
                text = text[:match.start(1)] + version + text[match.end(1):]
        if name.endswith('live-service.js'):
            pattern = r"if\(!\[([^]]+)\]\.includes\(data.clientVersion\)\)"
            match = re.search(pattern, text)
            if not match:
                raise ValueError('Missing client compatibility declaration')
            accepted = re.findall(r"'([^']+)'", match[1])
            if version not in accepted:
                if check:
                    raise ValueError('Current client version is not accepted')
                text = text[:match.end(1)] + ",'" + version + "'" + text[match.end(1):]
        updates[path] = text
    if not check:
        for path, text in updates.items():
            path.write_text(text, encoding='utf8', newline='\n')
    return version


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version', nargs='?')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    print(synchronize(target=args.version, check=args.check))
