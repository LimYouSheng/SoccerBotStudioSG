import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('guarded-update.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def test_local_preflight_failure_preserves_source_and_never_runs_verification(self):
        before = guard.state(self.repo)
        def stop(root, staged):
            self.assertTrue(guard.lock_path(root).is_dir())
            self.assertEqual((root / 'owner.txt').read_text(), 'baseline\n')
            self.assertEqual((staged / 'owner.txt').read_text(), 'candidate\n')
            raise RuntimeError('Missing browser fixture')
        verify = unittest.mock.Mock()
        with patch.object(guard, 'atomic_write') as write:
            with self.assertRaisesRegex(RuntimeError, 'Missing browser fixture'):
                guard.apply(self.repo, self.manifest, self.root / 'logs', preflight=stop, verify_local=verify)
            write.assert_not_called()
        verify.assert_not_called()
        self.assertEqual(guard.state(self.repo), before)
        self.assertFalse(guard.lock_path(self.repo).exists())

    def test_local_callbacks_hold_lock_and_rerun_without_source_writes(self):
        calls = []
        def preflight(root, staged):
            self.assertTrue(guard.lock_path(root).is_dir())
            calls.append('preflight')
        def verify(root, run, receipt):
            self.assertTrue(guard.lock_path(root).is_dir())
            self.assertEqual((root / 'owner.txt').read_text(), 'candidate\n')
            calls.append('verification fixture; no browsers launched')
        before = guard.state(self.repo)
        guard.apply(self.repo, self.manifest, self.root / 'logs', preflight=preflight, verify_local=verify)
        stamp = (self.repo / 'owner.txt').stat().st_mtime_ns
        with patch.object(guard, 'atomic_write') as write:
            guard.apply(self.repo, self.manifest, self.root / 'logs', preflight=preflight, verify_local=verify)
            write.assert_not_called()
        self.assertEqual((self.repo / 'owner.txt').stat().st_mtime_ns, stamp)
        self.assertEqual(guard.state(self.repo), before)
        self.assertEqual(calls, ['preflight', 'verification fixture; no browsers launched'] * 2)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve(strict=True)
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

    def test_system_temp_alias_allows_apply_and_no_write_rerun(self):
        actual = self.root / 'private' / 'var' / 'folders' / 'T'
        actual.mkdir(parents=True)
        (self.root / 'var').symlink_to(self.root / 'private' / 'var', target_is_directory=True)
        alias = self.root / 'var' / 'folders' / 'T'
        before = guard.state(self.repo)
        with patch.object(tempfile, 'tempdir', str(alias)):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
            modified = (self.repo / 'owner.txt').stat().st_mtime_ns
            receipt = guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'candidate\n')
        self.assertEqual((self.repo / 'owner.txt').stat().st_mtime_ns, modified)
        self.assertEqual(guard.state(self.repo), before)
        self.assertEqual(receipt['status'], 'already applied; no source writes')
        self.assertFalse(list(actual.iterdir()))

    def test_system_temp_alias_does_not_bypass_candidate_health(self):
        actual = self.root / 'temp-real'
        actual.mkdir()
        alias = self.root / 'temp-alias'
        alias.symlink_to(actual, target_is_directory=True)
        data = json.loads(self.manifest.read_text())
        payload = b'<<<<<<< conflict\n'
        data['candidate']['src/broken.ts'] = guard.digest(payload)
        data['replacements']['src/broken.ts'] = guard.base64.b64encode(payload).decode()
        self.manifest.write_text(json.dumps(data))
        with patch.object(tempfile, 'tempdir', str(alias)):
            with self.assertRaisesRegex(RuntimeError, 'Conflict marker'):
                guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')
        self.assertFalse((self.repo / 'src/broken.ts').exists())
        self.assertFalse(list(actual.iterdir()))

    def test_symlinked_repository_is_still_refused(self):
        alias = self.root / 'repo-alias'
        alias.symlink_to(self.repo, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Symlinked directory'):
            guard.apply(alias, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

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

    def test_completed_candidate_rerun_writes_no_source(self):
        guard.apply(self.repo, self.manifest, self.root / 'logs')
        before = (self.repo / 'owner.txt').stat().st_mtime_ns
        receipt = guard.apply(self.repo, self.manifest, self.root / 'different-logs')
        self.assertEqual((self.repo / 'owner.txt').stat().st_mtime_ns, before)
        self.assertEqual(receipt['status'], 'already applied; no source writes')

    def tracked_generated_file(self):
        target = self.repo / 'next-env.d.ts'
        target.write_text('original tracked declaration\n')
        for args in [('add', 'next-env.d.ts'), ('commit', '-m', 'Tracked generated fixture')]:
            subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True)
        data = json.loads(self.manifest.read_text())
        data['revision'] = guard.state(self.repo)
        data['generated'] = ['next-env.d.ts']
        self.manifest.write_text(json.dumps(data))
        return target

    def test_incremental_update_accepts_removed_generated_file(self):
        target = self.tracked_generated_file()
        target.unlink()
        before = guard.state(self.repo)
        guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertFalse(target.exists())
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'candidate\n')
        self.assertEqual(guard.state(self.repo), before)

    def test_incremental_update_preserves_regenerated_file(self):
        target = self.tracked_generated_file()
        target.write_text('regenerated declaration\n')
        before = guard.state(self.repo)
        guard.apply(self.repo, self.manifest, self.root / 'logs')
        modified = target.stat().st_mtime_ns
        guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual(target.read_text(), 'regenerated declaration\n')
        self.assertEqual(target.stat().st_mtime_ns, modified)
        self.assertEqual(guard.state(self.repo), before)

    def test_generated_file_in_declared_baseline_still_requires_hash(self):
        target = self.tracked_generated_file()
        data = json.loads(self.manifest.read_text())
        data['baseline']['next-env.d.ts'] = guard.digest(target.read_bytes())
        data['deletions'] = ['next-env.d.ts']
        self.manifest.write_text(json.dumps(data))
        target.write_text('unknown declaration edit\n')
        with self.assertRaisesRegex(RuntimeError, 'Unknown source'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual(target.read_text(), 'unknown declaration edit\n')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

    def test_one_lock_covers_different_log_roots(self):
        lock = guard.lock_path(self.repo)
        lock.mkdir()
        self.addCleanup(lock.rmdir)
        for logs in ('one', 'two'):
            with self.assertRaisesRegex(RuntimeError, 'repository lock'):
                guard.apply(self.repo, self.manifest, self.root / logs)
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

    def test_wrong_branch_stops_before_write(self):
        subprocess.run(['git', '-C', str(self.repo), 'switch', '-c', 'other'], check=True, capture_output=True)
        with self.assertRaisesRegex(RuntimeError, 'Branch, HEAD'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

    def test_wrong_head_stops_before_write(self):
        subprocess.run(['git', '-C', str(self.repo), 'commit', '--allow-empty', '-m', 'Other'], check=True, capture_output=True)
        with self.assertRaisesRegex(RuntimeError, 'Branch, HEAD'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')

    def test_case_collision_checks_parent_directories(self):
        with self.assertRaisesRegex(RuntimeError, 'Case collision'):
            guard.portable(['Docs/a.md', 'docs/b.md'])

    def test_declared_deletion_is_backed_up_and_rerunnable(self):
        data = json.loads(self.manifest.read_text())
        data['candidate'] = {}
        data['replacements'] = {}
        data['deletions'] = ['owner.txt']
        self.manifest.write_text(json.dumps(data))
        guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertFalse((self.repo / 'owner.txt').exists())
        self.assertEqual(next((self.root / 'logs').glob('*/source-before/owner.txt')).read_text(), 'baseline\n')
        guard.apply(self.repo, self.manifest, self.root / 'logs')

    def test_unlisted_deletion_is_refused(self):
        data = json.loads(self.manifest.read_text())
        data['candidate'] = {}
        data['replacements'] = {}
        self.manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(RuntimeError, 'deletion inventory'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')

    def test_ignored_existing_new_target_is_preserved(self):
        # Simulate an ignored local file which would collide with a new payload path.
        target = self.repo / 'new.txt'
        target.write_text('local content')
        (self.repo / '.git/info/exclude').write_text('new.txt\n')
        data = json.loads(self.manifest.read_text())
        payload = b'new payload'
        data['candidate']['new.txt'] = guard.digest(payload)
        data['replacements']['new.txt'] = guard.base64.b64encode(payload).decode()
        self.manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(RuntimeError, 'existing target'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual(target.read_text(), 'local content')

    def test_mid_write_failure_keeps_full_backup_and_failure_receipt(self):
        with patch.object(guard, 'atomic_write', side_effect=OSError('disk failure')):
            with self.assertRaisesRegex(OSError, 'disk failure'):
                guard.apply(self.repo, self.manifest, self.root / 'logs')
        receipt = json.loads(next((self.root / 'logs').glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual(next((self.root / 'logs').glob('*/source-before/owner.txt')).read_text(), 'baseline\n')

    def test_source_health_failure_stops_before_any_write(self):
        data = json.loads(self.manifest.read_text())
        payload = b'<<<<<<< conflict\n'
        data['candidate']['src/broken.ts'] = guard.digest(payload)
        data['replacements']['src/broken.ts'] = guard.base64.b64encode(payload).decode()
        self.manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(RuntimeError, 'Conflict marker'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')
        self.assertFalse((self.repo / 'src/broken.ts').exists())

    def test_partial_apply_retains_backup_and_refuses_automatic_rerun(self):
        data = json.loads(self.manifest.read_text())
        data['candidate']['second.txt'] = guard.digest(b'second candidate\n')
        data['replacements']['second.txt'] = guard.base64.b64encode(b'second candidate\n').decode()
        self.manifest.write_text(json.dumps(data))
        write = guard.atomic_write
        def fail_second(target, payload):
            if target.name == 'second.txt':
                raise OSError('fixture interrupted second write')
            write(target, payload)
        before = guard.state(self.repo)
        with patch.object(guard, 'atomic_write', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'interrupted second write'):
                guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'candidate\n')
        modified = (self.repo / 'owner.txt').stat().st_mtime_ns
        self.assertFalse((self.repo / 'second.txt').exists())
        self.assertFalse(guard.lock_path(self.repo).exists())
        receipt = json.loads(next((self.root / 'logs').glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['source_application'], 'in_progress')
        self.assertEqual(next((self.root / 'logs').glob('*/source-before/owner.txt')).read_text(), 'baseline\n')
        with self.assertRaisesRegex(RuntimeError, 'Unknown source'):
            guard.apply(self.repo, self.manifest, self.root / 'rerun-logs')
        self.assertEqual((self.repo / 'owner.txt').stat().st_mtime_ns, modified)
        self.assertEqual(guard.state(self.repo), before)

    def test_invalid_later_payload_never_causes_partial_apply(self):
        data = json.loads(self.manifest.read_text())
        data['candidate']['second.txt'] = guard.digest(b'correct')
        data['replacements']['second.txt'] = guard.base64.b64encode(b'wrong').decode()
        self.manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
            guard.apply(self.repo, self.manifest, self.root / 'logs')
        self.assertEqual((self.repo / 'owner.txt').read_text(), 'baseline\n')

    def test_symlinked_logs_are_refused(self):
        (self.root / 'logs-link').symlink_to(self.candidate)
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            guard.apply(self.repo, self.manifest, self.root / 'logs-link')


if __name__ == '__main__':
    unittest.main()
