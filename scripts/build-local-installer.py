#!/usr/bin/env python3
"""Package a reviewed candidate manifest with the canonical guarded local runner."""
import argparse
import ast
import base64
import gzip
import hashlib
import json
from pathlib import Path
import textwrap


def build(manifest, output):
    scripts = Path(__file__).parent
    modules = {name: (scripts / name).read_text() for name in ('guarded-update.py', 'local-installer.py')}
    for name, source in modules.items():
        ast.parse(source, filename=name)
    modules['candidate.json'] = json.dumps(json.loads(manifest.read_text()), indent=2) + '\n'
    raw = json.dumps(modules, separators=(',', ':')).encode()
    payload = '\n'.join(textwrap.wrap(base64.b64encode(gzip.compress(raw, mtime=0)).decode(), 100))
    wrapper = '''#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# -gt 1 || ${1:-} == --* ]]; then
  printf 'Usage: bash installer.sh [repository-path]\\nRuns the reviewed manifest scope: full application/browser checks or bounded planning/installer checks.\\n' >&2
  exit 2
fi
command -v python3 >/dev/null || { printf 'STOPPED — Python 3.11+ is required. No source changed.\\n' >&2; exit 1; }
command -v git >/dev/null || { printf 'STOPPED — Git is required. No source changed.\\n' >&2; exit 1; }
soccerbot_repo="${1:-$HOME/Desktop/SoccerBotStudioSG}"
python3 - "$soccerbot_repo" <<'SOCCERBOT_STANDARD_PY'
import base64, gzip, hashlib, json, subprocess, sys, tempfile
from pathlib import Path
if sys.version_info < (3, 11):
    raise SystemExit('STOPPED — Python 3.11+ is required. No source changed.')
try:
    raw = gzip.decompress(base64.b64decode("""__PAYLOAD__"""))
    if hashlib.sha256(raw).hexdigest() != '__SHA256__':
        raise RuntimeError('Embedded delivery checksum mismatch; no source changed')
    modules = json.loads(raw)
    if set(modules) != {'guarded-update.py', 'local-installer.py', 'candidate.json'}:
        raise RuntimeError('Unexpected delivery module inventory; no source changed')
    with tempfile.TemporaryDirectory(prefix='SoccerBotStudioSG.delivery.') as folder:
        stage = Path(folder).resolve(strict=True)
        for name, source in modules.items():
            (stage / name).write_text(source)
        result = subprocess.run([sys.executable, str(stage / 'local-installer.py'), sys.argv[1], str(stage / 'candidate.json')])
    sys.exit(result.returncode)
except Exception as error:
    print('STOPPED — ' + str(error), file=sys.stderr)
    sys.exit(1)
SOCCERBOT_STANDARD_PY
'''
    output.write_text(wrapper.replace('__PAYLOAD__', payload).replace('__SHA256__', hashlib.sha256(raw).hexdigest()))
    output.chmod(0o700)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(build(args.manifest, args.output))
