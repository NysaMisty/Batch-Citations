"""Prepare, verify and locally promote immutable releases; never contact a remote."""
import argparse
import json
import re
import shutil
import subprocess
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from build import PROJECT, build, checksums, common_files, content_hash, sha, source_hashes, verify_assembly, word_files
from version import synchronize


def git(project, *args):
    return subprocess.check_output(['git', *args], cwd=project, text=True, encoding='utf8').strip()


def clean_commit(project):
    if git(project, 'status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Commit the reviewed source, documentation and test records before delivery')
    return git(project, 'rev-parse', 'HEAD')


def verify_evidence(project, proof):
    version = synchronize(project, check=True)
    info = verify_assembly(project, version)
    data = json.loads(Path(proof).read_text(encoding='utf8'))
    addon = content_hash((p.relative_to(project / 'addon').as_posix(), p.read_bytes()) for p in (project / 'addon').rglob('*') if p.is_file())
    if data.get('ok') is not True or data.get('version') != version or data.get('addonContentSHA256') != addon or data.get('assemblySHA256') != info['assemblySHA256']:
        raise ValueError('Evidence does not match the current addon and Word assembly')
    if {host['zoteroVersion'] for host in data.get('hosts', [])} != {'7.0.32', '10.0.7'} or len(data['hosts']) != 2:
        raise ValueError('Both supported Zotero hosts must have fresh acceptance evidence')
    if not data.get('unitTests') or any(not host.get(key) for host in data['hosts'] for key in ['hostChecks', 'iterationChecks', 'activationChecks', 'restored']):
        raise ValueError('Missing unit, binding/layout, Word, activation or restoration checks')
    if set(data.get('independent', {})) != {'safety', 'integrity', 'pipeline'} or not all(data['independent'].values()):
        raise ValueError('Missing independent Word safety/integrity/pipeline checks')
    files = data.get('evidenceFiles', {})
    required = {f'docs/test-results/unit-tests-{version}.tap'}
    required |= {f'docs/test-results/zotero-{v}-{kind}-{version}.json' for v in ['7.0.32', '10.0.7'] for kind in ['host', 'iteration', 'activation', 'restoration', 'activation-restoration']}
    required |= {f'docs/test-results/word-{kind}-{version}.json' for kind in ['safety', 'integrity', 'pipeline']}
    if not required.issubset(files):
        raise ValueError('Incomplete evidence file inventory')
    for name, digest in files.items():
        path = (project / name).resolve()
        if not path.is_relative_to((project / 'docs/test-results').resolve()) or sha(path.read_bytes()) != digest:
            raise ValueError('Missing or changed evidence: ' + name)
    tap = (project / f'docs/test-results/unit-tests-{version}.tap').read_text(encoding='utf8')
    if not re.search(r'^# tests ' + str(data['unitTests']) + r'$', tap, re.M) or not re.search(r'^# fail 0$', tap, re.M):
        raise ValueError('Unit-test evidence does not confirm a complete passing run')
    return data


