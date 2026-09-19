import * as THREE from 'three';
import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';
import {findPath,pickWanderTarget,moveCircle} from './map-walk-simulation.js';
import {IMMERSION_CONFIG} from './immersion-config.js';

// B4 walk-NPC townsfolk (design-npc-wander.md): roaming extras for free roam.
// Owns only what it creates — its avatars and one DOM bubble layer — so every
// cleanup path (busy hide, walk exit, load abort) can restore the shared scene
// exactly. All randomness comes from one seeded LCG so a run replays.
const makeRng=seed=>{let s=(seed*2654435761)>>>0;return()=>{s=(Math.imul(s,1103515245)+12345)>>>0;return s/4294967296;};};
const span=(rng,range)=>range[0]+rng()*(range[1]-range[0]);

export function createWalkNpcs({scene,nav,config,getPlayerPosition,getPlayerActor,isMobile=()=>false,reducedMotion=false,camera,host}){
 const list=[];let started=false,hidden=false,bubblesSuppressed=false,bubbleLayer=null,loadToken=0,activeLoads=0,queue=[],activeCount=0,rng=makeRng(20260920);
 const spawnPoint=()=>{
  const from=getPlayerPosition?.()||nav.spawn;
  return pickWanderTarget(nav,rng,{minDistance:config.spawnMinDistance,from})||[...nav.spawn];
 };
 function pump(){
  if(!started)return;
  while(activeLoads<IMMERSION_CONFIG.maxConcurrentActorLoads&&queue.length){
   const actorId=queue.shift(),token=loadToken;activeLoads++;
   loadWalkingAvatar(actorId).then(avatar=>{
    activeLoads--;
    if(token!==loadToken){disposeWalkingAvatar(avatar);pump();return;} // stop() raced the load
    const box=new THREE.Box3().setFromObject(avatar.visual);
    avatar.player.visible=!hidden;scene.add(avatar.player);
    const pos=spawnPoint();
    list.push({actorId:avatar.actorId,avatar,position:[...pos],heading:Math.PI,route:null,wp:1,pause:0,distance:0,moving:false,stuck:0,
     bubbleText:null,bubbleT:0,cooldown:span(rng,config.bubble.cooldown),el:null,headY:box.max.y});
    pump();
   }).catch(()=>{activeLoads--;pump();}); // one broken townsfolk must not stall the rest
  }
 }
 function chooseTarget(npc){
  const goal=pickWanderTarget(nav,rng,{minDistance:2.5,from:npc.position});
  npc.route=goal?findPath(nav,npc.position,goal):null;npc.wp=1;
  if(!npc.route||npc.route.length<2){npc.route=null;npc.pause=span(rng,config.pauseRange);}
 }
 function stepNpc(npc,dt){
  if(npc.pause>0){npc.pause-=dt;npc.moving=false;}
  else{
   const player=getPlayerPosition?.();
   const near=player?Math.hypot(npc.position[0]-player[0],npc.position[1]-player[1])<config.avoidPlayerRadius:false;
   if(near){
    npc.moving=false; // wait in place; never shove the player walker
    npc.avoidT=(npc.avoidT||0)+dt;
    if(npc.avoidT>1.2){npc.avoidT=0;npc.route=null;} // waited long enough: stroll somewhere else
   }else{
    npc.avoidT=0;
    if(!npc.route)chooseTarget(npc);
    if(npc.route){
     const wp=npc.route[Math.min(npc.wp,npc.route.length-1)];
     const dx=wp[0]-npc.position[0],dz=wp[1]-npc.position[1],dist=Math.hypot(dx,dz);
     if(dist<.12){
      if(npc.wp>=npc.route.length-1){npc.route=null;npc.pause=span(rng,config.pauseRange);}
      else npc.wp++;
      npc.moving=false;
     }else{
      const step=Math.min(config.speed*dt,dist);
      if(step>1e-4){
       const before=[...npc.position],result=moveCircle(nav,npc.position,[dx/dist*step,dz/dist*step]);
       npc.position=result.position;
       const travel=Math.hypot(npc.position[0]-before[0],npc.position[1]-before[1]);
       npc.moving=travel>1e-5;npc.distance+=travel;
       if(npc.moving)npc.heading=Math.atan2(dx,dz);
       else{npc.stuck+=dt;if(npc.stuck>.5){npc.stuck=0;npc.route=null;npc.pause=.4+rng();}} // wedged: give up and re-plan
      }
     }
    }else npc.moving=false;
   }
  }
  const a=npc.avatar;
  if(a){
   a.player.position.set(npc.position[0],nav.heightAt(npc.position),npc.position[1]);
   const angle=Math.atan2(Math.sin(npc.heading-a.visual.rotation.y),Math.cos(npc.heading-a.visual.rotation.y));
   a.visual.rotation.y+=angle*Math.min(1,dt*18);
   a.model.rotation.z=!reducedMotion&&npc.moving?Math.sin(npc.distance*15)*.045:0;
   a.visual.position.y=!reducedMotion&&npc.moving?Math.abs(Math.sin(npc.distance*15))*.025:0;
  }
  if(npc.bubbleT>0){npc.bubbleT-=dt;if(npc.bubbleT<=0){npc.bubbleText=null;npc.cooldown=span(rng,config.bubble.cooldown);}}
  else if(config.bubble.pool.length){npc.cooldown-=dt;if(npc.cooldown<=0){npc.bubbleText=config.bubble.pool[Math.floor(rng()*config.bubble.pool.length)];npc.bubbleT=config.bubble.duration;}}
 }
 function ensureBubbles(){
  if(bubbleLayer||!host)return;
  bubbleLayer=document.createElement('div');
  bubbleLayer.id='walk-npc-bubbles';bubbleLayer.setAttribute('aria-hidden','true');
  Object.assign(bubbleLayer.style,{position:'absolute',inset:'0',overflow:'hidden',pointerEvents:'none',zIndex:'2'});
  host.appendChild(bubbleLayer);syncLayerHidden();
 }
 function bubbleEl(npc){
  if(npc.el)return npc.el;
  const el=document.createElement('div');
  Object.assign(el.style,{position:'absolute',transform:'translate(-50%,-100%)',display:'none',whiteSpace:'nowrap',
   background:'#1d3336e8',color:'#ffe3a3',font:'12px/1.4 system-ui,\'Segoe UI\',\'Microsoft YaHei\',sans-serif',padding:'5px 10px',borderRadius:'12px'});
  bubbleLayer.appendChild(el);npc.el=el;return el;
 }
 const projected=new THREE.Vector3();
 function updateBubbles(){
  if(!bubbleLayer)return;
  camera.updateMatrixWorld();camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const w=host.clientWidth,h=host.clientHeight;
  for(const npc of list){
   const el=npc.el||bubbleEl(npc);
   let show=!hidden&&!bubblesSuppressed&&npc.bubbleText&&npc.avatar;
   if(show){
    projected.set(npc.position[0],nav.heightAt(npc.position)+npc.headY+.18,npc.position[1]).project(camera);
    if(projected.z>1||projected.z<-1)show=false;
    else{
     const x=(projected.x*.5+.5)*w,y=(-projected.y*.5+.5)*h;
     if(x<-90||x>w+90||y<-50||y>h+50)show=false;
     else{el.style.display='block';el.style.left=x+'px';el.style.top=y+'px';el.textContent=npc.bubbleText;}
    }
   }
   if(!show)el.style.display='none'; // direct show/hide: no transition, reduced-motion safe by construction
  }
 }
 function syncLayerHidden(){if(bubbleLayer)bubbleLayer.hidden=hidden||bubblesSuppressed;}
 function start(){
  if(started||!nav)return;started=true;
  activeCount=isMobile()?config.mobileCount:config.count;
  queue=IMMERSION_CONFIG.rosterCandidates.filter(id=>id!==getPlayerActor?.()).slice(0,activeCount);
  pump();
 }
 function update(dt){
  if(!started)return;
  pump();ensureBubbles();
  for(const npc of list)stepNpc(npc,dt);
  updateBubbles();
 }
 function setHidden(next){
  if(hidden===next)return;hidden=next;
  for(const npc of list)if(npc.avatar)npc.avatar.player.visible=!hidden;
  syncLayerHidden();
 }
 function setBubblesHidden(next){if(bubblesSuppressed===next)return;bubblesSuppressed=next;syncLayerHidden();}
 function stop(){
  started=false;loadToken++;queue=[];activeLoads=0;
  for(const npc of list){if(npc.avatar){scene.remove(npc.avatar.player);disposeWalkingAvatar(npc.avatar);}npc.avatar=null;if(npc.el)npc.el.remove();}
  list.length=0;
  if(bubbleLayer){bubbleLayer.remove();bubbleLayer=null;}
  hidden=false;bubblesSuppressed=false;rng=makeRng(20260920);
 }
 const state=()=>({
  count:activeCount,loaded:list.length,hidden,
  npcs:list.map(n=>({actor:n.actorId,position:[n.position[0],n.position[1]],moving:n.moving,bubble:n.bubbleText})),
 });
 return {start,update,setHidden,setBubblesHidden,stop,state};
}
