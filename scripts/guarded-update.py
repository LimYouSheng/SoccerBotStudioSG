#!/usr/bin/env python3
"""Guarded source apply; optional explicit non-browser verification. No Git writes or cloud operations."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import unicodedata


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, check=True)
    return result.stdout.strip()


def safe_directory(path):
    require(not any(p.is_symlink() for p in [path, *path.parents]), f'Symlinked directory refused: {path}')


def checked_path(root, name):
    path = PurePosixPath(name)
    require(name and '\\' not in name and not path.is_absolute() and '..' not in path.parts and '.git' not in path.parts and str(path) == name, 'Unsafe manifest path')
    require(not any(re.search(r'[\x00-\x1f<>:"|?*]', part) or part.endswith(('.', ' ')) for part in path.parts), 'Nonportable manifest path')
    target = root / name
    safe_directory(target)
    require(target.resolve().is_relative_to(root), f'Escaping path: {name}')
    return target


def portable(names):
    seen = {}
    for name in names:
        for parent in [PurePosixPath(name), *PurePosixPath(name).parents]:
            text = str(parent)
            key = unicodedata.normalize("NFC", text).casefold()
            require(key not in seen or seen[key] == text, f'Case collision: {text}')
            seen[key] = text


def inventory(root, missing=(), generated=()):
    names = git(root, 'ls-files', '-c', '-o', '--exclude-standard', '-z').split('\0')
    portable(filter(None, names))
    result = {}
    for name in sorted(set(filter(None, names))):
        target = checked_path(root, name)
        if name in generated or (name in missing and not target.exists()):
            continue
        require(target.is_file(), f'Missing tracked file: {name}')
        result[name] = digest(target.read_bytes())
    return result


def state(root):
    require(git(root, 'rev-parse', '--show-toplevel') == str(root), 'Use the exact repository root')
    require(not git(root, 'diff', '--cached', '--name-only'), 'Staged changes must be preserved and reviewed first')
    branch = git(root, 'branch', '--show-current')
    require(branch, 'Detached HEAD refused')
    index = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'index'))
    return {'branch': branch, 'head': git(root, 'rev-parse', 'HEAD'), 'index': digest(index.read_bytes()) if index.exists() else None}


def lock_path(root):
    return Path(tempfile.gettempdir()) / f'soccerbot-{os.getuid()}-{digest(str(root).encode())[:24]}.lock'


def portable_health(root, candidate):
    """Dependency-free preflight; semantic/CSS/type gates remain mandatory in verify-code."""
    portable(candidate)
    for name in candidate:
        file = checked_path(root, name)
        if file.suffix in {'.ts', '.tsx', '.mjs', '.css', '.py', '.json', '.yml', '.md', '.sh'}:
            text = file.read_text()
            require(not re.search(r'^(<{7}|={7}|>{7})', text, re.M), f'Conflict marker: {name}')
            require(not re.search(r' +$', text, re.M), f'Trailing whitespace: {name}')
            if name.startswith('src/'):
                require(not re.search(r'dangerouslySetInnerHTML|\.innerHTML\s*=|eslint-disable|@ts-(ignore|nocheck)', text), f'Forbidden source escape: {name}')
                require(not re.search(r'(backup|patched|override|\.bak|\.orig)', name, re.I), f'Noncanonical source: {name}')
            if file.suffix == '.json':
                json.loads(text)
    if 'package.json' in candidate:
        pkg = json.loads((root / 'package.json').read_text())
        lock = json.loads((root / 'package-lock.json').read_text())
        for key in ('name', 'version', 'dependencies', 'devDependencies', 'engines'):
            require(pkg.get(key) == lock.get('packages', {}).get('', {}).get(key), f'Package/lock mismatch: {key}')
        require('scripts/test-inventory.json' in candidate, 'Missing required test inventory')


def make_manifest(root, candidate, output):
    require(not output.is_relative_to(root) and not candidate.is_relative_to(root), 'Keep candidate and manifest outside target repository')
    baseline, revision = inventory(root), state(root)
    payload = {}
    excluded = {'.git', 'node_modules', '.next', 'out', 'test-results', 'playwright-report', 'coverage', '__pycache__'}
    for file in sorted(candidate.rglob('*')):
        relative = file.relative_to(candidate)
        if any(part in excluded for part in relative.parts):
            continue
        require(not file.is_symlink(), f'Symlink refused in candidate: {relative}')
        if not file.is_file() or file.name.endswith('.tsbuildinfo'):
            continue
        require(not file.name.startswith('.env') or file.name == '.env.example', 'Environment secrets must not be packaged')
        payload[relative.as_posix()] = base64.b64encode(file.read_bytes()).decode()
    target = {name: digest(base64.b64decode(value)) for name, value in payload.items()}
    portable(target)
    manifest = {'format': 2, 'revision': revision, 'baseline': baseline, 'candidate': target, 'replacements': {name: value for name, value in payload.items() if baseline.get(name) != target[name]}, 'deletions': sorted(set(baseline) - set(target)), 'generated': []}
    with output.open('x') as handle:
        json.dump(manifest, handle, indent=2)
    print(f'Review manifest before apply: {output}')


def atomic_write(target, data):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.soccerbot-', delete=False) as handle:
        temp = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        temp.chmod(target.stat().st_mode & 0o777 if target.exists() else 0o644)
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def collect_code_evidence(root, destination):
    source = root / 'test-results'
    report = source / 'verification-code.json'
    if not report.is_file() or report.is_symlink():
        return
    receipt = json.loads(report.read_text())
    names = {'verification-code.json'}
    for command in receipt.get('commands', []):
        log = PurePosixPath(command.get('log', ''))
        if log.parent == PurePosixPath('test-results') and log.name.startswith('code-') and log.suffix == '.log':
            names.add(log.name)
        if command.get('command') == ['npm', 'test']:
            names.add('unit.json')
    destination.mkdir(parents=True, exist_ok=True)
    for name in names:
        file = source / name
        if file.is_file() and not file.is_symlink():
            shutil.copy2(file, destination / name)


def apply(root, manifest_file, logs, verify_code=False, preflight=None, verify_local=None):
    safe_directory(root)
    safe_directory(logs)
    require(not logs.is_relative_to(root), 'Logs and backups must be outside the repository')
    manifest = json.loads(manifest_file.read_text())
    require(manifest.get('format') == 2, 'Unsupported manifest')
    require(not (verify_code and verify_local), 'Choose one verification operator')
    if verify_code:
        require(subprocess.check_output(['node', '--version'], text=True).strip() == 'v24.19.0', 'Use Node 24.19.0 before this installer; no source changed')
        subprocess.run(['npm', '--version'], check=True, stdout=subprocess.DEVNULL)
    lock = lock_path(root)
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise RuntimeError(f'Another update holds the repository lock: {lock}; inspect its owner before removing a stale lock') from None
    run = None
    receipt = {'status': 'preflight', 'source_application': 'not_attempted', 'tests_run': False, 'browser_tests_run': False, 'published': False, 'repository': str(root), 'commands': []}
    try:
        (lock / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'repository': str(root)}))
        print('PREFLIGHT PASS — repository lock acquired; paths and external logs checked.', flush=True)
        logs.mkdir(parents=True, exist_ok=True)
        run = Path(tempfile.mkdtemp(prefix='soccerbot-update-', dir=logs))
        baseline, candidate, replacements = manifest['baseline'], manifest['candidate'], manifest['replacements']
        deletions, generated = manifest.get('deletions', []), manifest.get('generated', [])
        require(set(generated) <= {'next-env.d.ts'}, 'Unknown generated source exemption')
        baseline_generated = set(generated) - set(baseline)
        portable(set(baseline) | set(candidate))
        before = state(root)
        receipt['revision'] = before
        require(all(before.get(key) == value for key, value in manifest['revision'].items()), 'Branch, HEAD or index mismatch')
        print(f'PREFLIGHT PASS — branch {before["branch"]}, HEAD {before["head"]}; index unchanged and unstaged.', flush=True)
        require(set(deletions) == set(baseline) - set(candidate), 'Incomplete deletion inventory')
        require(set(replacements) == {name for name in candidate if baseline.get(name) != candidate[name]}, 'Incomplete replacement inventory')
        for name in set(baseline) | set(candidate):
            checked_path(root, name)
            require(not PurePosixPath(name).name.startswith('.env') or PurePosixPath(name).name == '.env.example', 'Environment secrets refused')
        decoded = {}
        for name, encoded in replacements.items():
            decoded[name] = base64.b64decode(encoded, validate=True)
            require(digest(decoded[name]) == candidate[name], f'Candidate hash mismatch: {name}')
        current = inventory(root, missing=deletions, generated=baseline_generated)
        applied = inventory(root, missing=deletions, generated=generated) == candidate
        require(current == baseline or applied, 'Unknown source edit or inventory mismatch; nothing overwritten')
        print('PREFLIGHT PASS — exact reviewed source inventory, payload hashes and portable paths.', flush=True)
        if not applied:
            for name in replacements:
                require(name in baseline or not checked_path(root, name).exists(), f'Unexpected existing target: {name}')
            # Validate the entire candidate in isolation before touching the checkout.
            with tempfile.TemporaryDirectory(prefix='soccerbot-candidate-') as staging:
                # System temp may use an OS alias (macOS /var -> /private/var).
                # Resolve only our newly created staging root; repository and
                # payload paths must still pass the unchanged symlink checks.
                staging_root = Path(staging).resolve(strict=True)
                for name in candidate:
                    file = staging_root / name
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(decoded[name] if name in decoded else (root / name).read_bytes())
                portable_health(staging_root, candidate)
                print('PREFLIGHT PASS — complete staged candidate health and package/lock consistency.', flush=True)
                if preflight:
                    preflight(root, staging_root)
            backup = run / 'source-before'
            # Full source backup includes unchanged owners for an exact manual recovery.
            for name in baseline:
                source = checked_path(root, name)
                dest = backup / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
            (run / 'absent-files.json').write_text(json.dumps(sorted(set(candidate) - set(baseline))))
            require(inventory(root, generated=baseline_generated) == baseline and state(root) == before, 'Baseline changed during backup')
            print(f'PREFLIGHT PASS — external source backup complete: {backup}', flush=True)
            print('PREFLIGHT COMPLETE — applying reviewed source changes.', flush=True)
            receipt['status'] = 'applying'
            receipt['source_application'] = 'in_progress'
            for name, data in decoded.items():
                target = checked_path(root, name)
                require((digest(target.read_bytes()) if target.exists() else None) == baseline.get(name), f'Concurrent edit before write: {name}')
                atomic_write(target, data)
            for name in deletions:
                target = checked_path(root, name)
                require(digest(target.read_bytes()) == baseline[name], f'Concurrent edit before deletion: {name}')
                target.unlink()
        else:
            portable_health(root, candidate)
            if preflight:
                preflight(root, root)
            print('PREFLIGHT COMPLETE — candidate already present; no source writes required.', flush=True)
        require(inventory(root, missing=deletions, generated=generated) == candidate, 'Candidate inventory mismatch after apply')
        require(state(root) == before, 'Branch, HEAD or index changed')
        portable_health(root, candidate)
        receipt.update(status='already applied; no source writes' if applied else 'source applied; semantic verification pending', fingerprint=digest(json.dumps(candidate, sort_keys=True).encode()))
        receipt['source_application'] = 'already_applied' if applied else 'applied'
        print('Candidate already present; no source writes.' if applied else 'Canonical source applied with external backup.', flush=True)
        if verify_code:
            for command in [['npm', 'ci'], ['npm', 'run', 'verify:code']]:
                log = run / ('install.log' if command[1] == 'ci' else 'verify-code.log')
                print('$ ' + ' '.join(command), flush=True)
                with log.open('w') as output:
                    process = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                    for line in process.stdout:
                        print(line, end='', flush=True)
                        output.write(line)
                    code = process.wait()
                receipt['commands'].append({'command': command, 'exit': code, 'log': str(log)})
                require(code == 0, f'Verification failed; applied source and complete logs retained: {log}')
            receipt['tests_run'] = True
            require(inventory(root, missing=deletions, generated=generated) == candidate and state(root) == before, 'Candidate/revision changed during verification')
            collect_code_evidence(root, run / 'verification')
            receipt['status'] = 'non-browser verification passed; browser and physical acceptance pending'
        if verify_local:
            verify_local(root, run, receipt)
            require(inventory(root, missing=deletions, generated=generated) == candidate and state(root) == before, 'Candidate/revision changed during verification')
    except BaseException as error:
        receipt.update(status='failed', error=str(error))
        raise
    finally:
        if run:
            (run / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            print(f'Receipt and original-source backup: {run}')
        (lock / 'owner.json').unlink(missing_ok=True)
        lock.rmdir()
    return receipt


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    make = sub.add_parser('make-manifest')
    make.add_argument('repository', type=Path)
    make.add_argument('candidate', type=Path)
    make.add_argument('output', type=Path)
    install = sub.add_parser('apply')
    install.add_argument('repository', type=Path)
    install.add_argument('manifest', type=Path)
    install.add_argument('logs', type=Path)
    install.add_argument('--verify-code', action='store_true')
    args = parser.parse_args()
    source = args.repository.absolute()
    safe_directory(source)
    root = source.resolve()
    if args.command == 'make-manifest':
        make_manifest(root, args.candidate.resolve(), args.output.resolve())
    else:
        apply(root, args.manifest.resolve(), args.logs.absolute(), args.verify_code)


if __name__ == '__main__':
    main()
