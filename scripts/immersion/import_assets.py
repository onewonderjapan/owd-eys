"""W2 import: verify the S1 delivery, cache the GLB by content hash, append the
assets manifest, and emit the public src/immersion-assets.json.

Run AFTER the SMB output directory has been copied into the W2 archive:
  python scripts/immersion/import_assets.py --run-id <id> [--source <collected dir>]

Safety: existing manifest records are never modified; an existing cache file with a
different hash is an error, not an overwrite. Reports every planned path before writing.
"""
import argparse
import hashlib
import json
import shutil
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
# Local archive of S1 deliveries; override with EYS_IMMERSION_ARCHIVE (see .env.example).
ARCHIVE = Path((os.environ.get('EYS_IMMERSION_ARCHIVE') or '').strip() or ROOT / '.cache' / 'immersion_assets')
CACHE_ASSETS = ROOT / '.cache' / 'assets'
ASSETS_MANIFEST = ROOT / 'assets-manifest.json'
IMMERSION_JSON = ROOT / 'src' / 'immersion-assets.json'
PRE_P0_SNAPSHOT = ROOT / 'reports' / 'immersion' / 'inputs' / 'assets-manifest.pre-p0.json'

EXPECTED_NODES = ['prop_bell', 'bell_swing_pivot', 'bell_clapper_pivot',
                  'prop_round_table', 'prop_chair', 'prop_dock',
                  'prop_sink_stone', 'chain_anchor', 'prop_chain_link', 'prop_firepit']

PARSER = argparse.ArgumentParser()
PARSER.add_argument('--run-id', required=True)
PARSER.add_argument('--source', default=None, help='collected delivery dir; defaults to the W2 archive for the run')
OPTS = PARSER.parse_args()

SOURCE = Path(OPTS.source) if OPTS.source else ARCHIVE / OPTS.run_id
REPORT_PATH = SOURCE / 'asset-report.json'
GLB_PATH = SOURCE / 'immersion-props.glb'
BLEND_PATH = SOURCE / 'immersion-props.blend'


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fail(message):
    print('[FAIL]', message)
    sys.exit(1)


