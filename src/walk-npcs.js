import * as THREE from 'three';
import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';
import {createWanderGraph,moveCircle} from './map-walk-simulation.js';
import {IMMERSION_CONFIG} from './immersion-config.js';

// B4 walk-NPC townsfolk (design-npc-wander.md): roaming extras for free roam.
// Owns only what it creates — its avatars and one DOM bubble layer — so every
// cleanup path (busy hide, walk exit, load abort) can restore the shared scene
// exactly. All randomness comes from one seeded LCG so a run replays.
const makeRng=seed=>{let s=(seed*2654435761)>>>0;return()=>{s=(Math.imul(s,1103515245)+12345)>>>0;return s/4294967296;};};
const span=(rng,range)=>range[0]+rng()*(range[1]-range[0]);

export function createWalkNpcs({scene,nav,config,getPlayerPosition,getPlayerActor,isMobile=()=>false,reducedMotion=false,camera,host}){
 const list=[];let started=false,hidden=false,bubblesSuppressed=false,bubbleLayer=null,loadToken=0,activeLoads=0,queue=[],activeCount=0,rng=makeRng(20260920),graph=null;
 // Stroll targets come from the walk-start wander graph (see createWanderGraph):
 // routing over its precomputed cells costs ~2ms instead of the ~73ms median a
 // full findPath needed, which matters because this runs inside the RAF tick.
 const spawnPoint=()=>{
  const from=getPlayerPosition?.()||nav.spawn;
  return graph?.sample(rng,{minDistance:config.spawnMinDistance,from})?.position||[...nav.spawn];
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
 const dist2=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 // Stroll goals respect the player: never a spot inside playerClearance, and
 // never a first leg that closes in on them. (Review 2026-09-22: a townsperson
 // parked 0.9 in front of the first-person camera and, because the old wait
 // branch only cleared its route without ever picking a new one, stayed there
 // for as long as the player stood still.)
 const acceptFor=(npc,player)=>(pos,route)=>{
  if(!player)return true;
  if(dist2(pos,player)<config.playerClearance)return false;
  const first=route[Math.min(1,route.length-1)],dFirst=dist2(first,player);
  return !(dFirst<config.personalSpace&&dFirst<dist2(npc.position,player));
 };
 function chooseTarget(npc,player){
  const picked=graph?.sample(rng,{minDistance:2.5,from:npc.position,accept:acceptFor(npc,player)});
  npc.route=picked&&picked.route.length>=2?picked.route:null;npc.wp=1;
  if(!npc.route)npc.pause=span(rng,config.pauseRange); // nothing acceptable right now: idle, retry after the pause
  return Boolean(npc.route);
 }
 // Another townsperson within npcSpacing and ahead of our heading: yield to them.
 function peerAhead(npc,ux,uz){
  for(const other of list){
   if(other===npc||!other.avatar)continue;
   const ox=other.position[0]-npc.position[0],oz=other.position[1]-npc.position[1];
   if(Math.hypot(ox,oz)<config.npcSpacing&&ox*ux+oz*uz>0)return true;
  }
  return false;
 }
 function stepNpc(npc,dt){
  npc.rerouteT=Math.max(0,(npc.rerouteT||0)-dt);
  const player=getPlayerPosition?.();
  const dPlayer=player?dist2(npc.position,player):Infinity;
  const crowding=dPlayer<config.avoidPlayerRadius;
  if(crowding&&npc.pause>0)npc.pause=0; // the player walked up to a resting townsperson: cut the rest short and give way
  if(npc.pause>0){npc.pause-=dt;npc.moving=false;}
  else{
   if(crowding){
    // Inside the player's bubble we never wait indefinitely: retreat along a
    // route that opens distance, and re-pick after a short grace if it does not.
    npc.avoidT=(npc.avoidT||0)+dt;
    if(!npc.route||npc.avoidT>config.avoidWait){npc.avoidT=0;if(!chooseTarget(npc,player))npc.pause=.5;}
   }else{
    npc.avoidT=0;
    if(!npc.route)chooseTarget(npc,player);
    else if(player&&npc.rerouteT<=0){
     // Proactive: the next leg would end inside the player's personal space -> re-plan now.
     const wp=npc.route[Math.min(npc.wp,npc.route.length-1)],dWp=dist2(wp,player);
     if(dWp<config.personalSpace&&dWp<dPlayer){npc.rerouteT=config.retargetCooldown;chooseTarget(npc,player);}
    }
   }
   if(npc.route&&npc.pause<=0){
    const wp=npc.route[Math.min(npc.wp,npc.route.length-1)];
    const dx=wp[0]-npc.position[0],dz=wp[1]-npc.position[1],dist=Math.hypot(dx,dz);
    if(dist<.12){
     if(npc.wp>=npc.route.length-1){npc.route=null;npc.pause=span(rng,config.pauseRange);}
     else npc.wp++;
     npc.moving=false;
    }else{
     const ux=dx/dist,uz=dz/dist;
     // While crowding the player only steps that do not close in are allowed.
     const opens=!crowding||dist2([npc.position[0]+ux*.2,npc.position[1]+uz*.2],player)>dPlayer-.02;
     if(!opens||peerAhead(npc,ux,uz)){
      npc.moving=false;npc.yieldT=(npc.yieldT||0)+dt;
      if(npc.yieldT>config.avoidWait){npc.yieldT=0;chooseTarget(npc,player);}
     }else{
      npc.yieldT=0;
      const step=Math.min(config.speed*dt,dist);
      if(step>1e-4){
       const before=[...npc.position],result=moveCircle(nav,npc.position,[ux*step,uz*step]);
       npc.position=result.position;
       const travel=dist2(npc.position,before);
       npc.moving=travel>1e-5;npc.distance+=travel;
       if(npc.moving)npc.heading=Math.atan2(dx,dz);
       else{npc.stuck+=dt;if(npc.stuck>.5){npc.stuck=0;npc.route=null;npc.pause=.4+rng();}} // wedged: give up and re-plan
      }
     }
    }
   }else npc.moving=false;
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
  el.className='walk-npc-bubble';
  Object.assign(el.style,{position:'absolute',transform:'translate(-50%,-100%)',display:'none',whiteSpace:'normal',maxWidth:'240px',textAlign:'center',
   background:'#1d3336e8',color:'#ffe3a3',font:'13px/1.4 system-ui,\'Segoe UI\',\'Microsoft YaHei\',sans-serif',padding:'5px 10px',borderRadius:'12px',border:'1px solid #ffe3a333',boxShadow:'0 2px 6px #0004'});
  bubbleLayer.appendChild(el);npc.el=el;return el;
 }
 const projected=new THREE.Vector3();
 function updateBubbles(){
  if(!bubbleLayer)return;
  camera.updateMatrixWorld();camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const w=host.clientWidth,h=host.clientHeight,player=getPlayerPosition?.();
  for(const npc of list){
   const el=npc.el||bubbleEl(npc);
   let show=Boolean(!hidden&&!bubblesSuppressed&&npc.bubbleText&&npc.avatar);
   // Far chatter is noise (and in first person it floats over walls): cap by ground distance.
   if(show&&player&&dist2(npc.position,player)>config.bubble.maxDistance)show=false;
   if(show){
    projected.set(npc.position[0],nav.heightAt(npc.position)+npc.headY+.18,npc.position[1]).project(camera);
    if(projected.z>1||projected.z<-1)show=false;
    else{
     let x=(projected.x*.5+.5)*w,y=(-projected.y*.5+.5)*h;
     if(x<0||x>w||y<0||y>h)show=false; // anchor off screen: no pinned ghost bubbles
     else{
      if(el.style.display!=='block')el.style.display='block';
      if(el.textContent!==npc.bubbleText)el.textContent=npc.bubbleText;
      // Keep the whole box inside the viewport: the review caught bubbles clipped at the top edge.
      const bw=el.offsetWidth||140,bh=el.offsetHeight||30,pad=8;
      x=Math.min(Math.max(x,bw/2+pad),Math.max(bw/2+pad,w-bw/2-pad));
      y=Math.min(Math.max(y,bh+pad),Math.max(bh+pad,h-pad));
      el.style.left=x+'px';el.style.top=y+'px';
     }
    }
   }
   if(!show&&el.style.display!=='none')el.style.display='none'; // direct show/hide: no transition, reduced-motion safe by construction
  }
 }
 function syncLayerHidden(){if(bubbleLayer)bubbleLayer.hidden=hidden||bubblesSuppressed;}
 function start(){
  if(started||!nav)return;started=true;
  graph=createWanderGraph(nav,getPlayerPosition?.()||nav.spawn); // one flood fill, ~7ms
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
  graph=null;hidden=false;bubblesSuppressed=false;rng=makeRng(20260920);
 }
 const state=()=>({
  count:activeCount,loaded:list.length,hidden,
  npcs:list.map(n=>({actor:n.actorId,position:[n.position[0],n.position[1]],moving:n.moving,bubble:n.bubbleText})),
 });
 return {start,update,setHidden,setBubblesHidden,stop,state};
}
