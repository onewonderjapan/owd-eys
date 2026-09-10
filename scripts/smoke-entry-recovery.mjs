import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const url=process.argv[2]||'http://127.0.0.1:8870/',label=process.argv[3]||'local',out='reports/'+label;
await fs.mkdir(out,{recursive:true});
const build=JSON.parse(await fs.readFile('reports/build.json','utf8'));
const old=await fs.readFile('scripts/fixtures/index-1.0.0.html','utf8');
const scene=JSON.parse(await fs.readFile('src/map-scene.json','utf8'));
const manifest=JSON.parse(await fs.readFile('src/assets/manifest.json','utf8'));
const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try {
 for(const kind of ['cached-html','map-retry','avatar-retry']) {
  const page=await b.newPage({viewport:{width:1365,height:900}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  if(kind==='cached-html') await page.route(url,r=>r.fulfill({contentType:'text/html',body:old}));
  else {
   const broken=new URL(kind==='map-retry'?scene.glb:manifest.base.url,url).href;
   let first=true;await page.route(broken,async r=>{if(first){first=false;await r.fulfill({status:503,body:'Temporary test failure'});}else await r.continue();});
  }
  await page.addInitScript(()=>{
   window.entryLabels=[];new MutationObserver(()=>{const text=document.querySelector('#walk-enter')?.textContent;if(text&&window.entryLabels.at(-1)!==text)window.entryLabels.push(text);}).observe(document,{subtree:true,childList:true,characterData:true});
  });
  await page.goto(url);await page.waitForFunction(()=>window.eys?.state().ready,null,{timeout:45000});
  await page.locator('#walk-enter').click();
  if(kind!=='cached-html') {
   await page.waitForFunction(()=>eys.state().error||eys.state().walk?.error,null,{timeout:45000});
   assert(await page.locator('#walk-error').isVisible());assert(await page.locator('#walk-enter').isEnabled());
   await page.locator('#walk-enter').click();
  }
  await page.waitForFunction(()=>eys.state().walk?.active,null,{timeout:45000});
  const s=await page.evaluate(()=>eys.state());assert.equal(s.error,null);assert.equal(s.walk.error,null);
  const labels=await page.evaluate(()=>window.entryLabels);
  assert(labels.some(t=>t.startsWith('正在下载地图 ')));assert(labels.some(t=>/^正在准备角色 \d/.test(t)));
  if(kind!=='cached-html') {
   const appRequests=requests.filter(u=>/\.(?:js|css|json)(?:\?|$)/.test(u));
   assert(appRequests.every(u=>new URL(u).pathname.startsWith('/'+build.release_path+'/')),JSON.stringify(appRequests));
  }
  assert.deepEqual(errors,[]);
  results.push({case:kind,passed:true,labels,actor:s.walk.actor});await page.close();
 }
 const report={passed:true,url,build_sha256:createHash('sha256').update(await fs.readFile('reports/build.json')).digest('hex'),results};
 await fs.writeFile(out+'/entry-recovery.json',JSON.stringify(report,null,2)+'\n');console.log('EYS_ENTRY_RECOVERY_PASS',label,results.length);
}finally{await b.close();}
