import * as THREE from 'three';
import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';
import {createWanderGraph,moveCircle} from './map-walk-simulation.js';
import {IMMERSION_CONFIG,TOWN_ROUND_CONFIG} from './immersion-config.js';

// B4 walk-NPC townsfolk (design-npc-wander.md): roaming extras for free roam.
// Owns only what it creates — its avatars and one DOM bubble layer — so every
// cleanup path (busy hide, walk exit, load abort) can restore the shared scene
// exactly. All randomness comes from one seeded LCG so a run replays.
//
// 1.7.0 town round: when a `round` (createTownRound) is passed, one townsperson
// is the duck. It kills on the pure-logic module's verdict (cooldown + range +
// witness gates), the victim topples (visual.rotation.z 0→π/2) and then turns
// into a corpse leg — the SAME avatar restyled, never a copy; the round ledger
// keeps the bookkeeping, this module keeps the objects (single owner).
const makeRng=seed=>{let s=(seed*2654435761)>>>0;return()=>{s=(Math.imul(s,1103515245)+12345)>>>0;return s/4294967296;};};
const span=(rng,range)=>range[0]+rng()*(range[1]-range[0]);
// GLTFLoader sanitizes node names (spaces -> '_'); accept both spellings. Not
// tied to any export suffix (no `.080`-style tail in the pattern).
const FOOT_NAME=/foot|shin|webbed[\s_]paddle|toe[\s_]seam/i;

