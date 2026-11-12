"""Exercise release gates and publication rollback using disposable repositories."""
import importlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

source = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(source / 'scripts'))
release = importlib.import_module('release')
build = importlib.import_module('build')
version = importlib.import_module('version')


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='zbc-release-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'work/zotero-batch-citations'
        self.project.mkdir(parents=True)
        self.outputs = self.root / 'outputs'
        for folder in ['addon', 'word-addin']:
            shutil.copytree(source / folder, self.project / folder, ignore=shutil.ignore_patterns('bin'))
        for name in ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'LICENSE']:
            shutil.copy2(source / name, self.project / name)
        (self.project / '.gitignore').write_text('dist/'+chr(10)+'word-addin/bin/\n__pycache__/\n', encoding='utf8')
        (self.project / 'examples').mkdir()
        shutil.copy2(source / 'examples/citation-literature-example.csv', self.project / 'examples/citation-literature-example.csv')
        evidence = self.project / 'docs/test-results'
        evidence.mkdir(parents=True)
        self.current = version.synchronize(self.project, check=True)
        binary = self.project / 'word-addin/bin'
        binary.mkdir()
        assembly = b'Synthetic binary for release-management tests only'
        (binary / 'ZoteroBatchCitations.dll').write_bytes(assembly)
        sources = [*list((self.project / 'word-addin').glob('*.cs')), self.project / 'word-addin/build.ps1', *list((self.project / 'word-addin/icons').glob('*-ribbon.png'))]
        (binary / 'build-info.json').write_text(json.dumps({'version': self.current + '.0', 'assemblySHA256': build.sha(assembly), 'sources': {p.relative_to(self.project / 'word-addin').as_posix(): build.sha(p.read_bytes()) for p in sources}}), encoding='utf8')
        self.proof = evidence / f'release-proof-{self.current}.json'
        data = {'ok': True, 'version': self.current, 'addonContentSHA256': build.content_hash((p.relative_to(self.project / 'addon').as_posix(), p.read_bytes()) for p in (self.project / 'addon').rglob('*') if p.is_file()), 'assemblySHA256': build.verify_assembly(self.project)['assemblySHA256'], 'unitTests': 1, 'hosts': [{'zoteroVersion': value, 'hostChecks': 1, 'iterationChecks': 1, 'activationChecks': 1, 'restored': True} for value in ['7.0.32', '10.0.7']], 'independent': dict(safety=1, integrity=1, pipeline=1), 'evidenceFiles': {}}
        names = [f'zotero-{v}-{kind}-{self.current}.json' for v in ['7.0.32', '10.0.7'] for kind in ['host', 'iteration', 'activation', 'restoration', 'activation-restoration']]
        names += [f'word-{kind}-{self.current}.json' for kind in ['safety', 'integrity', 'pipeline']]
        for name in names:
            (evidence / name).write_text('{"ok":true}', encoding='utf8')
        (evidence / f'unit-tests-{self.current}.tap').write_text('# tests 1\n# fail 0\n', encoding='utf8')
        for path in evidence.iterdir():
            data['evidenceFiles'][path.relative_to(self.project).as_posix()] = build.sha(path.read_bytes())
        self.proof.write_text(json.dumps(data), encoding='utf8')
        initialized = subprocess.run(['git', 'init', '-q'], cwd=self.project, capture_output=True)
        if initialized.returncode:
            raise RuntimeError(initialized.stderr.decode('utf8', errors='replace'))
        subprocess.run(['git', 'add', '--all'], cwd=self.project, check=True, capture_output=True)
        subprocess.run(['git', '-c', 'user.name=Release test', '-c', 'user.email=release-test@localhost', 'commit', '-q', '-m', 'test fixture'], cwd=self.project, check=True, capture_output=True)

    def staged(self):
        return release.prepare(self.project, self.outputs, self.proof)

    def test_version_drift_is_rejected_and_one_command_resynchronizes(self):
        path = self.project / 'addon/manifest.json'
        data = json.loads(path.read_text(encoding='utf8'))
        data['version'] = '9.9.9'
        path.write_text(json.dumps(data), encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'Version mismatch'):
            version.synchronize(self.project, check=True)
        major, minor, patch = map(int, self.current.split('.'))
        next_version = f'{major}.{minor}.{patch + 1}'
        version.synchronize(self.project, next_version)
        self.assertEqual(version.synchronize(self.project, check=True), next_version)
        self.assertNotIn(self.current, (self.project / 'README.md').read_text(encoding='utf8'))

    def test_modified_word_source_invalidates_old_dll(self):
        path = self.project / 'word-addin/Connect.cs'
        path.write_bytes(path.read_bytes() + b'\n// different build\n')
        with self.assertRaisesRegex(ValueError, 'sources changed'):
            build.verify_assembly(self.project)

    def test_missing_or_changed_test_evidence_blocks_release(self):
        data = json.loads(self.proof.read_text(encoding='utf8'))
        name = next(iter(data['evidenceFiles']))
        (self.project / name).write_text('modified test result', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'changed evidence'):
            release.verify_evidence(self.project, self.proof)

    def test_source_edits_after_packaging_are_rejected(self):
        staged = self.staged()
        path = self.project / 'README.md'
        path.write_bytes(path.read_bytes() + b'\nchanged after packaging\n')
        with self.assertRaisesRegex(ValueError, 'changed after staged'):
            release.verify(staged, self.project)

    def test_tampered_xpi_is_rejected_even_with_recomputed_checksums(self):
        staged = self.staged()
        path = staged / f'zotero-batch-citations-{self.current}.xpi'
        with zipfile.ZipFile(path) as archive:
            files = [(name, archive.read(name)) for name in archive.namelist()]
        build.archive(path, [(name, data + b'\n// tampered' if name == 'bootstrap.js' else data) for name, data in files])
        build.checksums(staged)
        with self.assertRaisesRegex(ValueError, 'XPI differs'):
            release.verify(staged, self.project)

    def test_tampered_word_installer_is_rejected_even_with_recomputed_checksums(self):
        staged = self.staged()
        path = staged / f'zotero-batch-citations-{self.current}-word.zip'
        with zipfile.ZipFile(path) as archive:
            files = [(name, archive.read(name)) for name in archive.namelist()]
        build.archive(path, [(name, data + b'\n# wrong installer' if name == 'install.ps1' else data) for name, data in files])
        build.checksums(staged)
        with self.assertRaisesRegex(ValueError, 'Word installer'):
            release.verify(staged, self.project)

    def test_old_formal_version_is_preserved_and_new_version_is_tagged(self):
        staged = self.staged()
        previous = self.outputs / '当前版本/1.1.5'
        previous.mkdir(parents=True)
        (previous / 'historical.xpi').write_bytes(b'valuable old installation')
        target = release.promote(staged, self.outputs, self.project)
        self.assertTrue(target.exists())
        self.assertFalse((self.outputs / '候选版本').exists())
        self.assertEqual((target / 'Word加载项/ZoteroBatchCitations.dll').read_bytes(), (self.project / 'word-addin/bin/ZoteroBatchCitations.dll').read_bytes())
        self.assertTrue((target / 'Word加载项/Install.cmd').is_file())
        self.assertFalse(staged.exists())
        self.assertEqual((self.outputs / '历史版本/1.1.5/historical.xpi').read_bytes(), b'valuable old installation')
        self.assertEqual(release.git(self.project, 'rev-parse', 'v' + self.current), release.git(self.project, 'rev-parse', 'HEAD'))

    def test_publication_failure_restores_packages_indexes_and_tag(self):
        staged = self.staged()
        previous = self.outputs / '当前版本/1.1.5'
        previous.mkdir(parents=True)
        (previous / 'old.xpi').write_bytes(b'preserve me')
        readme = self.root / 'README.md'
        readme.write_text('original entry', encoding='utf8')
        def fail(*args):
            readme.write_text('partial index write', encoding='utf8')
            raise OSError('injected publication failure')
        with patch.object(release, 'write_indexes', fail):
            with self.assertRaisesRegex(OSError, 'injected'):
                release.promote(staged, self.outputs, self.project)
        self.assertEqual(readme.read_text(encoding='utf8'), 'original entry')
        self.assertTrue(staged.exists())
        self.assertEqual((previous / 'old.xpi').read_bytes(), b'preserve me')
        self.assertEqual(release.git(self.project, 'tag', '--list', 'v' + self.current), '')

    def test_build_cannot_write_directly_to_formal_directory(self):
        with self.assertRaisesRegex(ValueError, 'use release.py promote'):
            build.build(self.outputs / '当前版本' / self.current, project=self.project)

    def test_build_cannot_create_candidate_deliverables(self):
        with self.assertRaisesRegex(ValueError, 'ignored dist staging'):
            build.build(self.outputs / '候选版本' / self.current, project=self.project)

    def test_unpacked_word_files_cannot_drift_even_with_recomputed_checksums(self):
        staged = self.staged()
        (staged / 'Word加载项/Install.cmd').write_bytes(b'wrong installer')
        build.checksums(staged)
        with self.assertRaisesRegex(ValueError, 'Unpacked Word add-in differs'):
            release.verify(staged, self.project)


if __name__ == '__main__':
    unittest.main()
