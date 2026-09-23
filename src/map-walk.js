import * as THREE from 'three';
import {createNavigation,createWalker} from './map-walk-simulation.js';
import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';
import {createWalkView} from './map-walk-view.js';
import {createPropLibrary} from './immersion-props.js';
import {IMMERSION_CONFIG,WALK_NPC_CONFIG} from './immersion-config.js';
import {createWalkNpcs} from './walk-npcs.js';
import {createImmersionDirector} from './immersion-director.js';
import {createWalkAudio} from './walk-audio.js';

// Explicit boundary between overview controls and the flat walking simulation.
export function installMapWalk({data,root,scene,camera,controls,renderer,render,resize,host,highlight,getActor=()=> 'cast.14',describeActor=()=> null}){
 const $=s=>document.querySelector(s),keys=new Set(),touches=new Map();
 const enter=$('#walk-enter'),exit=$('#walk-exit'),hud=$('#walk-hud'),info=$('#walk-info'),prompt=$('#walk-prompt');
 let nav,walker,avatar,loading=false,active=false,paused=false,failure=null,saved=null,raf=0,last=0,frame=0;
 let director=null,propsStarted=false,immersionSnapshot=null,npcs=null;
 let photoMode=false,dusk=false,duskSaved=null;
 const propsLibrary=createPropLibrary();
 const walkAudio=createWalkAudio();
 const target=new THREE.Vector3(),offset=new THREE.Vector3(0,13,9),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const movement=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight']);
 const view=createWalkView({overview:camera,host,canvas:renderer.domElement,getAvatar:()=>avatar,getWalker:()=>walker,isActive:()=>active,canLook:()=>active&&!paused&&info.hidden&&$('#walk-help').hidden&&!(director&&director.busy),canChange:()=>!(director&&director.busy),clearInput});
 const note={
  '01':'西北角的酒馆。沿斜角门口进出，绕过吧台和木桶。','02':'镇长的办公室，书桌位于房间北侧。','03':'两把理发椅并排，入口朝向南侧街道。',
  '04':'法院的长厅，门口设在东南侧；前方为长椅与审判席。','05':'礼拜堂，南侧小门厅连接广场，北侧保留狭长附室。','06':'银行的柜台与保险箱；从南侧小门厅回到街道。',
  '07':'警察局的办公桌与牢房隔栏。','08':'仓库有北侧和东侧两个门口，堆放木箱与木桶。','09':'港口办公室，西门通往进出口，南边就是码头。',
  '10':'原图的开膛手棚屋。当前室内沿用裁缝陈设。','11':'西侧长屋的门朝东，吧台与木桶分布在狭长室内。'
 };
 // Photo mode (B2): CSS-hides every control but keeps the noncommercial notice,
 // lets the player keep looking around to compose, and exports the live frame.
 function enterPhoto(){
  if(!active||photoMode||(director&&director.busy))return;
  if(!$('#walk-photo-bar'))return; // old cached HTML: photo UI not present
  clearInput();info.hidden=true;$('#walk-help').hidden=true; // canLook() keys off these
  photoMode=true;
  hud.classList.add('photo');host.classList.add('photo-frame');
  $('#walk-photo-bar').hidden=false;
  npcs?.setBubblesHidden(true); // photo mode keeps townsfolk visible but caption-free
  syncPhotoButton();
  host.focus({preventScroll:true});
 }
 function exitPhoto(){
  if(!photoMode)return;photoMode=false;
  hud.classList.remove('photo');host.classList.remove('photo-frame');
  const bar=$('#walk-photo-bar');if(bar)bar.hidden=true;
  npcs?.setBubblesHidden(false);
  syncPhotoButton();
  host.focus({preventScroll:true});
 }
 function syncPhotoButton(){const b=$('#walk-photo');if(b)b.setAttribute('aria-pressed',String(photoMode));}
 function exportPhoto(){
  if(!photoMode)return;
  render();
  const area=walker?.state?.area?.id||'photo';
  const a=document.createElement('a');
  a.href=renderer.domElement.toDataURL('image/png');
  a.download='goosechapel-'+area+'.png';
  document.body.append(a);a.click();a.remove();
  exitPhoto();
 }
 // Dusk mood (B3): lights and background only — no texture/material changes,
 // fully reversible. Persist through immersion (the bell ring shares this
 // scene) and restore when leaving walk so the main page is untouched.
 function setDusk(next){
  if(next===dusk)return;dusk=next;
  stopFlicker(); // never snapshot flicker-dimmed intensities as the dusk baseline
  if(next){
   duskSaved={bg:scene.background&&scene.background.isColor?scene.background.getHex():null,hemis:[],dirls:[]};
   for(const o of scene.children){
    if(o.isHemisphereLight){duskSaved.hemis.push({o,color:o.color.getHex(),ground:o.groundColor.getHex(),intensity:o.intensity});o.color.set('#7d6aa8');o.groundColor.set('#4a3f3d');o.intensity*=.85;}
    else if(o.isDirectionalLight){duskSaved.dirls.push({o,color:o.color.getHex(),intensity:o.intensity});o.color.set('#ffb26b');o.intensity*=.7;}
   }
   if(duskSaved.bg!==null)scene.background.set('#3d3654');
  }else if(duskSaved){
   if(duskSaved.bg!==null&&scene.background&&scene.background.isColor)scene.background.setHex(duskSaved.bg);
   for(const h of duskSaved.hemis){h.o.color.setHex(h.color);h.o.groundColor.setHex(h.ground);h.o.intensity=h.intensity;}
   for(const d of duskSaved.dirls){d.o.color.setHex(d.color);d.o.intensity=d.intensity;}
   duskSaved=null;
  }
 }
 // B7 flicker (design-flicker.md): approaching the emergency-button table dips
 // the top-level lights and restores them exactly. Intensity-only; no light or
 // prop objects are created or destroyed; never runs during busy.
 let flickerSaved=null,flickerT=0,flickerArmed=true,flickerCount=0,flickerMin=1,flickerReduced=false;
 const flickerLights=()=>scene.children.filter(o=>o.isHemisphereLight||o.isDirectionalLight);
 function startFlicker(){
  if(flickerSaved)return;
  flickerSaved=flickerLights().map(o=>({o,intensity:o.intensity}));
  flickerT=0;flickerMin=1;flickerReduced=reduced;
 }
 function updateFlicker(dt){
  if(!flickerSaved)return;
  flickerT+=dt;
  const f=IMMERSION_CONFIG.flicker,u=Math.min(1,flickerT/f.duration);
  const k=reduced
   ?1-Math.sin(Math.PI*u)*(1-f.reducedFloor) // one calm dim-and-return, no oscillation
   :1-(0.5-0.5*Math.cos(u*Math.PI*2*f.dips))*(1-f.floor);
  flickerMin=Math.min(flickerMin,k);
  for(const s of flickerSaved)s.o.intensity=s.intensity*k;
  if(u>=1){stopFlicker();flickerArmed=false;flickerCount++;}
 }
 function stopFlicker(){
  if(!flickerSaved)return;
  for(const s of flickerSaved)s.o.intensity=s.intensity;
  flickerSaved=null;
 }
 function flickerState(){
  return flickerSaved?{active:true,t:+flickerT.toFixed(2),duration:IMMERSION_CONFIG.flicker.duration,count:flickerCount,lastMin:null,lastReduced:flickerReduced}
   :{active:false,t:0,duration:IMMERSION_CONFIG.flicker.duration,count:flickerCount,lastMin:flickerCount?+flickerMin.toFixed(3):null,lastReduced:flickerReduced};
 }
 function clearInput(){keys.clear();touches.clear();for(const b of document.querySelectorAll('[data-move]'))b.removeAttribute('data-down');if(walker)walker.state.moving=false;}
 // Meeting triggers: the courthouse bell and the plaza fountain button.
 // Returns the matched trigger (with a UI label) or null.
 function meetingTrigger(){
  if(!director||director.busy||!nav||!walker||paused)return null;
  if(!propsLibrary.state().ready)return null;
  if(!info.hidden||!$('#walk-help').hidden)return null;
  const s=walker.state;
  for(const t of [IMMERSION_CONFIG.bell,IMMERSION_CONFIG.button]){
   const [ix,iz]=t.interaction;
   if(Math.hypot(s.position[0]-ix,s.position[1]-iz)>t.triggerDistance)continue;
   if(t.room){const room=nav.roomAt(s.position);if(!room||room.id!==t.room)continue;}
   return t===IMMERSION_CONFIG.bell?{label:'按铃',action:' 按铃开会'}:{label:'按下按钮',action:' 按下按钮开会'};
  }
  return null;
 }
 function nearBellPoint(){
  return meetingTrigger()!==null;
 }
 function updateHud(){
  const s=walker.state;$('#walk-area').textContent=s.area.label;$('#walk-visited').textContent=`已到访 ${s.visited.size} / 11`;
  const near=s.near;prompt.hidden=!near;prompt.textContent=near?'入口 · '+near.label:'';
  $('#walk-inspect').disabled=s.area.kind!=='room'&&!near;
  const trigger=meetingTrigger();
  director?.setNearBell(trigger?trigger.label:null);
  director?.refresh();
 }
 function inspect(){
  if(!active||!walker)return;if(director&&director.busy)return;const s=walker.state,id=s.area.kind==='room'?s.area.id:s.near?.room;if(!id)return;
  clearInput();view.unlock();$('#walk-info-title').textContent=nav.rooms.find(r=>r.id===id).label;$('#walk-info-text').textContent=note[id];info.hidden=false;
 }
 function restoreImmersion(){
  const snap=immersionSnapshot;
  immersionSnapshot=null;clearInput();
  if(!snap||!active)return;
  view.restore(snap);
  if(walker&&nav)view.update(walker.state.position,nav.heightAt(walker.state.position));
  info.hidden=true;$('#walk-help').hidden=true;$('#walk-paused').hidden=!paused;
  host.tabIndex=0;host.focus({preventScroll:true});render();
 }
 function beginImmersion(){
  if(!director||director.busy||!walker)return;
  exitPhoto(); // #immersion-ui is outside #walk-hud; a session must never start inside photo mode
  clearInput();view.unlock();
  npcs?.setHidden(true); // townsfolk step off before the bell finishes ringing; the busy branch keeps this true
  const snap=view.snapshot();
  director.begin().then(accepted=>{
   if(accepted)immersionSnapshot=snap;
  });
 }
 let busyHudHidden=false;
 let busyScaled=false;
 function updateBusyHud(busy){
  if(busy===busyHudHidden)return;busyHudHidden=busy;
  walkAudio.setDucked(busy);
  for(const el of document.querySelectorAll('.walk-pad,.walk-bottom,.walk-actions,.walk-status,#walk-prompt,#walk-photo-bar,#walk-npc-bubbles'))el.hidden=busy;
 }
 function frameLoop(time){
  if(!active)return;const dt=Math.max(0,Math.min((time-last)/1000,.05))||0;last=time;
  if(director&&director.busy){
   updateBusyHud(true);
   stopFlicker();flickerArmed=false; // performances own the lights; disarm until the player leaves
   npcs?.setHidden(true); // the cast owns the stage; townsfolk step out until roam returns
   if(avatar)avatar.player.visible=false;
   // The ejection stage draws the full cast plus effects; render at 1x during the
   // performance and restore the walk ratio on the roam path below.
   if(!busyScaled){busyScaled=true;renderer.setPixelRatio(1);resize();}
   // A throw here used to end the RAF chain: the flush stage's stray `splash`
   // reference froze the whole game 5.2s into the performance (1.4.0..1.5.0).
   // Now a broken stage ends the session and the town keeps running.
   try{director.update(paused?0:dt);}catch(err){console.error('[eys] performance frame failed; returning to roam',err);try{director.cancel('error');}catch{}}
   render();raf=requestAnimationFrame(frameLoop);return;
  }
  if(busyScaled){busyScaled=false;renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));resize();}
  updateBusyHud(false);
  npcs?.setHidden(false);
  // Roam restores the walking model after a performance hid it, but only in the
  // overview: in first person the camera sits inside the head, and forcing the
  // model visible every frame blanked the whole view (regression 2026-09-15..1.5.0).
  if(avatar){const wantAvatar=!document.body.classList.contains('first-person');if(avatar.player.visible!==wantAvatar)avatar.player.visible=wantAvatar;}
  const values=new Set([...keys,...touches.values()]);const x=Number(values.has('KeyD')||values.has('ArrowRight'))-Number(values.has('KeyA')||values.has('ArrowLeft')),z=Number(values.has('KeyS')||values.has('ArrowDown'))-Number(values.has('KeyW')||values.has('ArrowUp'));
  const s=walker.step(photoMode||paused||!info.hidden||!$('#walk-help').hidden?[0,0]:view.input(x,z),dt);
  walkAudio.frame(dt,s.moving,s.distance);
  if(!paused){
   const fb=IMMERSION_CONFIG.flicker,bi2=IMMERSION_CONFIG.button.interaction,dBtn=Math.hypot(s.position[0]-bi2[0],s.position[1]-bi2[1]);
   if(flickerSaved)updateFlicker(dt);
   else if(flickerArmed&&!photoMode&&dBtn<fb.radius)startFlicker();
   if(!flickerArmed&&!flickerSaved&&dBtn>fb.radius+fb.rearmGap)flickerArmed=true;
  }
  avatar.player.position.set(s.position[0],nav.heightAt(s.position),s.position[1]);
  const angle=Math.atan2(Math.sin(s.heading-avatar.visual.rotation.y),Math.cos(s.heading-avatar.visual.rotation.y));avatar.visual.rotation.y+=angle*Math.min(1,dt*18);
  avatar.model.rotation.z=!reduced&&s.moving?Math.sin(s.distance*15)*.045:0;
  avatar.visual.position.y=!reduced&&s.moving?Math.abs(Math.sin(s.distance*15))*.025:0;
  const aim=new THREE.Vector3(s.position[0],.2,s.position[1]);target.lerp(aim,1-Math.exp(-dt*12));camera.position.copy(target).add(offset);camera.lookAt(target);
  view.update(s.position,nav.heightAt(s.position));
  if(!paused)npcs?.update(dt); // pause (blur) freezes townsfolk by simply not ticking them
  if(++frame%3===0)updateHud();render();raf=requestAnimationFrame(frameLoop);
 }
 function projection(){if(!active)return false;const w=host.clientWidth,h=host.clientHeight,width=w/h<1?8.5:12.5;camera.left=-width/2;camera.right=width/2;camera.top=width*h/w/2;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();view.projection();director?.projection(w,h);return true;}
 function ensureDirector(){
  if(director||!nav||!walker)return director;
  director=createImmersionDirector({
   props:propsLibrary,worldScene:scene,host,canvas:renderer.domElement,
   getWalker:()=>walker,getNavigation:()=>nav,getActorId:()=>avatar?.actorId,
   describeActor,
   onEnd:restoreImmersion,
   onPropsUnavailable:()=>{propsLibrary.ensure().then(()=>director?.refreshProps()).catch(()=>{});},
  });
  director.setDescribeActor(describeActor);
  return director;
 }
 async function start(){
  if(active||loading)return;loading=true;failure=null;enter.disabled=true;enter.textContent='正在准备角色…';$('#walk-error').hidden=true;
  try{
   if(!walker){const response=await fetch(new URL('map-walk-props.json',import.meta.url));if(!response.ok)throw Error('碰撞数据未能打开');const props=await response.json();if(props.map_id!==data.id||props.source_blend_sha256!==data.report.blend_sha256)throw Error('碰撞数据与当前地图版本不一致');nav=createNavigation(data.layout,props);walker=createWalker(nav);}
   if(!propsStarted){propsStarted=true;propsLibrary.ensure().then(()=>{director?.refreshProps();}).catch(()=>{});}
   ensureDirector();
   const actorId=getActor();
   if(!avatar||avatar.actorId!==actorId){const next=await loadWalkingAvatar(actorId,(done,total)=>{enter.textContent=`正在准备角色 ${done}/${total}…`;});if(avatar){scene.remove(avatar.player);disposeWalkingAvatar(avatar);}avatar=next;scene.add(avatar.player);}
   saved={position:camera.position.clone(),target:controls.target.clone(),zoom:camera.zoom,up:camera.up.clone(),pixelRatio:renderer.getPixelRatio(),scroll:scrollY,visible:[],highlight:highlight.visible};highlight.visible=false;
   root.traverse(o=>{if(o.userData.map_category==='characters'){saved.visible.push([o,o.visible]);o.visible=false;}});
   controls.enabled=false;active=true;paused=false;clearInput();avatar.player.visible=true;
   walkAudio.start();syncMuteButton();
  // B4 townsfolk: loading starts once the player avatar is ready; the module owns
  // its own avatars exclusively and releases them all in stop().
  if(!npcs)npcs=createWalkNpcs({scene,nav,config:WALK_NPC_CONFIG,getPlayerPosition:()=>walker?[...walker.state.position]:null,getPlayerActor:()=>avatar?.actorId,isMobile:()=>matchMedia('(pointer: coarse)').matches||(host.clientWidth||innerWidth)<700,reducedMotion:reduced,camera,host});
  npcs.start();
   document.body.classList.add('walking');hud.hidden=false;info.hidden=true;$('#walk-help').hidden=true;$('#walk-paused').hidden=true;
   view.sync();view.update(walker.state.position,nav.heightAt(walker.state.position));
   // Roam renders the full town (205k triangles, no LOD); 1x keeps the frame budget
   // sane on integrated GPUs. Slightly softer on scaled displays, much smoother motion.
   renderer.setPixelRatio(1);busyScaled=false;resize();projection();
   target.set(walker.state.position[0],.2,walker.state.position[1]);camera.position.copy(target).add(offset);camera.lookAt(target);updateHud();
   host.tabIndex=0;host.focus({preventScroll:true});last=performance.now();raf=requestAnimationFrame(frameLoop);
   const url=new URL(location.href);url.searchParams.set('actor',actorId);history.replaceState(null,'',url);
  }catch(e){failure=e.message;$('#walk-error').textContent='行走模式未能打开：'+failure;$('#walk-error').hidden=false;}
  finally{loading=false;enter.disabled=false;enter.textContent='带 TA 进入小镇 ↗';}
 }
 function stop(){
  if(!active)return;active=false;
  if(director&&director.busy)director.cancel('stop');
  walkAudio.stop();exitPhoto();setDusk(false);syncDuskButton();stopFlicker();
  npcs?.stop();npcs=null; // exit walk: townsfolk and their bubble layer go with it
  immersionSnapshot=null;updateBusyHud(false);
  clearInput();view.unlock();view.sync();cancelAnimationFrame(raf);avatar.player.visible=false;document.body.classList.remove('walking');hud.hidden=true;info.hidden=true;
  for(const [o,visible] of saved.visible)o.visible=visible;highlight.visible=saved.highlight;
  controls.enabled=true;controls.target.copy(saved.target);camera.position.copy(saved.position);camera.up.copy(saved.up);camera.zoom=saved.zoom;renderer.setPixelRatio(saved.pixelRatio);resize();controls.update();render();
  const url=new URL(location.href);url.searchParams.delete('walk');history.replaceState(null,'',url);scrollTo(0,saved.scroll);enter.focus({preventScroll:true});
 }
 function pause(){if(!active)return;paused=true;clearInput();view.unlock();$('#walk-paused').hidden=false;director?.pause();walkAudio.pause();}
 function resume(){if(!active)return;paused=false;clearInput();$('#walk-paused').hidden=true;last=performance.now();director?.resume();walkAudio.resume();}
 window.addEventListener('blur',pause);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',()=>document.hidden?pause():resume());
 window.addEventListener('keydown',e=>{
  if(!active||e.target.closest('input,textarea,select'))return;
  if(photoMode){
   if(e.code==='Escape'){e.preventDefault();exitPhoto();}
   else if(e.code==='Enter'){e.preventDefault();exportPhoto();}
   return;
  }
  if(director&&director.busy){
   // only swallow keys this handler consumes (movement + Escape); let Tab and
   // other focus-navigation keys through so keyboard users can reach the
   // immersion UI buttons
   if(e.code==='Escape'&&!document.pointerLockElement){e.preventDefault();director.cancel('escape');}
   else if(movement.has(e.code))e.preventDefault();
   return;
  }
  if(movement.has(e.code)){e.preventDefault();if(!paused&&info.hidden&&!e.target.closest('button'))keys.add(e.code);}
  else if(e.code==='Escape'){e.preventDefault();if(view.escape())return;if(!info.hidden)info.hidden=true;else if(!$('#walk-help').hidden)$('#walk-help').hidden=true;else stop();}
  else if(e.code==='KeyE'&&!e.repeat){e.preventDefault();if(nearBellPoint())beginImmersion();else inspect();}
  else if(e.code==='KeyV'&&!e.repeat){e.preventDefault();view.change();}
  else if(e.code==='KeyP'&&!e.repeat){e.preventDefault();enterPhoto();}
  else if(e.code==='KeyF'&&!e.repeat){e.preventDefault();setDusk(!dusk);syncDuskButton();}
 });
 window.addEventListener('keyup',e=>{if(movement.has(e.code)){keys.delete(e.code);if(active)e.preventDefault();}});
 for(const b of document.querySelectorAll('[data-move]')){
  b.addEventListener('pointerdown',e=>{if(!active||paused||(director&&director.busy))return;e.preventDefault();b.setPointerCapture(e.pointerId);touches.set(e.pointerId,b.dataset.move);b.setAttribute('data-down','');});
  const release=e=>{touches.delete(e.pointerId);b.removeAttribute('data-down');};for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,release);
 }
 exit.onclick=stop;$('#walk-inspect').onclick=inspect;
 const muteButton=$('#walk-mute');
 function syncMuteButton(){if(!muteButton)return;muteButton.setAttribute('aria-pressed',String(!walkAudio.isMuted()));muteButton.textContent=walkAudio.isMuted()?'声音：关':'声音：开';}
 if(muteButton)muteButton.onclick=()=>{walkAudio.setMuted(!walkAudio.isMuted());syncMuteButton();host.focus({preventScroll:true});};
 syncMuteButton();
 const photoButton=$('#walk-photo');
 if(photoButton){photoButton.onclick=enterPhoto;$('#walk-photo-save').onclick=exportPhoto;$('#walk-photo-exit').onclick=exitPhoto;}
 const duskButton=$('#walk-dusk');
 function syncDuskButton(){if(duskButton)duskButton.setAttribute('aria-pressed',String(dusk));}
 if(duskButton)duskButton.onclick=()=>{setDusk(!dusk);syncDuskButton();host.focus({preventScroll:true});};
 syncDuskButton();
 $('#walk-info-close').onclick=()=>{info.hidden=true;host.focus({preventScroll:true});};
 $('#walk-help-toggle').onclick=()=>{if(director&&director.busy)return;clearInput();view.unlock();$('#walk-help').hidden=!$('#walk-help').hidden;host.focus({preventScroll:true});};
 $('#walk-home').onclick=()=>{if(director&&director.busy)return;clearInput();walker.reset();target.set(walker.state.position[0],.2,walker.state.position[1]);info.hidden=true;host.focus({preventScroll:true});};
 renderer.domElement.addEventListener('webglcontextlost',()=>{pause();$('#walk-paused').textContent='画面暂时中断，正在恢复…';});
 renderer.domElement.addEventListener('webglcontextrestored',()=>{resume();$('#walk-paused').textContent='已暂停 · 回到窗口继续';render();});
 enter.disabled=false;
 const state=()=>({active,loading,error:failure,paused,version:'map_walk_v3',actor:avatar?.actorId,wardrobeVersion:avatar?.version,modules:avatar?.modules,position:walker?[...walker.state.position]:null,area:walker?.state.area,visited:walker?[...walker.state.visited]:[],moving:walker?.state.moving,blocked:walker?.state.blocked,distance:walker?.state.distance,keys:[...keys],touches:touches.size,near:walker?.state.near?.room,cameraTarget:target.toArray(),view:view.state(),avatarVisible:avatar?.player.visible,drawCalls:renderer.info.render.calls,memory:{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures},immersion:director?director.state():null,nearBell:nearBellPoint(),props:propsLibrary.state(),audio:walkAudio.state(),npcs:npcs?npcs.state():null,photo:photoMode,dusk,duskBg:scene.background&&scene.background.isColor?scene.background.getHexString():null,flicker:flickerState(),lights:flickerLights().map(o=>+o.intensity.toFixed(4))});
 return {start,stop,projection,state,get camera(){return view.camera;},get renderTarget(){return director&&director.busy?director.renderTarget:null;}};
}
