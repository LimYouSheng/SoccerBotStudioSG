#!/usr/bin/env python3
"""Standard local delivery: runtime selection, guarded apply, live checks and upload receipts."""
import argparse
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import shlex
import socket
import subprocess
import sys
import tempfile
import traceback
from zipfile import ZipFile, ZIP_DEFLATED

spec = importlib.util.spec_from_file_location('guarded_update', Path(__file__).with_name('guarded-update.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

NODE_VERSION = '24.19.0'
DELIVERY = 'SoccerBotStudioSG_Standard_Local_2026-10-04'


def select_manifest(root, source, run):
    """Accept only exact reviewed prior candidates or the completed target."""
    bundle = json.loads(source.read_text())
    variants = bundle.get('updates', [bundle])
    guard.require(bool(variants), 'Missing reviewed source baselines')
    candidate = variants[0]['candidate']
    guard.require(all(item['candidate'] == candidate for item in variants), 'Conflicting candidate inventories')
    for item in variants:
        generated = item.get('generated', [])
        current = guard.inventory(root, missing=item.get('deletions', []), generated=set(generated) - set(item['baseline']))
        applied = guard.inventory(root, missing=item.get('deletions', []), generated=generated)
        if current == item['baseline'] or applied == candidate:
            target = run / 'selected-manifest.json'
            save_json(target, item)
            return target
    raise RuntimeError('Unknown source edit or partial candidate; no source overwritten. Upload the receipt and failure ZIP.')


def check_prerequisites(root, candidate):
    """Read installed tools and browser paths; never install packages or launch a browser."""
    package = json.loads((candidate / 'package.json').read_text())
    lock = json.loads((candidate / 'package-lock.json').read_text())['packages']
    required = {**package['dependencies'], **package['devDependencies']}
    for name in ('playwright', 'playwright-core'):
        required[name] = lock['node_modules/' + name]['version']
    for name, version in required.items():
        installed = root / 'node_modules' / name / 'package.json'
        guard.require(installed.is_file(), f'Missing installed dependency {name}. Complete dependency setup separately, then rerun; no automatic npm ci.')
        actual = json.loads(installed.read_text()).get('version')
        guard.require(actual == version == lock['node_modules/' + name]['version'], f'Installed {name} differs from the reviewed lockfile ({actual} / {version}); no automatic installation.')
    for entry in ('next/dist/bin/next', 'vitest/vitest.mjs', 'typescript/bin/tsc', 'eslint/bin/eslint.js', 'prettier/bin/prettier.cjs', '@playwright/test/cli.js'):
        guard.require((root / 'node_modules' / entry).is_file(), f'Missing installed tooling entry: {entry}')
    banner('PASS', f'PREFLIGHT — {len(required)} required dependency versions match the reviewed lockfile; reusing node_modules')
    probe = """const path = require('node:path');
const { registry } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/server/registry/index.js'));
console.log(JSON.stringify(['chromium-headless-shell', 'webkit'].map(name => ({name, path: registry.findExecutable(name).executablePath()}))));"""
    output = subprocess.check_output(['node', '-e', probe], cwd=root, text=True, stderr=subprocess.PIPE)
    browsers = json.loads(output)
    guard.require(len(browsers) == 2 and {item['name'] for item in browsers} == {'chromium-headless-shell', 'webkit'}, 'Incomplete browser installation inventory')
    missing = []
    for item in browsers:
        ready = item.get('path') and Path(item['path']).is_file() and os.access(item['path'], os.X_OK)
        print(f'PREFLIGHT — Playwright {required["playwright-core"]} {item["name"]}: {item.get("path") or "unresolved"} [{"found" if ready else "missing"}]', flush=True)
        if not ready:
            missing.append(item['name'])
    if missing:
        setup = shlex.join([shutil.which('node') or 'node', str(root / 'node_modules/playwright/cli.js'), 'install', 'chromium', 'webkit'])
        raise RuntimeError(f'Missing required browser executable(s): {", ".join(missing)} at the paths above.\nSetup for this repository and pinned Playwright:\n  cd {shlex.quote(str(root))}\n  {setup}\nThen rerun this installer. No source changed or browsers downloaded.')
    banner('PASS', 'PREFLIGHT — required Chromium Headless Shell and WebKit found; none launched')
    with socket.socket() as probe_socket:
        try:
            probe_socket.bind(('127.0.0.1', 4173))
        except OSError as error:
            raise RuntimeError('Preview port 4173 is occupied; stop that preview before rerunning. No source changed.') from error
    banner('PASS', 'PREFLIGHT — isolated preview port 4173 is available')


def collect_local_evidence(root, destination, verification):
    source = root / 'test-results'
    destination.mkdir(parents=True, exist_ok=True)
    names = {'verification-all.json'}
    for row in verification.get('commands', []):
        file = Path(row.get('log', ''))
        if file.parent == Path('test-results') and file.name.startswith('all-') and file.suffix == '.log':
            names.add(file.name)
        if row.get('command') == ['npm', 'test']:
            names.add('unit.json')
        if row.get('command') == ['npm', 'run', 'test:e2e']:
            names.update(('browser.json', 'browser-engines.json'))
            artifacts = source / 'browser-artifacts'
            if artifacts.is_dir():
                for artifact in artifacts.rglob('*'):
                    guard.require(not artifact.is_symlink(), 'Symlinked browser evidence refused')
                shutil.copytree(artifacts, destination / 'browser-artifacts', dirs_exist_ok=True)
    for name in names:
        file = source / name
        if file.is_file() and not file.is_symlink():
            shutil.copy2(file, destination / name)


def verify_local(root, run, receipt):
    """User-executed full restoration scope: one fresh build, then the browser matrix."""
    results = root / 'test-results'
    guard.safe_directory(results)
    report = results / 'verification-all.json'
    guard.require(not report.is_symlink(), 'Symlinked verification receipt refused')
    report.unlink(missing_ok=True)
    command = ['npm', 'run', 'verify']
    row = {'command': command, 'exit': None, 'log': str(run / 'verify-all.log')}
    receipt['commands'].append(row)
    banner('RUNNING', 'code health, unit/component tests, ONE fresh test-site build, then desktop/phone/tablet browser tests')
    print('$ ' + ' '.join(command), flush=True)
    with Path(row['log']).open('w') as log:
        process = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in process.stdout:
            print(line, end='', flush=True)
            log.write(line)
        row['exit'] = process.wait()
    verification = json.loads(report.read_text()) if report.is_file() else {}
    receipt['verification'] = verification
    receipt['browser_tests_run'] = any(item.get('command') == ['npm', 'run', 'test:e2e'] for item in verification.get('commands', []))
    collect_local_evidence(root, run / 'verification', verification)
    guard.require(row['exit'] == 0, f'Local verification failed; complete logs retained: {row["log"]}')
    guard.require(verification.get('scope') == 'all' and verification.get('status') == 'passed' and verification.get('browserExecuted') is True and receipt['browser_tests_run'], 'Complete code AND browser receipt required; missing browser execution cannot pass')
    receipt.update(tests_run=True, status='full local code and browser verification passed')


class LiveLog:
    def __init__(self, terminal, log):
        self.terminal, self.log = terminal, log

    def write(self, text):
        self.log.write(text)
        self.log.flush()
        self.terminal.write(text)
        self.terminal.flush()
        return len(text)

    def flush(self):
        self.log.flush()
        self.terminal.flush()


def banner(kind, text):
    colour = {'RUNNING': 36, 'PASS': 32, 'STOPPED': 31, 'PENDING': 33}[kind]
    print(f'\033[{colour}m{kind} — {text}\033[0m', flush=True)


def select_runtime(environment, home):
    """Use an installed exact pin without sourcing shell profiles or changing defaults."""
    active = shutil.which('node', path=environment.get('PATH', ''))
    roots = [Path(environment['NVM_DIR']).expanduser()] if environment.get('NVM_DIR') else []
    roots.append(home / '.nvm')
    candidates = ([Path(active)] if active else []) + [root / 'versions' / 'node' / f'v{NODE_VERSION}' / 'bin' / 'node' for root in roots]
    observations = []
    for node in dict.fromkeys(candidates):
        if not node.is_file() or not os.access(node, os.X_OK):
            continue
        try:
            version = subprocess.check_output([str(node), '--version'], text=True, env=environment, stderr=subprocess.STDOUT).strip()
        except (OSError, subprocess.CalledProcessError) as error:
            observations.append(f'{node}: {error}')
            continue
        if version != f'v{NODE_VERSION}':
            observations.append(f'{node}: {version}')
            continue
        npm = node.parent / 'npm'
        if not npm.is_file() or not os.access(npm, os.X_OK):
            observations.append(f'{node}: matching npm executable missing')
            continue
        selected = {**environment, 'PATH': str(node.parent) + os.pathsep + environment.get('PATH', '')}
        npm_version = subprocess.check_output([str(npm), '--version'], text=True, env=selected, stderr=subprocess.PIPE).strip()
        return selected, {'node': version, 'node_path': str(node), 'npm': npm_version, 'npm_path': str(npm)}
    details = '; '.join(observations) or 'no installed Node executable found'
    raise RuntimeError(f'Installed Node {NODE_VERSION} with npm is required ({details}). Install it once with nvm install {NODE_VERSION}, then rerun this same script. No source changed.')


@contextmanager
def process_environment(environment):
    previous = os.environ.copy()
    os.environ.clear()
    os.environ.update(environment)
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(previous)


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def archive_failure(run, destination):
    """Include diagnostics, never source backups, payloads, dependencies or environment files."""
    with ZipFile(destination, 'x', ZIP_DEFLATED) as archive:
        for file in sorted(run.rglob('*')):
            relative = file.relative_to(run)
            if any(part in {'source-before', 'operator', 'node_modules'} for part in relative.parts) or file.name == 'selected-manifest.json':
                continue
            diagnostic = file.suffix in {'.json', '.log'} or ('browser-artifacts' in relative.parts and file.suffix in {'.png', '.zip', '.webm'})
            if file.is_file() and not file.is_symlink() and diagnostic:
                archive.write(file, relative.as_posix())


def run_local(root, manifest, logs, desktop, home):
    root, logs = root.absolute(), logs.absolute()
    guard.safe_directory(logs)
    guard.require(not logs.resolve().is_relative_to(root.resolve()), 'Logs must be outside the repository')
    logs.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix=DELIVERY + '.', dir=logs)).resolve()
    receipt = {'delivery': DELIVERY, 'scope': 'full restoration local code and browser verification', 'status': 'running',
               'started': datetime.now(timezone.utc).isoformat(), 'repository': str(root),
               'browser_tests_run': False, 'published': False, 'ci_accepted': False,
               'dependency_action': 'reuse installed pinned dependencies; no installation', 'runtime': None,
               'source_backup': None, 'commands': []}
    with (run / 'local-check.log').open('w') as log:
        live = LiveLog(sys.stdout, log)
        with redirect_stdout(live), redirect_stderr(live):
            print('SoccerBotStudioSG — Standard local installer')
            print(f'Logs, source backup and receipt: {run}')
            print('Scope: complete restoration checks — code health, tooling/installer tests, formatting, lint, types, 33 unit/component cases and 30 browser cases (desktop / phone / tablet).')
            print('One fresh Next.js build supplies the browser test site. This local check does not publish it.')
            print('Reuse installed pinned dependencies and browsers. No npm ci, dependency/browser downloads, commit, push, PR or deployment. Branch and index stay unchanged.')
            try:
                banner('RUNNING', 'PREFLIGHT — runtime, exact source/Git baseline, installed tools/browsers and preview port')
                environment = os.environ.copy()
                for name in ('NO_COLOR', 'NODE_DISABLE_COLORS', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT'):
                    environment.pop(name, None)
                environment.update(FORCE_COLOR='1', CI='1', PYTHONUNBUFFERED='1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1')
                environment, runtime = select_runtime(environment, home)
                receipt['runtime'] = runtime
                banner('PASS', f'PREFLIGHT — installed Node {runtime["node"]} selected automatically; npm {runtime["npm"]}')
                save_json(run / 'receipt.json', receipt)
                guard.safe_directory(root)
                root = root.resolve()
                with process_environment(environment):
                    selected = select_manifest(root, manifest, run)
                    result = guard.apply(root, selected, run / 'apply', preflight=check_prerequisites, verify_local=verify_local)
                guard.require(result.get('tests_run') and result.get('browser_tests_run'), 'Incomplete code/browser execution cannot be marked passed')
                receipt.update(result)
            except (Exception, KeyboardInterrupt) as error:
                receipt.update(status='failed', error=str(error) or 'Interrupted')
                (run / 'failure.log').write_text(traceback.format_exc())
                banner('STOPPED', receipt['error'])
            finally:
                nested = list((run / 'apply').glob('*/receipt.json'))
                if len(nested) == 1:
                    application = json.loads(nested[0].read_text())
                    # Keep outer errors (for example an unexpected runner failure).
                    error = receipt.get('error')
                    receipt.update(application)
                    if error:
                        receipt.update(status='failed', error=error)
                    backup = nested[0].parent / 'source-before'
                    receipt['source_backup'] = str(backup) if backup.is_dir() else None
                    if application.get('revision'):
                        try:
                            guard.require(guard.state(root) == application['revision'], 'Branch, HEAD or index changed during local verification')
                            receipt['git_unchanged'] = True
                        except Exception as error:
                            receipt.update(status='failed', git_unchanged=False, git_error=str(error))
                            banner('STOPPED', str(error))
                receipt['finished'] = datetime.now(timezone.utc).isoformat()
                save_json(run / 'receipt.json', receipt)
                destination = desktop if desktop.is_dir() and not desktop.is_symlink() else run
                upload = destination / (run.name + '.json')
                with upload.open('x') as handle:
                    handle.write(json.dumps(receipt, indent=2) + '\n')
                print(f'\nUPLOAD THIS FILE: {upload}')
                if receipt['status'] == 'failed':
                    archive = destination / (run.name + '-failure.zip')
                    archive_failure(run, archive)
                    print(f'UPLOAD FAILURE DETAILS: {archive}')
                print(f'Complete logs and source backup: {run}')
            if receipt['status'] == 'failed':
                banner('STOPPED', 'NOT GREEN — local verification stopped. Keep the receipt and failure ZIP.')
                return 1
            banner('PASS', 'Full local code and browser verification passed. Git state preserved.')
            banner('PENDING', 'Physical comparison, dependency-advisory review and CI acceptance.')
            print('Before committing: git rm --cached --ignore-unmatch next-env.d.ts')
            return 0


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=Path)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    home = Path.home()
    logs = home / ('Library/Logs/SoccerBotStudioSG' if sys.platform == 'darwin' else '.local/state/SoccerBotStudioSG')
    try:
        return run_local(args.repository, args.manifest, logs, home / 'Desktop', home)
    except Exception as error:
        banner('STOPPED', str(error))
        return 1


if __name__ == '__main__':
    sys.exit(main())
