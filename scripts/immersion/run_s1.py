"""W2 thin launcher: stage the S1 build script to the SMB outbox and run Blender there.

Only ever launches build_props_blender.py against an empty scene; it never opens or
overwrites existing character source files. Retries reuse the same run_id and skip work
when the remote completion marker (asset-report.json) already exists, unless --force.

Usage (from W2, Windows Python):
  python scripts/immersion/run_s1.py --run-id <id> [--force] [--timeout 2400]
"""
import argparse
import json
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCHIVE = Path(r'C:\3d\eys\immersion_assets')
SMB_SHARE = Path(r'\\172.72.0.1\Home\outbox\eys-immersion')
REMOTE_BASE = '/home/baibai/outbox/eys-immersion'
RUNTIME = '/home/baibai/outbox/codex-3d-atelier/runtime/usr'
SSH = r'C:\Windows\System32\OpenSSH\ssh.exe'
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
    result = subprocess.run([SSH, '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', 's1', command],
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
    print('[RUN] blender on s1; log ->', log_path, flush=True)
    started = time.time()
    try:
        result = ssh_run(remote_cmd, OPTS.timeout, log_path)
    except subprocess.TimeoutExpired:
        journal('timeout', {'after_seconds': round(time.time() - started)})
        print('[TIMEOUT] remote blender exceeded --timeout; inspect via: ssh s1 ls ' + REMOTE_DIR)
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
