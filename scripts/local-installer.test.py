import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch, Mock
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('local_delivery', Path(__file__).with_name('local-installer.py'))
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / 'home'
        self.desktop = self.home / 'Desktop'
        self.desktop.mkdir(parents=True)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.manifest = self.root / 'candidate.json'
        self.manifest.write_text('{}')
        self.logs = self.home / 'logs'
        self.pin = self.home / '.nvm/versions/node/v24.19.0/bin'
        self.executables(self.pin)
        self.environment = {'PATH': str(self.root / 'missing')}

    def executables(self, directory, version='v24.19.0'):
        directory.mkdir(parents=True, exist_ok=True)
        for name, value in (('node', version), ('npm', '11.17.0')):
            file = directory / name
            file.write_text('#!/bin/sh\nprintf "%s\\n" "' + value + '"\n')
            file.chmod(0o700)

    def test_selects_installed_nvm_pin_when_node_is_missing_from_path(self):
        selected, runtime = delivery.select_runtime(self.environment, self.home)
        self.assertEqual(runtime['node'], 'v24.19.0')
        self.assertEqual(runtime['node_path'], str(self.pin / 'node'))
        self.assertTrue(selected['PATH'].startswith(str(self.pin) + os.pathsep))
        self.assertEqual(self.environment['PATH'], str(self.root / 'missing'))

    def test_ignores_wrong_active_node_and_uses_installed_pin(self):
        wrong = self.root / 'wrong'
        self.executables(wrong, 'v22.0.0')
        _, runtime = delivery.select_runtime({'PATH': str(wrong)}, self.home)
        self.assertEqual(runtime['node_path'], str(self.pin / 'node'))

    def test_accepts_correct_active_node_without_nvm(self):
        active = self.root / 'active'
        self.executables(active)
        _, runtime = delivery.select_runtime({'PATH': str(active)}, self.root / 'no-home')
        self.assertEqual(runtime['node_path'], str(active / 'node'))

    def test_honours_custom_nvm_directory(self):
        custom = self.root / 'custom-nvm'
        self.executables(custom / 'versions/node/v24.19.0/bin')
        _, runtime = delivery.select_runtime({'PATH': '', 'NVM_DIR': str(custom)}, self.home)
        self.assertEqual(runtime['node_path'], str(custom / 'versions/node/v24.19.0/bin/node'))

    def test_missing_pin_stops_without_installing_runtime(self):
        with self.assertRaisesRegex(RuntimeError, 'Install it once with nvm install 24.19.0'):
            delivery.select_runtime({'PATH': ''}, self.root / 'absent')
        self.assertFalse((self.root / 'absent').exists())

    def test_environment_selection_is_restored_after_failure(self):
        before = os.environ.copy()
        with self.assertRaisesRegex(RuntimeError, 'fixture'):
            with delivery.process_environment({'PATH': '/fixture', 'FORCE_COLOR': '1'}):
                self.assertEqual(os.environ['PATH'], '/fixture')
                raise RuntimeError('fixture')
        self.assertEqual(dict(os.environ), before)

    def execute(self, apply):
        output = io.StringIO()
        with patch.dict(os.environ, self.environment, clear=True), patch.object(delivery.guard, 'apply', side_effect=apply), patch.object(delivery, 'select_manifest', return_value=self.manifest), redirect_stdout(output):
            code = delivery.run_local(self.repo, self.manifest, self.logs, self.desktop, self.home)
        receipt_path = next(self.desktop.glob('*.json'))
        return code, output.getvalue(), json.loads(receipt_path.read_text())

    def test_success_requires_user_local_browser_gate_and_exports_desktop_receipt(self):
        def apply(root, manifest, logs, preflight, verify_local):
            self.assertIs(preflight, delivery.check_prerequisites)
            self.assertIs(verify_local, delivery.verify_local)
            self.assertEqual(root, self.repo)
            self.assertEqual(manifest, self.manifest)
            self.assertEqual(os.environ['PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD'], '1')
            self.assertEqual(os.environ['FORCE_COLOR'], '1')
            self.assertEqual(os.environ['NEXT_PUBLIC_BASE_PATH'], '/SoccerBotStudioSG')
            print('fixture individual case passed')
            return {'status': 'full local code and browser verification passed', 'tests_run': True, 'browser_tests_run': True}
        code, output, receipt = self.execute(apply)
        self.assertEqual(code, 0)
        self.assertTrue(receipt['tests_run'])
        self.assertTrue(receipt['browser_tests_run'])
        self.assertFalse(receipt['published'])
        self.assertEqual(receipt['runtime']['npm'], '11.17.0')
        self.assertIn('fixture individual case passed', output)
        self.assertIn('UPLOAD THIS FILE:', output)
        self.assertIn('\033[32mPASS', output)
        self.assertFalse(list(self.desktop.glob('*.zip')))

    def test_failure_exports_diagnostics_without_backups_or_console_traceback(self):
        def apply(root, manifest, logs, preflight, verify_local):
            nested = logs / 'fixture'
            nested.mkdir(parents=True)
            (nested / 'source-before').mkdir()
            (nested / 'source-before/private.json').write_text('{"source":"not an upload"}')
            (nested / 'verify-code.log').write_text('actual failing case and readable stack\n')
            delivery.save_json(nested / 'receipt.json', {'status': 'failed', 'error': 'fixture verification failed', 'commands': []})
            print('actual failing case and readable stack')
            raise RuntimeError('fixture verification failed')
        code, output, receipt = self.execute(apply)
        self.assertEqual(code, 1)
        self.assertEqual(receipt['status'], 'failed')
        self.assertIn('STOPPED', output)
        self.assertNotIn('Traceback (most recent call last)', output)
        self.assertNotIn('Full local code and browser verification passed', output)
        with ZipFile(next(self.desktop.glob('*.zip'))) as archive:
            self.assertIn('failure.log', archive.namelist())
            self.assertIn('apply/fixture/verify-code.log', archive.namelist())
            self.assertFalse(any('source-before' in name for name in archive.namelist()))

    def test_missing_runtime_still_creates_receipt_and_failure_zip(self):
        (self.pin / 'node').unlink()
        with patch.object(delivery.guard, 'apply') as apply, patch.dict(os.environ, self.environment, clear=True), redirect_stdout(io.StringIO()):
            code = delivery.run_local(self.repo, self.manifest, self.logs, self.desktop, self.home)
        self.assertEqual(code, 1)
        apply.assert_not_called()
        receipt = json.loads(next(self.desktop.glob('*.json')).read_text())
        self.assertEqual(receipt['status'], 'failed')
        self.assertTrue(list(self.desktop.glob('*-failure.zip')))

    def test_git_change_after_failed_verification_remains_not_green(self):
        def apply(root, manifest, logs, preflight, verify_local):
            nested = logs / 'fixture'
            nested.mkdir(parents=True)
            delivery.save_json(nested / 'receipt.json', {'status': 'failed', 'revision': {'head': 'expected'}, 'commands': []})
            raise RuntimeError('gate failure')
        with patch.object(delivery.guard, 'state', return_value={'head': 'different'}):
            code, _, receipt = self.execute(apply)
        self.assertEqual(code, 1)
        self.assertFalse(receipt['git_unchanged'])
        self.assertIn('Branch, HEAD or index changed', receipt['git_error'])

    def test_incomplete_result_never_exports_success(self):
        code, output, receipt = self.execute(lambda *args, **kwargs: {'status': 'source applied', 'tests_run': False})
        self.assertEqual(code, 1)
        self.assertEqual(receipt['status'], 'failed')
        self.assertNotIn('Full local code and browser verification passed', output)
        self.assertTrue(list(self.desktop.glob('*-failure.zip')))

    def test_interruption_retains_not_green_receipt(self):
        def interrupted(*args, **kwargs):
            raise KeyboardInterrupt()
        code, output, receipt = self.execute(interrupted)
        self.assertEqual(code, 1)
        self.assertEqual(receipt['error'], 'Interrupted')
        self.assertIn('NOT GREEN', output)
        self.assertTrue(list(self.desktop.glob('*-failure.zip')))

    def test_collects_only_evidence_from_current_non_browser_commands(self):
        source = self.repo / 'test-results'
        source.mkdir()
        delivery.save_json(source / 'verification-code.json', {'commands': [{'command': ['npm', 'run', 'check:source'], 'log': 'test-results/code-source.log'}]})
        for name in ('code-source.log', 'code-unit.log', 'unit.json', 'browser.json', 'browser-engines.json'):
            (source / name).write_text('fixture')
        destination = self.root / 'evidence'
        delivery.guard.collect_code_evidence(self.repo, destination)
        self.assertEqual({file.name for file in destination.iterdir()}, {'verification-code.json', 'code-source.log'})

    def test_selects_only_exact_reviewed_baselines_and_accepts_completed_candidate(self):
        bundle = {'updates': [
            {'baseline': {'owner': 'old'}, 'candidate': {'owner': 'new'}},
            {'baseline': {'owner': 'previous'}, 'candidate': {'owner': 'new'}},
        ]}
        delivery.save_json(self.manifest, bundle)
        for current, expected in [('old', 'old'), ('previous', 'previous'), ('new', 'old')]:
            with patch.object(delivery.guard, 'state', return_value={}), patch.object(delivery.guard, 'inventory', return_value={'owner': current}):
                selected = delivery.select_manifest(self.repo, self.manifest, self.root)
            self.assertEqual(json.loads(selected.read_text())['baseline'], {'owner': expected})
        with patch.object(delivery.guard, 'state', return_value={}), patch.object(delivery.guard, 'inventory', return_value={'owner': 'unknown'}):
            with self.assertRaisesRegex(RuntimeError, 'Unknown source edit'):
                delivery.select_manifest(self.repo, self.manifest, self.root)

    def test_equal_source_variants_select_matching_git_revision_before_apply(self):
        variants = [{'baseline': {'owner': 'old'}, 'candidate': {'owner': 'new'}, 'revision': {'branch': branch, 'head': head}}
                    for branch, head in [('fix/oracle-tooling', 'feature'), ('main', 'merged')]]
        delivery.save_json(self.manifest, {'updates': variants})
        for branch, head in [('fix/oracle-tooling', 'feature'), ('main', 'merged')]:
            for content in ['old', 'new']:
                with patch.object(delivery.guard, 'state', return_value={'branch': branch, 'head': head}), patch.object(delivery.guard, 'inventory', return_value={'owner': content}):
                    selected = delivery.select_manifest(self.repo, self.manifest, self.root)
                self.assertEqual(json.loads(selected.read_text())['revision'], {'branch': branch, 'head': head})
        with patch.object(delivery.guard, 'state', return_value={'branch': 'main', 'head': 'unreviewed'}):
            with self.assertRaisesRegex(RuntimeError, 'Unknown source edit, revision'):
                delivery.select_manifest(self.repo, self.manifest, self.root)

    def dependency_fixture(self):
        package = {'dependencies': {'react': '19.3.0'}, 'devDependencies': {'vitest': '5.0.3'}}
        versions = {**package['dependencies'], **package['devDependencies'], 'playwright': '1.58.2', 'playwright-core': '1.58.2'}
        delivery.save_json(self.repo / 'package.json', package)
        delivery.save_json(self.repo / 'package-lock.json', {'packages': {'node_modules/' + key: {'version': value} for key, value in versions.items()}})
        for key, value in versions.items():
            file = self.repo / 'node_modules' / key / 'package.json'
            file.parent.mkdir(parents=True, exist_ok=True)
            delivery.save_json(file, {'version': value})
        for entry in ('next/dist/bin/next', 'vitest/vitest.mjs', 'typescript/bin/tsc', 'eslint/bin/eslint.js', 'prettier/bin/prettier.cjs', '@playwright/test/cli.js'):
            file = self.repo / 'node_modules' / entry
            file.parent.mkdir(parents=True, exist_ok=True)
            file.touch()

    def test_dependency_drift_stops_before_browser_probe_without_installing(self):
        self.dependency_fixture()
        delivery.save_json(self.repo / 'node_modules/react/package.json', {'version': '0.0.0'})
        with patch.object(delivery.subprocess, 'check_output') as process:
            with self.assertRaisesRegex(RuntimeError, 'differs from the reviewed lockfile'):
                delivery.check_prerequisites(self.repo, self.repo)
            process.assert_not_called()

    def test_missing_browser_stops_preflight_without_downloading(self):
        self.dependency_fixture()
        browsers = [{'name': name, 'path': str(self.root / name)} for name in ('chromium-headless-shell', 'webkit')]
        with patch.object(delivery.subprocess, 'check_output', return_value=json.dumps(browsers)) as process:
            with self.assertRaisesRegex(RuntimeError, 'Missing required browser executable') as caught:
                delivery.check_prerequisites(self.repo, self.repo)
            self.assertEqual(process.call_count, 1)
            self.assertEqual(process.call_args.args[0][:2], ['node', '-e'])
            self.assertNotIn('.launch(', process.call_args.args[0][2])
        self.assertIn('chromium-headless-shell, webkit', str(caught.exception))
        self.assertIn(str(self.repo / 'node_modules/playwright/cli.js'), str(caught.exception))
        self.assertNotIn('npx', str(caught.exception))

    def test_headless_only_installation_passes_without_full_chromium(self):
        self.dependency_fixture()
        browsers = []
        for name in ('chromium-headless-shell', 'webkit'):
            file = self.root / name
            file.touch(); file.chmod(0o700)
            browsers.append({'name': name, 'path': str(file)})
        output = io.StringIO()
        with patch.object(delivery.subprocess, 'check_output', return_value=json.dumps(browsers)) as process, patch.object(delivery.socket, 'socket') as socket, redirect_stdout(output):
            delivery.check_prerequisites(self.repo, self.repo)
            socket.return_value.__enter__.return_value.bind.assert_called_once_with(('127.0.0.1', 4173))
            self.assertNotIn("'chromium',", process.call_args.args[0][2])
        self.assertFalse((self.root / 'chromium').exists())
        self.assertIn('reusing node_modules', output.getvalue())
        self.assertIn('none launched', output.getvalue())
        self.assertIn('port 4173 is available', output.getvalue())
        for item in browsers:
            self.assertIn(item['path'] + ' [found]', output.getvalue())

    def test_full_chromium_cannot_substitute_for_missing_headless_shell(self):
        self.dependency_fixture()
        full = self.root / 'chromium'; full.touch(); full.chmod(0o700)
        webkit = self.root / 'webkit'; webkit.touch(); webkit.chmod(0o700)
        browsers = [{'name': name, 'path': str(self.root / name)} for name in ('chromium-headless-shell', 'webkit')]
        output = io.StringIO()
        with patch.object(delivery.subprocess, 'check_output', return_value=json.dumps(browsers)), redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, r'Missing required browser executable\(s\): chromium-headless-shell at'):
                delivery.check_prerequisites(self.repo, self.repo)
        self.assertIn(str(self.root / 'chromium-headless-shell') + ' [missing]', output.getvalue())
        self.assertIn(str(webkit) + ' [found]', output.getvalue())

    def verification_fixture(self, browser=True, exit_code=0):
        source = self.repo / 'test-results'
        source.mkdir()
        receipt = {'commands': []}
        commands = [{'command': ['npm', 'test'], 'log': 'test-results/all-unit.log'}]
        if browser:
            commands.append({'command': ['npm', 'run', 'test:e2e'], 'log': 'test-results/all-browser.log'})
        def start(command, **kwargs):
            self.assertEqual(command, ['npm', 'run', 'verify'])
            delivery.save_json(source / 'verification-all.json', {'scope': 'all', 'status': 'passed' if exit_code == 0 else 'failed', 'browserExecuted': browser, 'commands': commands, 'basePath': '/SoccerBotStudioSG', 'export': {'basePath': '/SoccerBotStudioSG', 'files': {'index.html': 'synthetic'}}})
            return Mock(stdout=['fixture command output\n'], wait=Mock(return_value=exit_code))
        return receipt, start

    def test_user_verification_calls_combined_gate_once_and_requires_browser_receipt(self):
        receipt, start = self.verification_fixture()
        with patch.object(delivery.subprocess, 'Popen', side_effect=start) as process:
            delivery.verify_local(self.repo, self.root, receipt)
        process.assert_called_once()
        self.assertTrue(receipt['tests_run'])
        self.assertTrue(receipt['browser_tests_run'])

    def test_non_browser_only_receipt_cannot_pass_user_local_scope(self):
        receipt, start = self.verification_fixture(browser=False)
        with patch.object(delivery.subprocess, 'Popen', side_effect=start):
            with self.assertRaisesRegex(RuntimeError, 'code AND browser receipt required'):
                delivery.verify_local(self.repo, self.root, receipt)
        self.assertFalse(receipt.get('tests_run', False))

    def test_browser_failure_preserves_first_exit_and_evidence(self):
        receipt, start = self.verification_fixture(exit_code=1)
        with patch.object(delivery.subprocess, 'Popen', side_effect=start):
            with self.assertRaisesRegex(RuntimeError, 'Local verification failed'):
                delivery.verify_local(self.repo, self.root, receipt)
        self.assertEqual(receipt['commands'][0]['exit'], 1)
        self.assertTrue((self.root / 'verification/verification-all.json').is_file())

    def test_local_evidence_excludes_stale_browser_results_before_browser_step(self):
        source = self.repo / 'test-results'; source.mkdir()
        for name in ('verification-all.json', 'all-source.log', 'all-browser.log', 'browser.json', 'browser-engines.json'):
            (source / name).write_text('fixture')
        destination = self.root / 'evidence'
        delivery.collect_local_evidence(self.repo, destination, {'commands': [{'command': ['npm', 'run', 'check:source'], 'log': 'test-results/all-source.log'}]})
        self.assertEqual({file.name for file in destination.iterdir()}, {'verification-all.json', 'all-source.log'})


if __name__ == '__main__':
    unittest.main()
