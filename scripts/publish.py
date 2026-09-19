"""Upload a verified build to the dedicated EYS prefix; never delete old objects.

Target identifiers are never hard-coded: the bucket, distribution, account and
AWS CLI profile all come from the environment (see .env.example). Missing values
are a hard error, so a build can never be pushed at a guessed or inherited target.
"""
from pathlib import Path
import argparse,subprocess,json,hashlib,os,concurrent.futures

def required(name,flag_hint=''):
    value=(os.environ.get(name) or '').strip()
    if not value:
        hint=f' (or pass {flag_hint})' if flag_hint else ''
        raise SystemExit(f'Missing {name}{hint}. Copy .env.example to .env and fill it in; see docs/DEPLOYMENT.md.')
    return value

parser=argparse.ArgumentParser()
# No default profile on purpose: an implicit administrator/root profile is exactly
# what we do not want a publish script to fall back to.
parser.add_argument('--profile',default=None,help='AWS CLI profile; defaults to $EYS_AWS_PROFILE, required either way')
parser.add_argument('--apply',action='store_true')
args=parser.parse_args()
profile=(args.profile or '').strip() or required('EYS_AWS_PROFILE','--profile')
root=Path(__file__).resolve().parents[1];build=json.loads((root/'reports/build.json').read_text(encoding='utf-8'))
account=required('EYS_AWS_ACCOUNT_ID')
bucket=required('EYS_S3_BUCKET')
distribution=required('EYS_CF_DISTRIBUTION_ID')
region=(os.environ.get('EYS_S3_REGION') or 'ap-northeast-1').strip()
if not (account.isdigit() and len(account)==12):raise SystemExit('EYS_AWS_ACCOUNT_ID must be the 12-digit AWS account id.')
def aws(*cmd):
    p=subprocess.run(['aws',*cmd,'--profile',profile,'--output','json','--no-cli-pager'],capture_output=True,text=True,encoding='utf-8')
    if p.returncode:raise RuntimeError(p.stderr.strip())
    return json.loads(p.stdout) if p.stdout.strip() else {}
assert aws('sts','get-caller-identity')['Account']==account
for row in build['files']:
    p=root/'dist'/row['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
assert json.loads((root/'reports/package-check.json').read_text(encoding='utf-8'))['passed']
assert json.loads((root/'reports/local/smoke.json').read_text(encoding='utf-8'))['passed']
view_check=json.loads((root/'reports/local/first-person.json').read_text(encoding='utf-8'))
assert view_check['passed'] and view_check['build_sha256']==hashlib.sha256((root/'reports/build.json').read_bytes()).hexdigest(),'Verify first-person against the current build before publication.'
entry_check=json.loads((root/'reports/local/entry-recovery.json').read_text(encoding='utf-8'))
assert entry_check['passed'] and entry_check['build_sha256']==view_check['build_sha256'],'Verify cached-page entry and retry against the current build.'
# immersion gate: the newest, largest feature must be smoke-tested against the
# exact build that is about to ship, or a broken immersion can go out with all
# other gates green
build_digest=hashlib.sha256((root/'reports/build.json').read_bytes()).hexdigest()
for report_path in ('reports/immersion/immersion.json','reports/immersion/p0-test-immersion.json'):
    p=root/report_path
    if not p.is_file():raise RuntimeError(f'Missing immersion report {report_path}; run scripts/smoke-immersion.mjs and scripts/test-immersion.mjs first.')
    immersion_check=json.loads(p.read_text(encoding='utf-8'))
    ok=immersion_check.get('passed') if report_path=='reports/immersion/immersion.json' else immersion_check.get('failed')==0
    assert ok,f'{report_path} did not pass; re-run it against the current build.'
    assert immersion_check.get('build_sha256')==build_digest,f'{report_path} is stale (build hash mismatch); re-run it against the current build.'
plan={'bucket':bucket,'prefix':'out/','distribution':distribution,'files':len(build['files']),'bytes':build['bytes'],'deletes':0,'upload_order':'hashed assets and scripts first, HTML last'}
(root/'reports/publish-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(plan),flush=True)
if not args.apply:raise SystemExit(0)
def upload(row):
    name=row['path'];p=root/'dist'/name;suffix=p.suffix
    kind={'.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.png':'image/png','.glb':'model/gltf-binary','.txt':'text/plain; charset=utf-8'}[suffix]
    cache='public,max-age=31536000,immutable' if name.startswith('releases/') or name.startswith('assets/') and suffix in {'.glb','.png'} else 'no-cache,max-age=0,must-revalidate'
    immutable=cache.startswith('public,max-age=31536000')
    key='out/'+name
    existing=subprocess.run(['aws','s3api','head-object','--bucket',bucket,'--key',key,'--region',region,'--profile',profile,'--output','json','--no-cli-pager'],capture_output=True,text=True,encoding='utf-8')
    if existing.returncode==0:
        head=json.loads(existing.stdout)
        matches=head['ContentLength']==row['bytes'] and head.get('Metadata',{}).get('sha256')==row['sha256']
        if immutable and not matches:
            # anything served with a year-long immutable cache header must never
            # change content under the same key, or returning visitors stay broken
            raise RuntimeError('Published immutable object differs; use a new versioned/hashed filename: '+name)
        if matches and head.get('CacheControl')==cache:
            return {'path':name,'action':'unchanged'}
    elif '(404)' not in existing.stderr and 'Not Found' not in existing.stderr:
        raise RuntimeError(existing.stderr.strip())
    # aws s3api uses SHA256 request checksums and the full-file metadata receipt.
    aws('s3api','put-object','--bucket',bucket,'--key',key,'--body',str(p),'--content-type',kind,'--cache-control',cache,'--metadata','sha256='+row['sha256'],'--checksum-algorithm','SHA256','--region',region)
    head=aws('s3api','head-object','--bucket',bucket,'--key',key,'--region',region)
    assert head['ContentLength']==row['bytes'] and head['Metadata']['sha256']==row['sha256'],name
    return {'path':name,'action':'uploaded'}
rows=build['files'];uploaded=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    for name in pool.map(upload,[r for r in rows if not r['path'].endswith('.html')]):uploaded.append(name)
for row in rows:
    if row['path'].endswith('.html'):uploaded.append(upload(row))
invalidation=aws('cloudfront','create-invalidation','--distribution-id',distribution,'--paths','/*')
receipt={'passed':True,**plan,'uploaded':uploaded,'invalidation_id':invalidation['Invalidation']['Id'],'build_sha256':hashlib.sha256((root/'reports/build.json').read_bytes()).hexdigest()}
(root/'reports/upload.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('EYS_UPLOAD_PASS',len(uploaded),flush=True)
