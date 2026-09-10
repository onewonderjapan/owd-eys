"""Copy current runtime assets by hash from the authored wardrobe workspace."""
from pathlib import Path
import argparse,json,hashlib,shutil
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,required=True)
args=parser.parse_args()
source=args.source.resolve();target=Path(__file__).resolve().parents[1]
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def write(name,data):
    (target/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
catalog={}
def media(name):
    path=(source/'public'/name).resolve()
    assert path.is_relative_to((source/'public').resolve())
    assert path.suffix in ['.glb','.png']
    content=path.read_bytes();sha=hashlib.sha256(content).hexdigest();rel='assets/'+sha+path.suffix
    dest=target/'.cache'/rel;dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists():assert hashlib.sha256(dest.read_bytes()).hexdigest()==sha
    else:shutil.copy2(path,dest)
    catalog[rel]={'path':rel,'sha256':sha,'bytes':len(content)}
    return rel
m=read(source/'public/assets/manifest.json')
manifest={'version':m['version'],'body_fit':m['body_fit'],'base':{'id':m['base']['id'],'url':media(m['base']['url'])},'modules':[],'presets':{}}
for a in m['modules']:
    manifest['modules'].append({**{k:a[k] for k in ['id','label','slot','body_fit','hide_tags','keep_crown'] if k in a},'url':media(a['url'])})
for id,p in m['presets'].items():
    manifest['presets'][id]={**{k:p[k] for k in ['label','color','modules']},'thumbnail':media('thumbs/'+id+'.png')}
scene=read(source/'public/map-scene.json')
write('src/assets/manifest.json',manifest)
write('src/map-scene.json',{'id':scene['id'],'glb':media(scene['glb']),'layout':scene['layout'],'report':{'blend_sha256':scene['report']['blend_sha256']}})
write('assets-manifest.json',{'schema':1,'base_url':'https://eys.onewonder.co.jp/','assets':list(catalog.values())})
write('reports/source-baseline.json',{'source':str(source),'wardrobe_version':m['version'],'wardrobe_manifest_sha256':hashlib.sha256((source/'public/assets/manifest.json').read_bytes()).hexdigest(),'map_manifest_sha256':hashlib.sha256((source/'public/map-scene.json').read_bytes()).hexdigest(),'assets':len(catalog),'bytes':sum(a['bytes'] for a in catalog.values())})
print('EYS_ASSETS_SYNC',m['version'],len(catalog))
