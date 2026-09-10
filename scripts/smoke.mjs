import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.argv[2]||'http://127.0.0.1:8870/',label=process.argv[3]||'local',out='reports/'+label;await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[],requests=[],evidence=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('request',r=>requests.push(r.url()));
 const state=()=>page.evaluate(()=>eys.state());
 const response=await page.goto(url);assert.equal(response.status(),200);await page.waitForFunction(()=>window.eys?.state().ready||window.eys?.state().error,null,{timeout:60000});assert.equal((await state()).error,null);assert.equal((await state()).actorCount,27);assert.equal(await page.locator('[data-actor]').count(),27);assert.equal((await state()).walk,null);assert(!requests.some(r=>r.endsWith('.glb')),'Do not load 3D models before selection');
 await page.locator('#selected-portrait').evaluate(i=>i.decode());await page.screenshot({path:out+'/selection-desktop.png'});
 for(const id of label==='local'?['cast.14','cast.01','cast.27']:['cast.27']){
  await page.locator('[data-actor="'+id+'"]').click();assert.equal((await state()).selected,id);assert.equal(await page.locator('[data-actor="'+id+'"]').getAttribute('aria-pressed'),'true');await page.locator('#walk-enter').click();await page.waitForFunction(()=>eys.state().walk?.active||eys.state().walk?.error||eys.state().error,null,{timeout:90000});let s=await state();assert.equal(s.error,null);assert.equal(s.walk.error,null);assert.equal(s.walk.actor,id);assert.equal(s.walk.wardrobeVersion,'4.3.27');
  await page.locator('#walk-help-toggle').click();await page.locator('#walk-home').click();await page.locator('#walk-help-toggle').click();s=await state();
  const before=[...s.walk.position];await page.keyboard.down('KeyD');await page.waitForTimeout(450);await page.keyboard.up('KeyD');await page.waitForTimeout(120);s=await state();assert(s.walk.position[0]>before[0]+.25);assert(await page.locator('#walk-fan-notice').isVisible());await page.screenshot({path:out+'/walk-'+id+'.png'});evidence.push({actor:id,modules:s.walk.modules,position:s.walk.position,drawCalls:s.walk.drawCalls});
  if(id==='cast.14'){
   await page.keyboard.down('KeyD');await page.waitForFunction(()=>eys.state().walk.area.id==='09',null,{timeout:10000});await page.keyboard.up('KeyD');await page.keyboard.press('KeyE');assert(await page.locator('#walk-info').isVisible());await page.keyboard.press('Escape');
  }
  await page.locator('#walk-exit').click();assert(!(await state()).walk.active);assert(await page.locator('#character-grid').isVisible());
 }
 await page.setViewportSize({width:390,height:844});await page.goto(new URL('?actor=cast.14&walk=1',url).href);await page.waitForFunction(()=>window.eys?.state().ready,null,{timeout:60000});assert.equal((await state()).walk,null,'URL still lets visitors choose before entering');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#selected-portrait').evaluate(i=>i.decode());await page.screenshot({path:out+'/selection-mobile.png',fullPage:true});
 await page.locator('[data-actor="cast.14"]').click();await page.locator('#walk-enter').click();await page.waitForFunction(()=>eys.state().walk?.active,null,{timeout:90000});assert(await page.locator('.walk-pad').isVisible());let p=await page.locator('[data-move="KeyD"]').boundingBox();const start=(await state()).walk.position[0];await page.mouse.move(p.x+p.width/2,p.y+p.height/2);await page.mouse.down();await page.waitForTimeout(450);await page.mouse.up();assert((await state()).walk.position[0]>start+.25);assert.equal((await state()).walk.touches,0);await page.screenshot({path:out+'/walk-mobile.png'});
 await page.locator('#walk-exit').click();assert(await page.locator('#character-grid').isVisible());assert.deepEqual(errors,[]);await fs.writeFile(out+'/smoke.json',JSON.stringify({passed:true,url,errors,evidence,checks:['27 selectable portraits with no model preload','Chosen current wardrobe models enter and move; character switching works','Fan-work notice and room interaction','390px selection, explicit entry even with walk query, mobile controls and return']},null,2)+'\n');console.log('EYS_SMOKE_PASS',label);
}finally{await browser.close();}
