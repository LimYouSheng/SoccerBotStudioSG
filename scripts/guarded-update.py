#!/usr/bin/env python3
"""Candidate-specific source updates. Apply-only; never run tests, Git writes or deployment."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, check=True)
    return result.stdout.strip()


def checked_path(root, name):
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts and '.git' not in path.parts, 'Unsafe manifest path')
    target = root / name
    require(not any(p.is_symlink() for p in [target, *target.parents]), f'Symlink refused: {name}')
    require(target.resolve().is_relative_to(root), f'Escaping path: {name}')
    return target


def inventory(root):
    names = git(root, 'ls-files', '-c', '-o', '--exclude-standard', '-z').split('\0')
    result = {}
    for name in sorted(set(filter(None, names))):
        target = checked_path(root, name)
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
    require(set(baseline) <= set(payload), 'Deletion requires a separately reviewed migration; candidate is missing baseline files')
    target = {name: digest(base64.b64decode(value)) for name, value in payload.items()}
    replacements = {name: value for name, value in payload.items() if baseline.get(name) != target[name]}
    manifest = {'format': 1, 'revision': revision, 'baseline': baseline, 'candidate': target, 'replacements': replacements}
    with output.open('x') as handle:
        json.dump(manifest, handle, indent=2)
    print(f'Review manifest before apply: {output}')


def apply(root, manifest_file, logs):
    require(not logs.is_relative_to(root), 'Logs and backups must be outside the repository')
    manifest = json.loads(manifest_file.read_text())
    require(manifest.get('format') == 1, 'Unsupported manifest')
    logs.mkdir(parents=True, exist_ok=True)
    lock = logs / ('soccerbot-' + digest(str(root).encode())[:16] + '.lock')
    lock.mkdir()
    run = Path(tempfile.mkdtemp(prefix='soccerbot-update-', dir=logs))
    receipt = {'status': 'preflight', 'tests_run': False, 'published': False, 'repository': str(root)}
    try:
        baseline, candidate, replacements = manifest['baseline'], manifest['candidate'], manifest['replacements']
        require(state(root) == manifest['revision'], 'Branch, HEAD or index mismatch')
        require(inventory(root) == baseline, 'Unknown source edit or inventory mismatch; nothing overwritten')
        require(set(baseline) <= set(candidate), 'Deletion is not supported')
        require(set(replacements) == {name for name in candidate if baseline.get(name) != candidate[name]}, 'Incomplete replacement inventory')
        decoded = {}
        for name, encoded in replacements.items():
            target = checked_path(root, name)
            require(not target.exists() or name in baseline, f'Unexpected existing target: {name}')
            decoded[name] = base64.b64decode(encoded, validate=True)
            require(digest(decoded[name]) == candidate[name], f'Candidate hash mismatch: {name}')
        backup = run / 'source-before'
        for name in replacements:
            source = checked_path(root, name)
            if source.exists():
                dest = backup / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
        (run / 'absent-files.json').write_text(json.dumps([name for name in replacements if name not in baseline]))
        require(inventory(root) == baseline and state(root) == manifest['revision'], 'Baseline changed during backup')
        receipt['status'] = 'applying'
        for name, data in decoded.items():
            target = checked_path(root, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.soccerbot-', delete=False) as handle:
                temp = Path(handle.name)
                handle.write(data)
            try:
                temp.chmod(target.stat().st_mode & 0o777 if target.exists() else 0o644)
                temp.replace(target)
            finally:
                temp.unlink(missing_ok=True)
        require(inventory(root) == candidate, 'Candidate inventory mismatch after apply')
        require(state(root) == manifest['revision'], 'Branch, HEAD or index changed')
        receipt.update(status='source applied; verification pending', fingerprint=digest(json.dumps(candidate, sort_keys=True).encode()))
    except BaseException as error:
        receipt.update(status='failed', error=str(error))
        raise
    finally:
        (run / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        lock.rmdir()
        print(f'Receipt and original-source backup: {run}')


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
    args = parser.parse_args()
    # Reject a symlink in the supplied repository path before resolving it.
    source = args.repository.absolute()
    require(not any(p.is_symlink() for p in [source, *source.parents]), 'Symlinked repository path refused')
    root = source.resolve()
    if args.command == 'make-manifest':
        make_manifest(root, args.candidate.resolve(), args.output.resolve())
    else:
        apply(root, args.manifest.resolve(), args.logs.resolve())


if __name__ == '__main__':
    main()
