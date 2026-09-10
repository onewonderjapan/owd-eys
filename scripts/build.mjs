import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=path.join(root,'dist'),sha=b=>createHash('sha256').update(b).digest('hex'),produced=new Set();await fs.mkdir(out,{recursive:true});
async function copyTree(from,to){await fs.mkdir(to,{recursive:true});for(const e of await fs.readdir(from,{withFileTypes:true})){if(e.name==='hud-fragment.html')continue;const src=path.join(from,e.name),dst=path.join(to,e.name);if(e.isDirectory())await copyTree(src,dst);else {await fs.copyFile(src,dst);produced.add(dst);}}}
await copyTree(path.join(root,'src'),out);
const html=(await fs.readFile('src/index.html','utf8')).replace('<!-- WALK_HUD -->',await fs.readFile('src/hud-fragment.html','utf8'));await fs.writeFile('dist/index.html',html);
const manifest=JSON.parse(await fs.readFile('assets-manifest.json','utf8'));
for(const a of manifest.assets){const p=path.join(root,'.cache',a.path),b=await fs.readFile(p);if(sha(b)!==a.sha256||b.length!==a.bytes)throw Error('Asset hash mismatch: '+a.path);const dest=path.join(out,a.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(p,dest);produced.add(dest);}
// Copy the installed Three.js import graph without shipping examples, source maps or build tooling.
const vendor=path.join(root,'node_modules/three'),seen=new Set();
async function module(rel){
 if(seen.has(rel))return;seen.add(rel);const absolute=path.resolve(vendor,rel);if(!absolute.startsWith(vendor+path.sep))throw Error('Vendor path escaped');
 const text=await fs.readFile(absolute,'utf8'),dest=path.join(out,'vendor/three',rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,text);produced.add(dest);
 const code=text.replace(/\/\*[\s\S]*?\*\//g,'');
 const imports=[...code.matchAll(/^\s*import\s+(?:[\w*\s{},]+?\s+from\s*)?['"]([^'"]+)['"]/gm),...code.matchAll(/^\s*export\s+[\w*\s{},]+?\s+from\s*['"]([^'"]+)['"]/gm)];
 for(const m of imports){if(m[1].startsWith('.'))await module(path.posix.normalize(path.posix.join(path.posix.dirname(rel),m[1])));else if(m[1].startsWith('three/addons/'))await module(m[1].replace('three/addons/','examples/jsm/'));else if(m[1]!=='three')throw Error('Unexpected vendor import '+m[1]);}
}
for(const rel of ['build/three.module.js','examples/jsm/controls/OrbitControls.js','examples/jsm/loaders/GLTFLoader.js'])await module(rel);
await fs.copyFile(path.join(vendor,'LICENSE'),path.join(out,'vendor/three/LICENSE.txt'));
produced.add(path.join(out,'vendor/three/LICENSE.txt'));
// Old files stay on disk for recovery; only this build's explicit outputs are published.
const rows=[];for(const p of produced){const b=await fs.readFile(p);rows.push({path:path.relative(out,p).split(path.sep).join('/'),bytes:b.length,sha256:sha(b)});}rows.sort((a,b)=>a.path.localeCompare(b.path));
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/build.json',JSON.stringify({version:pkg.version,built_at:new Date().toISOString(),files:rows,bytes:rows.reduce((n,r)=>n+r.bytes,0)},null,2)+'\n');console.log('Build:',rows.length,'files,',rows.reduce((n,r)=>n+r.bytes,0),'bytes');
