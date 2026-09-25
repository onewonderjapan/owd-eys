import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installMapWalk} from './map-walk.js';
const $=s=>document.querySelector(s);
let manifest,selected='cast.14',walking,gamePromise,ready=false,error=null,preparing=false;
const label=p=>p.label.replace(/^\d+\s*[|·]?\s*/, '');
function choose(id){
 if(preparing||walking?.state().loading||!Object.hasOwn(manifest.presets,id))return;
 selected=id;const preset=manifest.presets[id];$('#selected-name').textContent=label(preset);$('#selected-portrait').src=preset.thumbnail;$('#selected-portrait').alt=label(preset);$('#selected-portrait').hidden=false;
 for(const b of document.querySelectorAll('[data-actor]'))b.setAttribute('aria-pressed',b.dataset.actor===id);
 const url=new URL(location.href);url.searchParams.set('actor',id);url.searchParams.delete('walk');history.replaceState(null,'',url);
}
async function makeGame(){
 const response=await fetch(new URL('map-scene.json',import.meta.url));if(!response.ok)throw Error('地图清单未能打开，请重试');const data=await response.json();
 const gltf=await new GLTFLoader().loadAsync(data.glb,event=>{
  const amount=event.lengthComputable&&event.total?Math.round(event.loaded/event.total*100)+'%':(event.loaded/1048576).toFixed(1)+' MB';
  $('#walk-enter').textContent='正在下载地图 '+amount+'…';
 }),root=gltf.scene,host=$('#viewport');
 const scene=new THREE.Scene();scene.background=new THREE.Color('#293c3f');scene.add(root);
 const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.14;host.prepend(renderer.domElement);
 window.eys.rendererInfo=()=>({calls:renderer.info.render?.calls??0,triangles:renderer.info.render?.triangles??0,programs:renderer.info.programs?.length??0,pixelRatio:renderer.getPixelRatio()});
 const camera=new THREE.OrthographicCamera(-19,19,16,-16,.1,180);camera.position.set(0,55,.001);camera.lookAt(0,0,0);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
 scene.add(new THREE.HemisphereLight('#bed8e7','#364135',2.3));
 for(const [position,color,power] of [[[-15,25,8],'#c3dfff',2.3],[[7,20,-14],'#ffe0ab',2.5],[[18,12,20],'#c6dde1',1]]){const light=new THREE.DirectionalLight(color,power);light.position.set(...position);scene.add(light);}
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:'#293c3f',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.64;scene.add(ground);
 const highlight=new THREE.Object3D();highlight.visible=false;
 const render=()=>{const target=walking?.renderTarget;renderer.render(target?.scene||scene,target?.camera||walking?.camera||camera);};
 const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;walking?.projection();renderer.setSize(w,h,false);render();};
 new ResizeObserver(resize).observe(host);
 walking=installMapWalk({data,root,scene,camera,controls,renderer,render,resize,host,highlight,getActor:()=>selected,describeActor:id=>{const p=manifest.presets[id];return p?{label:label(p),thumbnail:p.thumbnail}:null;}});return walking;
}
async function enter(){
 if(preparing)return;preparing=true;error=null;$('#walk-error').hidden=true;$('#walk-enter').disabled=true;$('#walk-enter').setAttribute('aria-busy','true');$('#walk-enter').textContent='正在打开小镇…';
 try{if(!gamePromise)gamePromise=makeGame().catch(e=>{gamePromise=null;throw e;});const game=await gamePromise;await game.start();}
 catch(e){error=e.message;$('#walk-error').textContent='小镇未能打开：'+error+'。请检查网络后重试。';$('#walk-error').hidden=false;$('#walk-error').scrollIntoView({block:'nearest'});}
 finally{preparing=false;$('#walk-enter').disabled=false;$('#walk-enter').removeAttribute('aria-busy');$('#walk-enter').textContent='带 TA 进入小镇 ↗';}
}
window.eys={state:()=>({ready,error,selected,preparing,actorCount:manifest?Object.keys(manifest.presets).length:0,walk:walking?.state()||null})};
if(new URLSearchParams(location.search).get('round')==='force-kill')window.eys.holdKills=on=>walking?.debugHoldKills(on)??null; // debug-only, smoke bell loops
try{
 const response=await fetch(new URL('assets/manifest.json',import.meta.url));if(!response.ok)throw Error('角色册未能打开，请刷新页面');manifest=await response.json();
 let cardIndex=0;
 for(const [id,p] of Object.entries(manifest.presets)){
  const b=document.createElement('button');b.className='character-card';b.dataset.actor=id;b.type='button';b.setAttribute('aria-pressed','false');b.setAttribute('aria-label','选择'+label(p));
  // V7 2026-09-24: first two grid rows (5 columns) load eagerly so the landing
  // screen never shows empty cards; the rest stay lazy.
  const image=document.createElement('img');image.src=p.thumbnail;image.alt='';image.loading=cardIndex<10?'eager':'lazy';image.decoding='async';image.width=100;image.height=90;cardIndex++;
  // the CSS silhouette behind the img is the pre-load placeholder; once the
  // (transparent) thumbnail paints, clear it so cards keep the flat look
  const clearPlaceholder=()=>{image.style.background='none';};
  image.addEventListener('load',clearPlaceholder,{once:true});
  if(image.complete&&image.naturalWidth>0)clearPlaceholder();
  const name=document.createElement('strong');name.textContent=label(p);b.append(image,name);b.onclick=()=>choose(id);$('#character-grid').append(b);
 }
 $('#actor-count').textContent=Object.keys(manifest.presets).length+' 位角色';const requested=new URLSearchParams(location.search).get('actor');choose(Object.hasOwn(manifest.presets,requested)?requested:'cast.14');
 ready=true;$('#walk-enter').disabled=false;$('#walk-enter').textContent='带 TA 进入小镇 ↗';$('#walk-enter').onclick=enter;
}catch(e){error=e.message;$('#walk-error').textContent=error;$('#walk-error').hidden=false;}
