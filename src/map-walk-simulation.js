// Flat navigation in the delivered map's X/Z plane. No renderer or DOM dependencies.
export const PLAYER_RADIUS=.22, WALK_SPEED=2.35;
const EPS=1e-8;
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function segmentDistance(p,a,b){
 const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
 return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
}
export function inside(p,poly){
 let yes=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const a=poly[i],b=poly[j];
  if(segmentDistance(p,a,b)<EPS)return true;
  if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
 }return yes;
}
const edges=poly=>poly.map((a,i)=>[a,poly[(i+1)%poly.length]]);
function shape(poly,kind,id){return {poly,edges:edges(poly),kind,id,minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))};}
function clipSouth(poly,limit){const out=[];for(const [a,b] of edges(poly)){if(a[1]<=limit)out.push(a);if((a[1]<=limit)!==(b[1]<=limit))out.push([a[0]+(limit-a[1])*(b[0]-a[0])/(b[1]-a[1]),limit]);}return out;}
function wallPoly(a,b,width){const l=distance(a,b),x=-(b[1]-a[1])/l*width/2,z=(b[0]-a[0])/l*width/2;return [[a[0]+x,a[1]+z],[b[0]+x,b[1]+z],[b[0]-x,b[1]-z],[a[0]-x,a[1]-z]];}
export function createNavigation(layout,props={proxies:[]}){
 const t=layout.transform,toWorld=p=>[(p[0]-t.origin_pixel[0])*t.units_per_pixel,(p[1]-t.origin_pixel[1])*t.units_per_pixel];
 const land=clipSouth(layout.outline,425).map(toWorld),dock=layout.dock.map(toWorld),zones=layout.zones.map(z=>({...z,poly:z.poly.map(toWorld)}));
 const rooms=layout.rooms.map(r=>({...r,poly:r.poly.map(toWorld)})),surfaces=[land,dock,...zones.map(z=>z.poly)];
 const solids=layout.blocks.map(b=>shape(b.poly.map(toWorld),'block',b.id)),doors=[];
 for(const r of layout.rooms){
  for(const [i,[a,b]] of edges(r.poly).entries()){
   const length=distance(a,b),cuts=[];
   const at=f=>toWorld([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);
   for(const d of r.doors.filter(d=>d.edge===i)){
    const half=Math.min(d.width_px/length/2,.49),lo=Math.max(0,d.t-half),hi=Math.min(1,d.t+half);cuts.push([lo,hi]);
    // Use the middle of the clipped gap, which differs from t on the tavern's diagonal edge.
    const start=at(lo),end=at(hi),center=at((lo+hi)/2),len=distance(start,end);
    let normal=[-(end[1]-start[1])/len,(end[0]-start[0])/len];
    const poly=r.poly.map(toWorld);
    if(!inside([center[0]+normal[0]*.2,center[1]+normal[1]*.2],poly))normal=normal.map(v=>-v);
    doors.push({id:r.id+'-'+doors.length,room:r.id,label:r.label,a:start,b:end,center,normal,width:len});
   }
   let from=0;const intervals=[];
   for(const [lo,hi] of cuts.sort((a,b)=>a[0]-b[0])){if(lo>from)intervals.push([from,lo]);from=hi;}
   if(from<1)intervals.push([from,1]);
   for(const [lo,hi] of intervals)if(distance(at(lo),at(hi))>.015)solids.push(shape(wallPoly(at(lo),at(hi),Math.max(layout.wall.thickness,.18)),'wall',r.id));
  }
 }
 for(const p of props.proxies)solids.push(shape(p.poly,'prop',p.name));
 const isLand=p=>surfaces.some(poly=>inside(p,poly));
 // Split overlapping ground edges at union intersections, keeping only the exposed water boundary.
 const allEdges=surfaces.flatMap(edges),boundary=[];
 for(const [a,b] of allEdges){
  const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<EPS)continue;
  const splits=[0,1];
  for(const [c,d] of allEdges){
   const ex=d[0]-c[0],ez=d[1]-c[1],den=dx*ez-dz*ex;
   if(Math.abs(den)>EPS){const u=((c[0]-a[0])*ez-(c[1]-a[1])*ex)/den,v=((c[0]-a[0])*dz-(c[1]-a[1])*dx)/den;if(u>EPS&&u<1-EPS&&v>=-EPS&&v<=1+EPS)splits.push(u);}
   else if(segmentDistance(c,a,b)<EPS||segmentDistance(d,a,b)<EPS){for(const p of [c,d]){const u=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(len*len);if(u>EPS&&u<1-EPS)splits.push(u);}}
  }
  splits.sort((a,b)=>a-b);
  for(let i=1;i<splits.length;i++){
   const lo=splits[i-1],hi=splits[i];if(hi-lo<EPS)continue;
   const f=(lo+hi)/2,p=[a[0]+dx*f,a[1]+dz*f],n=[-dz/len*.0001,dx/len*.0001];
   if(isLand([p[0]+n[0],p[1]+n[1]])!==isLand([p[0]-n[0],p[1]-n[1]]))boundary.push([[a[0]+dx*lo,a[1]+dz*lo],[a[0]+dx*hi,a[1]+dz*hi]]);
  }
 }
 function collision(p,radius=PLAYER_RADIUS){
  if(!isLand(p)||boundary.some(([a,b])=>segmentDistance(p,a,b)<radius-EPS))return 'water';
  for(const s of solids){if(p[0]+radius<s.minX||p[0]-radius>s.maxX||p[1]+radius<s.minZ||p[1]-radius>s.maxZ)continue;
   if(inside(p,s.poly)||s.edges.some(([a,b])=>segmentDistance(p,a,b)<radius-EPS))return s.kind;
  }return null;
 }
 const roomAt=p=>rooms.find(r=>inside(p,r.poly))||null;
 function areaAt(p){const r=roomAt(p);if(r)return {id:r.id,label:r.label,kind:'room'};const z=zones.find(z=>inside(p,z.poly));if(z)return {id:z.id,label:z.label,kind:'zone'};if(inside(p,dock))return {id:'dock',label:'南部码头',kind:'zone'};return {id:'street',label:'鹅教堂 · 街道',kind:'zone'};}
 function heightAt(p){if(roomAt(p)||doors.some(d=>segmentDistance(p,d.a,d.b)<.18))return .338;if(inside(p,dock))return .195;return zones.some(z=>inside(p,z.poly))?.156:.144;}
 const nearDoor=p=>doors.map(d=>({...d,distance:distance(p,d.center)})).filter(d=>d.distance<1.15).sort((a,b)=>a.distance-b.distance)[0]||null;
 const spawn=toWorld([515,389]);if(collision(spawn))throw Error('地图出生点不可通行');
 return {toWorld,rooms,doors,solids,boundary,spawn,collision,roomAt,areaAt,heightAt,nearDoor};
}
export function moveCircle(nav,position,delta){
 const n=Math.max(1,Math.ceil(Math.hypot(...delta)/.04)),step=delta.map(v=>v/n),p=[...position];let blocked=null;
 for(let i=0;i<n;i++){
  const q=[p[0]+step[0],p[1]+step[1]],hit=nav.collision(q);
  if(!hit){p[0]=q[0];p[1]=q[1];continue;}blocked=hit;
  if(!nav.collision([p[0]+step[0],p[1]]))p[0]+=step[0];
  if(!nav.collision([p[0],p[1]+step[1]]))p[1]+=step[1];
 }return {position:p,blocked};
}
export function createWalker(nav){
 const state={position:[...nav.spawn],heading:Math.PI,visited:new Set(),area:nav.areaAt(nav.spawn),near:null,blocked:null,distance:0,moving:false};
 function step(input,dt){
  const len=Math.hypot(...input),amount=WALK_SPEED*Math.min(Math.max(dt,0),.1),delta=len?input.map(v=>v/Math.max(1,len)*amount):[0,0];
  const result=moveCircle(nav,state.position,delta),travel=distance(state.position,result.position);state.position=result.position;state.blocked=result.blocked;state.moving=travel>1e-5;state.distance+=travel;
  if(len)state.heading=Math.atan2(input[0],input[1]);state.area=nav.areaAt(state.position);state.near=nav.nearDoor(state.position);if(state.area.kind==='room')state.visited.add(state.area.id);return state;
 }
 return {state,step,reset:()=>{state.position=[...nav.spawn];state.moving=false;state.blocked=null;state.area=nav.areaAt(state.position);state.near=null;}};
}