export function createWalkNpcs({scene,nav,config,getPlayerPosition,getPlayerActor,isMobile=()=>false,reducedMotion=false,camera,host,round=null,getPlayerView=null,onRoundStarted=null,onCorpse=null}){
 const list=[];let corpses=[];let started=false,hidden=false,corpsesHidden=false,bubblesSuppressed=false,bubbleLayer=null,loadToken=0,activeLoads=0,queue=[],activeCount=0,rng=makeRng(20260920),graph=null;
 let roundLive=false,kill=null,corpsePlaceholder=false,corpseMeshNames=null;
 // Stroll targets come from the walk-start wander graph (see createWanderGraph):
 // routing over its precomputed cells costs ~2ms instead of the ~73ms median a
 // full findPath needed, which matters because this runs inside the RAF tick.
 const spawnPoint=()=>{
  const from=getPlayerPosition?.()||nav.spawn;
  return graph?.sample(rng,{minDistance:config.spawnMinDistance,from})?.position||[...nav.spawn];
 };
 // Every townsperson finished loading: seed the round with the real roster once.
 const maybeStartRound=()=>{
  if(!round||roundLive||!started||queue.length||activeLoads||!list.length)return;
  roundLive=true;
  round.start(list.map(n=>n.actorId));
  if(onRoundStarted)try{onRoundStarted();}catch{} // debug hooks must not break the load path
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
  maybeStartRound();
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
 function chooseTarget(npc,player,minDistance=2.5){
  const picked=graph?.sample(rng,{minDistance,from:npc.position,accept:acceptFor(npc,player)});
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
  if(npc.killing||npc.dying){ // the kill performance owns both bodies this moment
   npc.moving=false;
  }else{
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
   if(npc.bubbleT>0){npc.bubbleT-=dt;if(npc.bubbleT<=0){npc.bubbleText=null;npc.cooldown=span(rng,config.bubble.cooldown);}}
   else if(config.bubble.pool.length){npc.cooldown-=dt;if(npc.cooldown<=0){npc.bubbleText=config.bubble.pool[Math.floor(rng()*config.bubble.pool.length)];npc.bubbleT=config.bubble.duration;}}
  }
  const a=npc.avatar;
  if(a){
   a.player.position.set(npc.position[0],nav.heightAt(npc.position),npc.position[1]);
   const angle=Math.atan2(Math.sin(npc.heading-a.visual.rotation.y),Math.cos(npc.heading-a.visual.rotation.y));
   a.visual.rotation.y+=angle*Math.min(1,dt*18);
   a.model.rotation.z=!reducedMotion&&npc.moving?Math.sin(npc.distance*15)*.045:0;
   a.visual.position.y=!reducedMotion&&npc.moving?Math.abs(Math.sin(npc.distance*15))*.025:0;
  }
 }
 // ---------------------------------------------------------------------------
 // 1.7.0 kill flow: verdict each frame from the pure-logic round; the action
 // (killDuration, 0 under reduced motion) turns the duck, lunges killLunge and
 // topples the victim; the final frame records the kill and restyles the SAME
 // avatar into a corpse leg.
 function updateKill(dt){
  if(!round||!roundLive)return;
  if(!kill){
   const duckNpc=list.find(n=>n.actorId===round.duckId());
   const playerPos=getPlayerPosition?.();
   if(!duckNpc||!playerPos)return;
   const view=getPlayerView?.()||{};
   const victimId=round.canKill({
    duck:{id:duckNpc.actorId,position:duckNpc.position,paused:duckNpc.pause>0},
    victims:list.filter(n=>n!==duckNpc).map(n=>({id:n.actorId,position:n.position})),
    player:{position:playerPos,firstPerson:Boolean(view.firstPerson),forward:view.forward||[0,0]},
   });
   if(!victimId)return;
   const victimNpc=list.find(n=>n.actorId===victimId);
   if(!victimNpc)return;
   kill={duck:duckNpc,victim:victimNpc,t:0};
   duckNpc.killing=true;victimNpc.dying=true;
   return;
  }
  const {duck,victim}=kill;
  kill.t+=dt;
  const dur=reducedMotion?0:TOWN_ROUND_CONFIG.killDuration;
  const u=dur>0?Math.min(1,kill.t/dur):1;
  const dx=victim.position[0]-duck.position[0],dz=victim.position[1]-duck.position[1],dist=Math.hypot(dx,dz);
  if(dist>1e-4)duck.heading=Math.atan2(dx,dz); // turn on the victim
  if(dur>0&&dist>1e-4){ // small lunge; walls stop it (moveCircle), never pushes through
   const step=Math.min(TOWN_ROUND_CONFIG.killLunge*dt/dur,dist);
   duck.position=moveCircle(nav,duck.position,[dx/dist*step,dz/dist*step]).position;
  }
  victim.avatar.visual.rotation.z=Math.PI/2*(1-Math.pow(1-u,3)); // topple, ease-out
  if(u>=1){
   round.recordKill(victim.actorId,victim.position);
   makeCorpse(victim);
   list.splice(list.indexOf(victim),1);
   duck.killing=false;
   kill=null;
   if(onCorpse)try{onCorpse();}catch{} // one-shot thump; hooks must not break the kill flow
   chooseTarget(duck,getPlayerPosition?.(),TOWN_ROUND_CONFIG.fleeDistance); // walk away, ≥ fleeDistance
  }
 }
 // Turn a toppled townsperson into the leg (design §2 腿的造型, plan A: reuse
 // the loaded avatar, zero new assets).
 function makeCorpse(entry){
  const a=entry.avatar;
  if(entry.el){entry.el.remove();entry.el=null;}
  a.visual.position.y=0;a.model.rotation.z=0;
  let color=null;
  a.model.traverse(o=>{ // victim main color from the recolor-tagged materials
   if(color||!o.isMesh||!o.userData.recolor)return;
   const m=Array.isArray(o.material)?o.material[0]:o.material;
   if(m&&m.color)color=m.color.getHex();
  });
  const footMeshes=[],allNames=[];
  a.model.traverse(o=>{
   if(!o.isMesh)return;
   allNames.push(o.name||'(unnamed)');
   if(FOOT_NAME.test(o.name||'')){footMeshes.push(o);o.visible=true;}
   else o.visible=false;
  });
  corpsePlaceholder=footMeshes.length===0;
  corpseMeshNames=allNames;
  if(corpsePlaceholder)buildPlaceholderCorpse(a,color); // DIAGNOSTIC ONLY, never acceptance
  // Legs to the sky: rotation.x = π stands the shins upright with the flat
  // webbed paddles on top (the GGD corpse read); -π/2 lays the legs flat under
  // the disc (tried first, unreadable). The owner re-judges from
  // corpse-close.png against the official shot.
  a.model.rotation.x=Math.PI;
  a.model.scale.multiplyScalar(TOWN_ROUND_CONFIG.corpse.legScale||1); // before anchoring: the box below sees the scaled legs
  a.player.updateWorldMatrix(true,true);
  if(footMeshes.length){
   const inv=new THREE.Matrix4().copy(a.player.matrixWorld).invert();
   const box=new THREE.Box3();
   for(const m of footMeshes){const b=new THREE.Box3().setFromObject(m);b.applyMatrix4(inv);box.union(b);}
   if(!box.isEmpty()){
    const c=TOWN_ROUND_CONFIG.corpse;
    // model.position.y is in visual units (visual scales by ~0.28): convert the
    // player-space shift or the legs come out 3.5x too short (first smoke shot).
    const scale=a.visual.scale.x||0.28;
    a.model.position.y+=(-c.sink-box.min.y)/scale; // min.y ≈ -sink: grounded, slightly buried
   }
  }
  for(const child of [...a.player.children]){ // remove the gold ring marker; the shadow patch stays
   // BufferGeometry subclasses carry no is* flag in three 0.180 — match by type
   // string (the old isRingGeometry check never matched and the ring survived).
   if(child.geometry&&child.geometry.type==='RingGeometry'){
    a.player.remove(child);
    child.geometry.dispose();
    for(const m of Array.isArray(child.material)?child.material:[child.material])m.dispose();
   }
  }
  const c=TOWN_ROUND_CONFIG.corpse;
  if(color!==null){
   const disc=new THREE.Mesh(new THREE.CylinderGeometry(c.discRadius,c.discRadius,c.discThickness,24),new THREE.MeshStandardMaterial({color}));
   disc.name='corpse-body-disc';disc.position.y=c.discThickness/2;
   a.player.add(disc); // disposed with the avatar by disposeWalkingAvatar (single owner)
  }
  corpses.push({actor:entry.actorId,avatar:a,position:[...entry.position]});
 }
 // Placeholder legs (two cylinders + two flat discs) when the foot-mesh regex
 // finds nothing: diagnostics only so the shape can be seen and reported.
 function buildPlaceholderCorpse(a,color){
  const c=TOWN_ROUND_CONFIG.corpse;
  const mat=new THREE.MeshStandardMaterial({color:color??0xcfcfcf});
  for(const side of [-1,1]){
   const leg=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,c.footRise,8),mat);
   leg.position.set(side*.08,c.footRise/2,0);a.player.add(leg);
   const foot=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,c.discThickness,10),mat);
   foot.position.set(side*.08,c.footRise,0);a.player.add(foot);
  }
 }
 function clearCorpses(){
  for(const c of corpses){if(c.avatar){scene.remove(c.avatar.player);disposeWalkingAvatar(c.avatar);}}
  corpses=[];kill=null;corpsePlaceholder=false;corpseMeshNames=null;
 }
 // Meeting aftermath (map-walk restoreImmersion → round.resolveMeeting result):
 // dispose the ejected townsperson, clear every leg, repopulate on a new round.
 function applyRound(r){
  if(!round)return;
  if(r&&r.ejectedId){
   const idx=list.findIndex(n=>n.actorId===r.ejectedId);
   if(idx>=0){
    const npc=list[idx];list.splice(idx,1);
    if(npc.avatar){scene.remove(npc.avatar.player);disposeWalkingAvatar(npc.avatar);}
    if(npc.el)npc.el.remove();
   }
  }
  clearCorpses();
  if(r&&r.newRound){
   roundLive=false;
   const player=getPlayerActor?.();
   const have=new Set(list.map(n=>n.actorId));
   queue=IMMERSION_CONFIG.rosterCandidates.filter(id=>id!==player&&!have.has(id)).slice(0,Math.max(0,activeCount-list.length));
   pump();
  }
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
   let show=Boolean(!hidden&&!bubblesSuppressed&&npc.bubbleText&&npc.avatar&&!npc.killing&&!npc.dying);
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
  if(round)round.tick(dt); // busy/paused frames never reach here (map-walk gates update)
  for(const npc of list)stepNpc(npc,dt);
  updateKill(dt);
  updateBubbles();
 }
 // keepCorpses: the legs stay in the world while the townsfolk step out -- the
 // report beat (and the load before it) must show the body it is about
 // (review 2026-09-27: report-pov.png had no legs in frame at all).
 function setHidden(next,{keepCorpses=false}={}){
  const corpseHide=next&&!keepCorpses;
  if(hidden===next&&corpsesHidden===corpseHide)return;
  hidden=next;corpsesHidden=corpseHide;
  for(const npc of list)if(npc.avatar)npc.avatar.player.visible=!hidden;
  for(const c of corpses)if(c.avatar)c.avatar.player.visible=!corpsesHidden;
  syncLayerHidden();
 }
 function setBubblesHidden(next){if(bubblesSuppressed===next)return;bubblesSuppressed=next;syncLayerHidden();}
 function stop(){
  started=false;loadToken++;queue=[];activeLoads=0;roundLive=false;kill=null;
  for(const npc of list){if(npc.avatar){scene.remove(npc.avatar.player);disposeWalkingAvatar(npc.avatar);}npc.avatar=null;if(npc.el)npc.el.remove();}
  list.length=0;
  for(const c of corpses){if(c.avatar){scene.remove(c.avatar.player);disposeWalkingAvatar(c.avatar);}}
  corpses=[];
  if(bubbleLayer){bubbleLayer.remove();bubbleLayer=null;}
  graph=null;hidden=false;corpsesHidden=false;bubblesSuppressed=false;rng=makeRng(20260920);corpsePlaceholder=false;corpseMeshNames=null;
 }
 const state=()=>({
  count:activeCount,loaded:list.length,hidden,
  corpsesVisible:corpses.filter(c=>c.avatar&&c.avatar.player.visible).length,
  npcs:list.map(n=>({actor:n.actorId,position:[n.position[0],n.position[1]],moving:n.moving,bubble:n.bubbleText})),
  round:round?round.state():null,
  corpsePlaceholder,corpseMeshNames:corpseMeshNames?[...corpseMeshNames]:null,
 });
 return {start,update,setHidden,setBubblesHidden,stop,applyRound,state};
}