def prepare(project, outputs, proof):
    version = synchronize(project, check=True)
    commit = clean_commit(project)
    evidence = verify_evidence(project, proof)
    staged = project / 'dist/releases' / version
    if staged.exists() or (outputs / '当前版本' / version).exists():
        raise FileExistsError('Existing version is immutable; use a fresh staged folder/version')
    temporary = project / 'dist/releases' / ('.building-' + version + '-' + uuid.uuid4().hex[:8])
    temporary.mkdir(parents=True)
    # Failed builds are retained as explicitly temporary outputs for diagnosis.
    metadata = build(temporary, project=project)
    for name, data in word_files(project):
        extracted = temporary / 'Word加载项' / name
        extracted.parent.mkdir(parents=True, exist_ok=True)
        extracted.write_bytes(data)
    for name in ['README.md', 'CHANGELOG.md', 'LICENSE']:
        shutil.copy2(project / name, temporary / name)
    for name in ['docs', 'examples']:
        shutil.copytree(project / name, temporary / name)
    (temporary / 'TEST-REPORT.md').write_text(
        f'# Batch Citations {version} 交付与测试记录\n\n'
        f'当前维护源码：`work/zotero-batch-citations`；本地提交：`{commit}`。\n\n'
        f'自动测试 {evidence["unitTests"]} 项通过。两版 Zotero 的原生布局、文献绑定、Word 插入和窗口复用/恢复检查，以及独立 Word 安全、完整性和计划管线均通过。\n\n'
        '具体数量、实际前台授权结果及覆盖限制见 [本版报告](docs/DEVELOPMENT-' + version + '.md)；'
        '逐项证据见 [发布核验记录](docs/test-results/release-proof-' + version + '.json)。\n\n'
        '安装文件：`.xpi` 为 Zotero 插件，`-word.zip` 为配套 Word 加载项，`-bundle.zip` 合并两个安装组件；'
        '`-source.zip` 为发布源码快照，`CHANGELOG.md` 为变更记录，`SHA256SUMS.txt` 用于检查交付文件。两个安装组件需要一并升级。\n', encoding='utf8')
    metadata.update(sourceCommit=commit, tag='v' + version, sourceHashes=source_hashes(project), evidenceSHA256=sha(Path(proof).read_bytes()), builtAt=datetime.now(timezone.utc).isoformat())
    (temporary / 'RELEASE.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    checksums(temporary)
    verify(temporary, project)
    temporary.rename(staged)
    return staged


def verify(staged, project=PROJECT):
    project, staged = Path(project).resolve(), Path(staged).resolve()
    metadata = json.loads((staged / 'RELEASE.json').read_text(encoding='utf8'))
    version = synchronize(project, check=True)
    if metadata['version'] != version or metadata['tag'] != 'v' + version or metadata['sourceCommit'] != git(project, 'rev-parse', 'HEAD'):
        raise ValueError('Staged version/commit does not match the maintained source')
    if metadata['sourceHashes'] != source_hashes(project):
        raise ValueError('Source or test/documentation records changed after staged preparation')
    proof = project / f'docs/test-results/release-proof-{version}.json'
    evidence = verify_evidence(project, proof)
    if metadata['evidenceSHA256'] != sha(proof.read_bytes()) or metadata['addonContentSHA256'] != evidence['addonContentSHA256'] or metadata['assemblySHA256'] != evidence['assemblySHA256']:
        raise ValueError('Staged test identity changed')
    listed = {}
    for row in (staged / 'SHA256SUMS.txt').read_text(encoding='utf8').splitlines():
        digest, name = row.split('  ', 1)
        path = (staged / name).resolve()
        if not path.is_relative_to(staged) or path.is_symlink() or name in listed or sha(path.read_bytes()) != digest:
            raise ValueError('Invalid staged checksum: ' + name)
        listed[name] = digest
    actual = {p.relative_to(staged).as_posix() for p in staged.rglob('*') if p.is_file() and p.name != 'SHA256SUMS.txt'}
    if set(listed) != actual:
        raise ValueError('Staged contains unlisted or missing delivery files')
    prefix = 'zotero-batch-citations-' + version
    required = {prefix + suffix for suffix in ['.xpi', '-word.zip', '-source.zip', '-bundle.zip']} | {'README.md', 'CHANGELOG.md', 'TEST-REPORT.md', 'RELEASE.json', 'LICENSE'}
    if not required.issubset(actual):
        raise ValueError('Missing required delivery files')
    for name in ['README.md', 'CHANGELOG.md', 'LICENSE'] + [p.relative_to(project).as_posix() for folder in ['docs', 'examples'] for p in (project / folder).rglob('*') if p.is_file()]:
        if (staged / name).read_bytes() != (project / name).read_bytes():
            raise ValueError('Delivered documentation differs from the source: ' + name)
    unpacked = staged / 'Word加载项'
    actual_word = {p.relative_to(unpacked).as_posix(): p.read_bytes() for p in unpacked.rglob('*') if p.is_file()}
    if dict(word_files(project)) != actual_word:
        raise ValueError('Unpacked Word add-in differs from the tested Word package')
    for suffix in ['.xpi', '-word.zip', '-source.zip', '-bundle.zip']:
        with zipfile.ZipFile(staged / (prefix + suffix)) as archive:
            names = archive.namelist()
            if archive.testzip() is not None or len(names) != len(set(names)) or any(name.startswith('/') or '..' in Path(name).parts for name in names):
                raise ValueError('Corrupt or unsafe release archive')
            if suffix == '.xpi':
                if json.loads(archive.read('manifest.json'))['version'] != version or content_hash((name, archive.read(name)) for name in names) != evidence['addonContentSHA256']:
                    raise ValueError('XPI differs from the tested addon')
            elif suffix == '-word.zip':
                if sha(archive.read('ZoteroBatchCitations.dll')) != evidence['assemblySHA256']:
                    raise ValueError('Word package differs from the tested assembly')
                if dict(word_files(project)) != {name: archive.read(name) for name in names}:
                    raise ValueError('Word installer or documentation differs from the release source')
            elif suffix == '-source.zip':
                root = prefix + '/'
                archived = {name[len(root):]: sha(archive.read(name)) for name in names if name.startswith(root)}
                if len(archived) != len(names) or archived != metadata['sourceHashes']:
                    raise ValueError('Source archive differs from the release source')
            else:
                expected = dict(common_files(project))
                expected.update((prefix + part, (staged / (prefix + part)).read_bytes()) for part in ['.xpi', '-word.zip'])
                if expected != {name: archive.read(name) for name in names}:
                    raise ValueError('Bundle contains different installation components or documentation')
    return metadata


def write_indexes(outputs, project, version):
    root = outputs.parent
    (outputs / 'README.md').write_text(f'''# 安装包与发布资料

当前正式版本为 **{version}**，唯一维护源码为 `work/zotero-batch-citations`。

- [本版交付报告](当前版本/{version}/TEST-REPORT.md)
- [完整安装包](当前版本/{version}/zotero-batch-citations-{version}-bundle.zip)
- [Zotero XPI](当前版本/{version}/zotero-batch-citations-{version}.xpi)
- [Word 加载项：直接安装](当前版本/{version}/Word加载项/Install.cmd) · [压缩包](当前版本/{version}/zotero-batch-citations-{version}-word.zip)
- [发布源码](当前版本/{version}/zotero-batch-citations-{version}-source.zip)
- [更新日志](当前版本/{version}/CHANGELOG.md) · [校验值](当前版本/{version}/SHA256SUMS.txt)
- [构建与版本交付规范](../work/zotero-batch-citations/docs/RELEASING.md)

`当前版本` 只放通过校验的正式交付；不设候选版本交付目录；`历史版本` 保留旧正式包；`开发资料` 保留历史资料及源码索引。临时构建在源码的 `dist`，测试资料在 `work/test-runs`。

安装时在 Zotero 安装 XPI，保存并关闭 Word 后进入 `Word加载项` 文件夹运行 `Install.cmd`。两端组件一并升级。
''', encoding='utf8')
    history = outputs / '历史版本'
    history.mkdir(exist_ok=True)
    versions = sorted([p.name for p in history.iterdir() if p.is_dir() and re.fullmatch(r'\d+\.\d+\.\d+', p.name)], key=lambda name: tuple(map(int, name.split('.'))), reverse=True)
    (history / 'README.md').write_text(f'# 历史正式版本\n\n当前安装请用 [{version}](../当前版本/{version}/README.md)。旧包保留供回退，历史源码优先按 Git 标签追溯。\n\n' + '\n'.join(f'- [{v}]({v}/)' for v in versions) + '\n', encoding='utf8')
    (outputs / '开发资料' / version).mkdir(parents=True, exist_ok=True)
    (outputs / '开发资料' / version / 'README.md').write_text(f'# {version} 开发资料索引\n\n- [唯一维护源码](../../../work/zotero-batch-citations/README.md)\n- [发布源码快照](../../当前版本/{version}/zotero-batch-citations-{version}-source.zip)\n- [实际测试记录](../../当前版本/{version}/docs/TESTING.md)\n- [发布清单与源码校验值](../../当前版本/{version}/RELEASE.json)\n\n此处是索引，不另复制一套开发源码。\n', encoding='utf8')
    (outputs / '开发资料' / 'README.md').write_text(f'# 开发资料\n\n当前版见 [{version}]({version}/README.md)。旧版压缩快照和测试资料保留。新迭代始终在 [唯一源码目录](../../work/zotero-batch-citations/README.md) 修改。\n', encoding='utf8')
    (root / 'README.md').write_text(f'# Zotero 编号批量引用\n\n当前正式版本 **{version}**。\n\n- [交付与安装入口](outputs/README.md)\n- [本版交付报告](outputs/当前版本/{version}/TEST-REPORT.md)\n- [唯一维护源码](work/zotero-batch-citations/README.md)\n- [版本、构建与交付规范](work/zotero-batch-citations/docs/RELEASING.md)\n- [工作目录](work/README.md)\n\n只交付正式版本；临时构建在源码 dist，旧正式版本和历史测试资料独立保留。历史代码通过本地 Git 提交和版本标签管理，旧安装包及有价值的资料保留。\n', encoding='utf8')


def promote(staged, outputs, project=PROJECT):
    staged, outputs, project = Path(staged).resolve(), Path(outputs).resolve(), Path(project).resolve()
    if staged.parent != project / 'dist/releases' or staged.is_symlink():
        raise ValueError('Publish only a verified internal staging directory in dist/releases')
    clean_commit(project)
    metadata = verify(staged, project)
    version, tag = metadata['version'], metadata['tag']
    target = outputs / '当前版本' / version
    if not target.resolve().is_relative_to(outputs):
        raise ValueError('Formal delivery must stay inside outputs')
    if target.exists() or git(project, 'tag', '--list', tag):
        raise FileExistsError('A formal version/tag already exists')
    old = list((outputs / '当前版本').iterdir()) if (outputs / '当前版本').exists() else []
    moves = [(p, outputs / '历史版本' / p.name) for p in old if p.is_dir() and re.fullmatch(r'\d+\.\d+\.\d+', p.name)]
    for source, destination in moves:
        if source.is_symlink() or not source.resolve().is_relative_to(outputs) or not destination.resolve().is_relative_to(outputs) or destination.exists():
            raise ValueError('Cannot safely preserve previous release: ' + str(source))
    target.parent.mkdir(parents=True, exist_ok=True)
    (outputs / '历史版本').mkdir(exist_ok=True)
    completed = []
    tagged = False
    indexes = [outputs.parent / 'README.md', outputs / 'README.md', outputs / '历史版本/README.md', outputs / '开发资料/README.md', outputs / '开发资料' / version / 'README.md']
    previous_indexes = {path: path.read_bytes() if path.exists() else None for path in indexes}
    try:
        for source, destination in moves + [(staged, target)]:
            source.rename(destination)
            completed.append((source, destination))
        git(project, 'tag', tag, metadata['sourceCommit'])
        tagged = True
        write_indexes(outputs, project, version)
    except Exception:
        if tagged:
            git(project, 'tag', '-d', tag)
        for source, destination in reversed(completed):
            destination.rename(source)
        for path, data in previous_indexes.items():
            if data is None:
                if path.exists():
                    path.unlink()
            else:
                path.write_bytes(data)
        raise
    return target


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'verify', 'promote'])
    parser.add_argument('--staged', type=Path)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    outputs = PROJECT.parent.parent / 'outputs'
    try:
        if args.action == 'prepare':
            result = prepare(PROJECT, outputs, args.evidence or PROJECT / ('docs/test-results/release-proof-' + synchronize(check=True) + '.json'))
        else:
            staged = args.staged or PROJECT / 'dist/releases' / synchronize(check=True)
            result = verify(staged) if args.action == 'verify' else promote(staged, outputs)
        print(json.dumps(result, ensure_ascii=False, indent=2) if isinstance(result, dict) else str(result))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error) + '\n')
