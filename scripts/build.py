"""Build deterministic development packages from the one maintained source tree."""
import argparse
import hashlib
import json
import os
import sys
import zipfile
from pathlib import Path
from version import PROJECT, synchronize

IGNORED = {'dist', 'node_modules', '.git', '__pycache__', 'bin'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def content_hash(files):
    digest = hashlib.sha256()
    for name, data in sorted(files):
        digest.update(name.encode())
        digest.update(b'\0')
        digest.update(data)
        digest.update(b'\0')
    return digest.hexdigest()


def source_files(project=PROJECT):
    for folder, directories, names in os.walk(project):
        directories[:] = sorted(name for name in directories if name not in IGNORED)
        for name in sorted(names):
            path = Path(folder) / name
            if path.suffix not in {'.pyc', '.xpi', '.zip'}:
                yield path


def source_hashes(project=PROJECT):
    return {path.relative_to(project).as_posix(): sha(path.read_bytes()) for path in source_files(project)}


def verify_assembly(project=PROJECT, version=None):
    version = version or synchronize(project, check=True)
    assembly = project / 'word-addin/bin/ZoteroBatchCitations.dll'
    info = json.loads((project / 'word-addin/bin/build-info.json').read_text(encoding='utf-8-sig'))
    if info['version'] != version + '.0' or info['assemblySHA256'] != sha(assembly.read_bytes()):
        raise ValueError('Word assembly/version differs from its build record; rebuild word-addin/build.ps1')
    expected = {p.name for p in (project / 'word-addin').glob('*.cs')} | {'build.ps1', 'icons/batch-ribbon.png', 'icons/display-ribbon.png'}
    if set(info['sources']) != expected:
        raise ValueError('Incomplete Word build source record')
    for name, digest in info['sources'].items():
        path = (project / 'word-addin' / name).resolve()
        if not path.is_relative_to((project / 'word-addin').resolve()) or sha(path.read_bytes()) != digest:
            raise ValueError('Word sources changed since compilation: ' + name)
    return info


def archive(destination, files):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name, data in sorted(files):
            info = zipfile.ZipInfo(name, (2026, 11, 5, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, data)
    with zipfile.ZipFile(destination) as output:
        if output.testzip() is not None:
            raise ValueError('Invalid archive: ' + str(destination))


def checksums(directory):
    files = sorted(p for p in directory.rglob('*') if p.is_file() and p.name != 'SHA256SUMS.txt')
    text = ''.join(sha(p.read_bytes()) + '  ' + p.relative_to(directory).as_posix() + '\n' for p in files)
    (directory / 'SHA256SUMS.txt').write_text(text, encoding='utf8')


def common_files(project=PROJECT):
    docs = [(p.relative_to(project).as_posix(), p.read_bytes()) for p in (project / 'docs').rglob('*') if p.is_file() and 'superpowers' not in p.parts]
    template = ('examples/citation-literature-example.csv', (project / 'examples/citation-literature-example.csv').read_bytes())
    return [(name, (project / name).read_bytes()) for name in ['README.md', 'CHANGELOG.md', 'LICENSE']] + [template, *docs]


def word_files(project=PROJECT):
    names = ['install.ps1', 'RibbonIntegration.ps1', 'Install.cmd', 'Uninstall.cmd']
    return [('ZoteroBatchCitations.dll', (project / 'word-addin/bin/ZoteroBatchCitations.dll').read_bytes()), *[(name, (project / 'word-addin' / name).read_bytes()) for name in names], *common_files(project)]


def build(output, source_output=None, project=PROJECT):
    project, output = Path(project).resolve(), Path(output).resolve()
    formal = project.parent.parent / 'outputs/当前版本'
    if not output.is_relative_to(project / 'dist'):
        raise ValueError('Build only in ignored dist staging; use release.py promote for formal delivery')
    version = synchronize(project, check=True)
    verify_assembly(project, version)
    output.mkdir(parents=True, exist_ok=True)
    source_output = Path(source_output).resolve() if source_output else output
    if not source_output.is_relative_to(project / 'dist'):
        raise ValueError('Source archive must stay in ignored dist staging')
    source_output.mkdir(parents=True, exist_ok=True)
    prefix = 'zotero-batch-citations-' + version
    addon = [(p.relative_to(project / 'addon').as_posix(), p.read_bytes()) for p in (project / 'addon').rglob('*') if p.is_file()]
    xpi = output / (prefix + '.xpi')
    archive(xpi, addon)
    archive(source_output / (prefix + '-source.zip'), [(prefix + '/' + p.relative_to(project).as_posix(), p.read_bytes()) for p in source_files(project)])
    common = common_files(project)
    word = output / (prefix + '-word.zip')
    archive(word, word_files(project))
    archive(output / (prefix + '-bundle.zip'), [(xpi.name, xpi.read_bytes()), (word.name, word.read_bytes()), *common])
    checksums(output)
    return {'version': version, 'addonContentSHA256': content_hash(addon), 'assemblySHA256': verify_assembly(project, version)['assemblySHA256']}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=PROJECT / 'dist')
    parser.add_argument('--source-output-dir', type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output_dir, args.source_output_dir), ensure_ascii=False, indent=2))
