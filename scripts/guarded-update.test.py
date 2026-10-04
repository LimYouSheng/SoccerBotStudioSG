import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('guarded-update.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.candidate = self.root / 'candidate'
        self.candidate.mkdir()
        self.manifest = self.root / 'update.json'
        (self.repo / 'owner.txt').write_text('baseline\n')
        subprocess.run(['git', 'init', '-b', 'main', str(self.repo)], check=True, capture_output=True)
        for args in [('config', 'user.name', 'Fixture'), ('config', 'user.email', 'fixture@example.com'), ('add', '.'), ('commit', '-m', 'Fixture')]:
            subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True)
        (self.candidate / 'owner.txt').write_text('candidate\n')
        guard.make_manifest(self.repo, self.candidate, self.manifest)

    def test_applies_canonical_owner_and_preserves_revision(self):
        before = guard.state(self.repo)
        guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'candidate\n')
        self.assertEqual(guard.state(self.repo), before)
        backup = next((self.root / 'logs').glob('*/source-before/owner.txt'))
        self.assertEqual(backup.read_text(), 'baseline\n')
        receipt = json.loads(next((self.root / 'logs').glob('*/receipt.json')).read_text())
        self.assertFalse(receipt['tests_run'])

    def test_unknown_edit_is_not_overwritten(self):
        (self.repo / 'owner.txt').write_text('unknown edit\n')
        with self.assertRaisesRegex(RuntimeError, 'Unknown source'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'unknown edit\n')

    def test_unexpected_file_stops_before_write(self):
        (self.repo / 'unrelated.txt').write_text('keep me')
        with self.assertRaises(RuntimeError):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

    def test_staged_edit_is_preserved(self):
        (self.repo / 'owner.txt').write_text('staged edit')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'owner.txt'], check=True)
        with self.assertRaisesRegex(RuntimeError, 'Staged changes'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'staged edit')

    def test_corrupt_payload_is_rejected_before_write(self):
        manifest = json.loads(self.manifest.read_text())
        manifest['replacements']['owner.txt'] = 'YmFk'
        self.manifest.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

    def test_symlinks_and_path_traversal_are_rejected(self):
        (self.repo / 'link').symlink_to(self.candidate)
        for path in ('../outside', '/tmp/outside', 'link/owner.txt', '.git/config'):
            with self.assertRaises(RuntimeError):
                guard.checked_path(self.repo, path)


if __name__ == '__main__':
    unittest.main()
