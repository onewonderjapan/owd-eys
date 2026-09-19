"""W2 thin launcher: stage the S1 build script to the SMB outbox and run Blender there.

Only ever launches build_props_blender.py against an empty scene; it never opens or
overwrites existing character source files. Retries reuse the same run_id and skip work
when the remote completion marker (asset-report.json) already exists, unless --force.

Host settings (SSH target, SMB share host, remote user) come from the environment;
see .env.example. Nothing about the build host is hard-coded here.

Usage (Windows Python, from the repository root):
  python -X utf8 scripts/immersion/run_s1.py --run-id <id> [--force] [--timeout 2400]
"""
import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]


def env(name, default=None):
    value = (os.environ.get(name) or '').strip()
    return value or default


def derived(name, template, source):
    """Env var, or a value derived from the build-host settings; never a baked-in host."""
    value = env(name)
    if value:
        return value
    base = env(source)
    if not base:
        raise SystemExit(
            f'Set {name}, or set {source} so it can be derived. '
            'Copy .env.example to .env and fill in the build-host settings.')
    return template.format(base)


# Machine-specific locations. Nothing here is pinned to one LAN or account: the
# share host and the remote user come from the environment (see .env.example).
ARCHIVE = Path(env('EYS_IMMERSION_ARCHIVE') or REPO_ROOT / '.cache' / 'immersion_assets')
SMB_SHARE = Path(derived('EYS_IMMERSION_SHARE', r'\\{}\Home\outbox\eys-immersion', 'EYS_S1_HOST'))
REMOTE_BASE = derived('EYS_IMMERSION_HOME', '/home/{}/outbox/eys-immersion', 'EYS_S1_USER')
RUNTIME = derived('EYS_IMMERSION_RUNTIME', '/home/{}/outbox/codex-3d-atelier/runtime/usr', 'EYS_S1_USER')
SSH_TARGET = env('EYS_S1_SSH_TARGET', 's1')
# Windows' own OpenSSH: the MSYS ssh bundled with Git Bash mangles ~ expansion
# when the Windows home directory contains non-ASCII characters.
SSH = env('EYS_SSH_BINARY', r'C:\Windows\System32\OpenSSH\ssh.exe')
BUILD_SCRIPT = HERE / 'build_props_blender.py'

PARSER = argparse.ArgumentParser()
PARSER.add_argument('--run-id', required=True)
PARSER.add_argument('--timeout', type=int, default=2400)
PARSER.add_argument('--force', action='store_true')
OPTS = PARSER.parse_args()

RUN_ID = OPTS.run_id
ARCHIVE_DIR = ARCHIVE / RUN_ID
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
SMB_DIR = SMB_SHARE / RUN_ID
SMB_DIR.mkdir(parents=True, exist_ok=True)
REMOTE_DIR = f'{REMOTE_BASE}/{RUN_ID}'
JOURNAL = ARCHIVE_DIR / 's1-jobs.jsonl'


def journal(status, extra=None):
    event = {'at': datetime.now(timezone.utc).isoformat(), 'run_id': RUN_ID, 'status': status}
    if extra:
        event.update(extra)
    with JOURNAL.open('a', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(event, ensure_ascii=False) + '\n')


def ssh_run(command, timeout, log_path=None):
    result = subprocess.run([SSH, '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', SSH_TARGET, command],
                            capture_output=True, text=True, timeout=timeout + 60)
    if log_path:
        log_path.write_text((result.stdout or '') + (result.stderr or ''), encoding='utf-8', newline='\n')
    return result


def main():
    marker = SMB_DIR / 'asset-report.json'
    if marker.exists() and not OPTS.force:
        print(f'[SKIP] {marker} already exists; use --force to rebuild.')
        return 0

    staged = SMB_DIR / BUILD_SCRIPT.name
    shutil.copy2(BUILD_SCRIPT, staged)
    journal('staged', {'script': str(staged), 'script_sha256_note': 'hash recorded in asset-report.json'})

    env = (f'LD_LIBRARY_PATH={RUNTIME}/lib:{RUNTIME}/lib/aarch64-linux-gnu '
           f'BLENDER_SYSTEM_SCRIPTS={RUNTIME}/share/blender/scripts '
           f'BLENDER_SYSTEM_DATAFILES={RUNTIME}/share/blender/datafiles')
    remote_cmd = (f'{env} {RUNTIME}/bin/blender -b --python-exit-code 1 '
                  f'--python {shlex.quote(REMOTE_DIR + "/" + BUILD_SCRIPT.name)} -- '
                  f'--out {shlex.quote(REMOTE_DIR)} --run-id {shlex.quote(RUN_ID)}')
    log_path = ARCHIVE_DIR / 's1-build.log'
    journal('started', {'remote_cmd': remote_cmd, 'remote_dir': REMOTE_DIR, 'log': str(log_path)})
    print(f'[RUN] blender on {SSH_TARGET}; log ->', log_path, flush=True)
    started = time.time()
    try:
        result = ssh_run(remote_cmd, OPTS.timeout, log_path)
    except subprocess.TimeoutExpired:
        journal('timeout', {'after_seconds': round(time.time() - started)})
        print(f'[TIMEOUT] remote blender exceeded --timeout; inspect via: ssh {SSH_TARGET} ls ' + REMOTE_DIR)
        return 3
    elapsed = round(time.time() - started)
    if result.returncode != 0:
        journal('failed', {'exit_code': result.returncode, 'elapsed_seconds': elapsed})
        tail = (result.stdout or '')[-3000:]
        print('[FAIL] blender exit', result.returncode)
        print(tail)
        return result.returncode or 1
    if not marker.exists():
        journal('failed', {'reason': 'blender exited 0 but asset-report.json missing'})
        print('[FAIL] blender exited 0 but no asset-report.json on SMB')
        return 2
    journal('completed', {'elapsed_seconds': elapsed, 'report': str(marker)})
    print(f'[OK] asset-report.json present after {elapsed}s: {marker}')
    for entry in sorted(SMB_DIR.iterdir()):
        print(' -', entry.name, entry.stat().st_size)
    return 0


if __name__ == '__main__':
    sys.exit(main())
