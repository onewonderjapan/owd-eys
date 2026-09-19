import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const build=JSON.parse(await fs.readFile('reports/build.json','utf8')),manifest=JSON.parse(await fs.readFile('dist/assets/manifest.json','utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(Object.keys(manifest.presets).length,27);assert.equal(manifest.modules.length,65);
const files=new Set(build.files.map(f=>f.path)),refs=[manifest.base.url,...manifest.modules.map(m=>m.url),...Object.values(manifest.presets).map(p=>p.thumbnail),JSON.parse(await fs.readFile('dist/map-scene.json','utf8')).glb];for(const url of refs)assert(files.has(url),'Missing runtime asset '+url);
for(const p of Object.values(manifest.presets))for(const id of p.modules)assert(manifest.modules.some(m=>m.id===id),'Unknown module '+id);
// Private source leakage: Windows drive paths in either slash form, POSIX home
// directories, any bare IPv4 literal, and per-user tool directories. Deliberately
// generic, so no internal host or user name has to be written down here.
const PRIVATE_SOURCE=/(?:[A-Za-z]:[\\/](?:Users|3d|home)\b|[A-Za-z]:\\\\|\/home\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\.codex[\\/])/;
const findings=[];
for(const f of build.files){assert(!/\.(blend\d*|zip|map|env|pem|key|py)$/i.test(f.path),f.path);const b=await fs.readFile('dist/'+f.path);assert.equal(sha(b),f.sha256);let text='';if(f.path.endsWith('.glb'))text=b.subarray(20,20+b.readUInt32LE(12)).toString('utf8');else if(/\.(js|json|html|css)$/.test(f.path))text=b.toString('utf8');if(PRIVATE_SOURCE.test(text))findings.push(f.path);}
assert.deepEqual(findings,[],'Public files contain private source paths');
const html=await fs.readFile('dist/index.html','utf8');for(const value of ['非官方二次创作','不用于商业用途','id="character-grid"','id="walk-fan-notice"'])assert(html.includes(value));assert(!html.includes('WALK_HUD'));assert(!html.includes('下载 Blender'));
await fs.writeFile('reports/package-check.json',JSON.stringify({passed:true,files:files.size,actors:27,modules:65,checks:['All runtime references and hashes present','No Blender sources, archives or private source paths in public package','Fan-work and noncommercial statements present']},null,2)+'\n');console.log('EYS_PACKAGE_PASS');
