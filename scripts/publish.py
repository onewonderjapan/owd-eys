"""Upload a verified build to the dedicated EYS prefix; never delete old objects."""
from pathlib import Path
import argparse,subprocess,json,hashlib,mimetypes,concurrent.futures

parser=argparse.ArgumentParser();parser.add_argument('--profile',default='onewonder.root');parser.add_argument('--apply',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];build=json.loads((root/'reports/build.json').read_text(encoding='utf-8'))
bucket='onewonder-eys-566601428909';distribution='E23UO5CSFQ0BWM';account='566601428909'
def aws(*cmd):
    p=subprocess.run(['aws',*cmd,'--profile',args.profile,'--output','json','--no-cli-pager'],capture_output=True,text=True,encoding='utf-8')
    if p.returncode:raise RuntimeError(p.stderr.strip())
    return json.loads(p.stdout) if p.stdout.strip() else {}
assert aws('sts','get-caller-identity')['Account']==account
for row in build['files']:
    p=root/'dist'/row['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
assert json.loads((root/'reports/package-check.json').read_text(encoding='utf-8'))['passed']
assert json.loads((root/'reports/local/smoke.json').read_text(encoding='utf-8'))['passed']
view_check=json.loads((root/'reports/local/first-person.json').read_text(encoding='utf-8'))
assert view_check['passed'] and view_check['build_sha256']==hashlib.sha256((root/'reports/build.json').read_bytes()).hexdigest(),'Verify first-person against the current build before publication.'
plan={'bucket':bucket,'prefix':'out/','distribution':distribution,'files':len(build['files']),'bytes':build['bytes'],'deletes':0,'upload_order':'hashed assets and scripts first, HTML last'}
(root/'reports/publish-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(plan),flush=True)
if not args.apply:raise SystemExit(0)
def upload(row):
    name=row['path'];p=root/'dist'/name;suffix=p.suffix
    kind={'.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.png':'image/png','.glb':'model/gltf-binary','.txt':'text/plain; charset=utf-8'}[suffix]
    cache='public,max-age=31536000,immutable' if name.startswith('assets/') and suffix in {'.glb','.png'} else 'public,max-age=300'
    key='out/'+name
    existing=subprocess.run(['aws','s3api','head-object','--bucket',bucket,'--key',key,'--region','ap-northeast-1','--profile',args.profile,'--output','json','--no-cli-pager'],capture_output=True,text=True,encoding='utf-8')
    if existing.returncode==0:
        head=json.loads(existing.stdout)
        if head['ContentLength']==row['bytes'] and head.get('Metadata',{}).get('sha256')==row['sha256']:
            return {'path':name,'action':'unchanged'}
    elif '(404)' not in existing.stderr and 'Not Found' not in existing.stderr:
        raise RuntimeError(existing.stderr.strip())
    # aws s3api uses SHA256 request checksums and the full-file metadata receipt.
    aws('s3api','put-object','--bucket',bucket,'--key',key,'--body',str(p),'--content-type',kind,'--cache-control',cache,'--metadata','sha256='+row['sha256'],'--checksum-algorithm','SHA256','--region','ap-northeast-1')
    head=aws('s3api','head-object','--bucket',bucket,'--key',key,'--region','ap-northeast-1')
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
