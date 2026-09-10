import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const m=JSON.parse(await fs.readFile('assets-manifest.json','utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
for(const a of m.assets){const dest=path.join('.cache',a.path);let b=await fs.readFile(dest).catch(()=>null);if(b&&sha(b)===a.sha256)continue;if(b)throw Error('Existing cached file differs: '+dest);const response=await fetch(new URL(a.path,m.base_url));if(!response.ok)throw Error('Asset unavailable: '+response.status+' '+a.path);b=Buffer.from(await response.arrayBuffer());if(b.length!==a.bytes||sha(b)!==a.sha256)throw Error('Downloaded asset hash mismatch: '+a.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,b);}
console.log('All',m.assets.length,'assets verified.');
