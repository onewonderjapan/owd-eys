import * as THREE from 'three';
import {createNavigation,createWalker} from './map-walk-simulation.js';
import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';

// Explicit boundary between overview controls and the flat walking simulation.
export function installMapWalk({data,root,scene,camera,controls,renderer,render,resize,host,highlight,getActor=()=> 'cast.14'}){
 const $=s=>document.querySelector(s),keys=new Set(),touches=new Map();
 const enter=$('#walk-enter'),exit=$('#walk-exit'),hud=$('#walk-hud'),info=$('#walk-info'),prompt=$('#walk-prompt');
 let nav,walker,avatar,loading=false,active=false,paused=false,failure=null,saved=null,raf=0,last=0,frame=0;
 const target=new THREE.Vector3(),offset=new THREE.Vector3(0,13,9),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const movement=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight']);
 const note={
  '01':'西北角的酒馆。沿斜角门口进出，绕过吧台和木桶。','02':'镇长的办公室，书桌位于房间北侧。','03':'两把理发椅并排，入口朝向南侧街道。',
  '04':'法院的长厅，门口设在东南侧；前方为长椅与审判席。','05':'礼拜堂，南侧小门厅连接广场，北侧保留狭长附室。','06':'银行的柜台与保险箱；从南侧小门厅回到街道。',
  '07':'警察局的办公桌与牢房隔栏。','08':'仓库有北侧和东侧两个门口，堆放木箱与木桶。','09':'港口办公室，西门通往进出口，南边就是码头。',
  '10':'原图的开膛手棚屋。当前室内沿用裁缝陈设。','11':'西侧长屋的门朝东，吧台与木桶分布在狭长室内。'
 };
 function clearInput(){keys.clear();touches.clear();for(const b of document.querySelectorAll('[data-move]'))b.removeAttribute('data-down');if(walker)walker.state.moving=false;}
 function updateHud(){
  const s=walker.state;$('#walk-area').textContent=s.area.label;$('#walk-visited').textContent=`已到访 ${s.visited.size} / 11`;
  const near=s.near;prompt.hidden=!near;prompt.textContent=near?'入口 · '+near.label:'';
  $('#walk-inspect').disabled=s.area.kind!=='room'&&!near;
 }
 function inspect(){
  if(!active)return;const s=walker.state,id=s.area.kind==='room'?s.area.id:s.near?.room;if(!id)return;
  clearInput();$('#walk-info-title').textContent=nav.rooms.find(r=>r.id===id).label;$('#walk-info-text').textContent=note[id];info.hidden=false;
 }
 function frameLoop(time){
  if(!active)return;const dt=Math.min((time-last)/1000,.05)||0;last=time;
  const values=new Set([...keys,...touches.values()]);const x=Number(values.has('KeyD')||values.has('ArrowRight'))-Number(values.has('KeyA')||values.has('ArrowLeft')),z=Number(values.has('KeyS')||values.has('ArrowDown'))-Number(values.has('KeyW')||values.has('ArrowUp'));
  const s=walker.step(paused||!info.hidden?[0,0]:[x,z],dt);
  avatar.player.position.set(s.position[0],nav.heightAt(s.position),s.position[1]);
  const angle=Math.atan2(Math.sin(s.heading-avatar.visual.rotation.y),Math.cos(s.heading-avatar.visual.rotation.y));avatar.visual.rotation.y+=angle*Math.min(1,dt*18);
  avatar.model.rotation.z=!reduced&&s.moving?Math.sin(s.distance*15)*.045:0;
  avatar.visual.position.y=!reduced&&s.moving?Math.abs(Math.sin(s.distance*15))*.025:0;
  const aim=new THREE.Vector3(s.position[0],.2,s.position[1]);target.lerp(aim,1-Math.exp(-dt*12));camera.position.copy(target).add(offset);camera.lookAt(target);
  if(++frame%3===0)updateHud();render();raf=requestAnimationFrame(frameLoop);
 }
 function projection(){if(!active)return false;const w=host.clientWidth,h=host.clientHeight,width=w/h<1?8.5:12.5;camera.left=-width/2;camera.right=width/2;camera.top=width*h/w/2;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();return true;}
 async function start(){
  if(active||loading)return;loading=true;failure=null;enter.disabled=true;enter.textContent='正在准备角色…';$('#walk-error').hidden=true;
  try{
   if(!walker){const response=await fetch('map-walk-props.json');if(!response.ok)throw Error('碰撞数据未能打开');const props=await response.json();if(props.map_id!==data.id||props.source_blend_sha256!==data.report.blend_sha256)throw Error('碰撞数据与当前地图版本不一致');nav=createNavigation(data.layout,props);walker=createWalker(nav);}
   const actorId=getActor();
   if(!avatar||avatar.actorId!==actorId){const next=await loadWalkingAvatar(actorId);if(avatar){scene.remove(avatar.player);disposeWalkingAvatar(avatar);}avatar=next;scene.add(avatar.player);}
   saved={position:camera.position.clone(),target:controls.target.clone(),zoom:camera.zoom,up:camera.up.clone(),pixelRatio:renderer.getPixelRatio(),scroll:scrollY,visible:[],highlight:highlight.visible};highlight.visible=false;
   root.traverse(o=>{if(o.userData.map_category==='characters'){saved.visible.push([o,o.visible]);o.visible=false;}});
   controls.enabled=false;active=true;paused=false;clearInput();avatar.player.visible=true;
   document.body.classList.add('walking');hud.hidden=false;info.hidden=true;$('#walk-help').hidden=true;$('#walk-paused').hidden=true;
   renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));resize();projection();
   target.set(walker.state.position[0],.2,walker.state.position[1]);camera.position.copy(target).add(offset);camera.lookAt(target);updateHud();
   host.tabIndex=0;host.focus({preventScroll:true});last=performance.now();raf=requestAnimationFrame(frameLoop);
   const url=new URL(location.href);url.searchParams.set('actor',actorId);history.replaceState(null,'',url);
  }catch(e){failure=e.message;$('#walk-error').textContent='行走模式未能打开：'+failure;$('#walk-error').hidden=false;}
  finally{loading=false;enter.disabled=false;enter.textContent='带 TA 进入小镇 ↗';}
 }
 function stop(){
  if(!active)return;active=false;clearInput();cancelAnimationFrame(raf);avatar.player.visible=false;document.body.classList.remove('walking');hud.hidden=true;info.hidden=true;
  for(const [o,visible] of saved.visible)o.visible=visible;highlight.visible=saved.highlight;
  controls.enabled=true;controls.target.copy(saved.target);camera.position.copy(saved.position);camera.up.copy(saved.up);camera.zoom=saved.zoom;renderer.setPixelRatio(saved.pixelRatio);resize();controls.update();render();
  const url=new URL(location.href);url.searchParams.delete('walk');history.replaceState(null,'',url);scrollTo(0,saved.scroll);enter.focus({preventScroll:true});
 }
 function pause(){if(!active)return;paused=true;clearInput();$('#walk-paused').hidden=false;}
 function resume(){if(!active)return;paused=false;clearInput();$('#walk-paused').hidden=true;last=performance.now();}
 window.addEventListener('blur',pause);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',()=>document.hidden?pause():resume());
 window.addEventListener('keydown',e=>{
  if(!active||e.target.closest('input,textarea,select'))return;
  if(movement.has(e.code)){e.preventDefault();if(!paused&&info.hidden&&!e.target.closest('button'))keys.add(e.code);}
  else if(e.code==='Escape'){e.preventDefault();if(!info.hidden)info.hidden=true;else if(!$('#walk-help').hidden)$('#walk-help').hidden=true;else stop();}
  else if(e.code==='KeyE'&&!e.repeat){e.preventDefault();inspect();}
 });
 window.addEventListener('keyup',e=>{if(movement.has(e.code)){keys.delete(e.code);if(active)e.preventDefault();}});
 for(const b of document.querySelectorAll('[data-move]')){
  b.addEventListener('pointerdown',e=>{if(!active)return;e.preventDefault();b.setPointerCapture(e.pointerId);touches.set(e.pointerId,b.dataset.move);b.setAttribute('data-down','');});
  const release=e=>{touches.delete(e.pointerId);b.removeAttribute('data-down');};for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,release);
 }
 enter.onclick=start;exit.onclick=stop;$('#walk-inspect').onclick=inspect;
 $('#walk-info-close').onclick=()=>{info.hidden=true;host.focus({preventScroll:true});};
 $('#walk-help-toggle').onclick=()=>{clearInput();$('#walk-help').hidden=!$('#walk-help').hidden;host.focus({preventScroll:true});};
 $('#walk-home').onclick=()=>{clearInput();walker.reset();target.set(walker.state.position[0],.2,walker.state.position[1]);info.hidden=true;host.focus({preventScroll:true});};
 renderer.domElement.addEventListener('webglcontextlost',()=>{pause();$('#walk-paused').textContent='画面暂时中断，正在恢复…';});
 renderer.domElement.addEventListener('webglcontextrestored',()=>{resume();$('#walk-paused').textContent='已暂停 · 回到窗口继续';render();});
 enter.disabled=false;
 const state=()=>({active,loading,error:failure,paused,version:'map_walk_v1',actor:avatar?.actorId,wardrobeVersion:avatar?.version,modules:avatar?.modules,position:walker?[...walker.state.position]:null,area:walker?.state.area,visited:walker?[...walker.state.visited]:[],moving:walker?.state.moving,blocked:walker?.state.blocked,distance:walker?.state.distance,keys:[...keys],touches:touches.size,near:walker?.state.near?.room,cameraTarget:target.toArray(),drawCalls:renderer.info.render.calls});
 return {start,stop,projection,state};
}