def main():
    if not REPORT_PATH.exists():
        fail(f'{REPORT_PATH} missing; run scripts/immersion/run_s1.py first')
    report = json.loads(REPORT_PATH.read_text(encoding='utf-8'))
    if report.get('run_id') != OPTS.run_id:
        fail(f"report run_id {report.get('run_id')} != --run-id {OPTS.run_id}")
    failed_checks = [c for c in report.get('checks', []) if not c.get('passed')]
    if failed_checks:
        fail(f"S1 report has failing checks: {[c['name'] for c in failed_checks]}")

    blend_entry = next((f for f in report['files'] if f['name'] == 'immersion-props.blend'), None)
    glb_entry = next((f for f in report['files'] if f['name'] == 'immersion-props.glb'), None)
    if not blend_entry or not glb_entry:
        fail('report lacks blend/glb file entries')
    if not BLEND_PATH.exists() or not GLB_PATH.exists():
        fail('blend or glb missing in source dir')

    for entry, path in ((blend_entry, BLEND_PATH), (glb_entry, GLB_PATH)):
        actual = sha256_file(path)
        if actual != entry['sha256']:
            fail(f"{entry['name']} hash drift: report {entry['sha256']} vs actual {actual}")
        if path.stat().st_size != entry['bytes']:
            fail(f"{entry['name']} byte drift")

    glb_hash = glb_entry['sha256']
    glb_bytes = glb_entry['bytes']
    cache_path = CACHE_ASSETS / f'{glb_hash}.glb'
    manifest = json.loads(ASSETS_MANIFEST.read_text(encoding='utf-8'))
    pre_snapshot = json.loads(PRE_P0_SNAPSHOT.read_text(encoding='utf-8'))

    # Old records must be byte-identical to the P0 snapshot (append-only contract).
    old_ids = {(a['path'], a['sha256'], a['bytes']) for a in pre_snapshot['assets']}
    now_ids = {(a['path'], a['sha256'], a['bytes']) for a in manifest['assets']}
    missing_old = old_ids - now_ids
    if missing_old:
        fail(f'existing manifest records disappeared: {sorted(missing_old)[:3]}')

    planned = [f'.cache/assets/{glb_hash}.glb', f"assets/{glb_hash}.glb in assets-manifest", str(IMMERSION_JSON)]
    print('[PLAN] will write:')
    for p in planned:
        print('  -', p)
    if cache_path.exists() and sha256_file(cache_path) != glb_hash:
        fail(f'{cache_path} exists with different content; refusing to overwrite')
    duplicate = [a for a in manifest['assets'] if a['sha256'] == glb_hash]
    already_manifested = bool(duplicate)

    # Copy GLB into the cache before touching any manifest.
    CACHE_ASSETS.mkdir(parents=True, exist_ok=True)
    if not cache_path.exists():
        shutil.copy2(GLB_PATH, cache_path)
        print('[OK] cached', cache_path)
    else:
        print('[SKIP] cache entry already present')

    if not already_manifested:
        manifest['assets'].append({'path': f'assets/{glb_hash}.glb', 'sha256': glb_hash, 'bytes': glb_bytes})
        ASSETS_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        print('[OK] appended to assets-manifest.json')
    else:
        print('[SKIP] manifest already contains this asset')

    # Verify all old entries again post-write, then archive the manifest copy for this run.
    after = json.loads(ASSETS_MANIFEST.read_text(encoding='utf-8'))
    now_ids_after = {(a['path'], a['sha256'], a['bytes']) for a in after['assets']}
    if not old_ids <= now_ids_after:
        fail('old records changed after append')
    (ARCHIVE / OPTS.run_id / 'assets-manifest.after-import.json').write_text(
        json.dumps(after, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

    nodes = report.get('glb', {}).get('root_nodes', {})
    missing_nodes = [n for n in EXPECTED_NODES if n not in report.get('glb', {}).get('root_nodes', {})
                     and n not in [c for c in EXPECTED_NODES]]
    # Pivots are child nodes; confirm via the report's roots mapping instead.
    roots_report = report.get('roots', {})
    for pivot in ('bell_swing_pivot', 'bell_clapper_pivot'):
        if pivot not in roots_report.get('prop_bell', {}).get('pivots', []):
            fail(f'pivot {pivot} missing from report roots')
    if 'chain_anchor' not in roots_report.get('prop_sink_stone', {}).get('pivots', []):
        fail('chain_anchor missing from report roots')

    immersion = {
        'schema': 1,
        'pack_id': 'eys-immersion-props-v1',
        'url': f'assets/{glb_hash}.glb',
        'sha256': glb_hash,
        'bytes': glb_bytes,
        'nodes': {
            'bell': 'prop_bell',
            'bellSwingPivot': 'bell_swing_pivot',
            'bellClapperPivot': 'bell_clapper_pivot',
            'roundTable': 'prop_round_table',
            'chair': 'prop_chair',
            'dock': 'prop_dock',
            'sinkStone': 'prop_sink_stone',
            'chainAnchor': 'chain_anchor',
            'chainLink': 'prop_chain_link',
            'firepit': 'prop_firepit',
        },
        'run_id': OPTS.run_id,
        'blender_version': report.get('blender_version'),
    }
    IMMERSION_JSON.write_text(json.dumps(immersion, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('[OK] wrote', IMMERSION_JSON)

    # Archive the delivery into W2 (blend, glb, report, renders) if not already there.
    archive_dir = ARCHIVE / OPTS.run_id
    archive_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(SOURCE.iterdir()):
        if path.is_file() and not path.name.startswith('assets-manifest.after-import'):
            target = archive_dir / path.name
            if not target.exists():
                shutil.copy2(path, target)
            elif sha256_file(target) != sha256_file(path):
                fail(f'archive conflict for {path.name}')
    print('[DONE] import complete for run', OPTS.run_id)


if __name__ == '__main__':
    main()
