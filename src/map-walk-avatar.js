import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mountEquipment} from './rig-contract.js';

export async function loadWalkingAvatar(actorId='cast.14'){
 const response=await fetch('assets/manifest.json');if(!response.ok)throw Error('衣橱清单未能打开');
 const manifest=await response.json(),preset=manifest.presets[actorId],loader=new GLTFLoader();
 if(!preset)throw Error('请先选择一位角色');
 const gear=preset.modules.map(id=>manifest.modules.find(a=>a.id===id));
 const [body,...parts]=await Promise.all([manifest.base.url,...gear.map(g=>g.url)].map(url=>loader.loadAsync(url).then(g=>g.scene)));
 const tags=new Set();for(const a of gear){for(const tag of a.hide_tags||[])tags.add(tag);if(a.slot==='upper')tags.add('chest');if(a.slot==='headwear'&&!a.keep_crown)tags.add('crown');}
 body.traverse(o=>{const d=o.userData;o.visible=!((d.body_detail&&tags.has('chest'))||(d.eye_right_component&&tags.has('eye_right'))||(d.face_component&&tags.has('face'))||(d.face_component&&tags.has('bill')&&/beak|continuous.?L/i.test(o.name))||(d.face_component&&tags.has('pupils')&&/pupil|sparkle/i.test(o.name))||(d.crown_component&&tags.has('crown')));if(d.recolor&&o.isMesh)for(const m of(Array.isArray(o.material)?o.material:[o.material]))m.color.set('#'+preset.color);});
 const model=new THREE.Group();model.add(body);parts.forEach((p,i)=>model.add(mountEquipment(p,gear[i])));
 const box=new THREE.Box3().setFromObject(model);model.position.y=-box.min.y;
 const visual=new THREE.Group();visual.scale.setScalar(.28);visual.add(model);
 const player=new THREE.Group();player.name='walking-player';player.add(visual);
 const shadow=new THREE.Mesh(new THREE.CircleGeometry(.27,32),new THREE.MeshBasicMaterial({color:'#101d22',transparent:true,opacity:.25,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.008;player.add(shadow);
 const marker=new THREE.Mesh(new THREE.RingGeometry(.28,.305,40),new THREE.MeshBasicMaterial({color:'#ffe2a0',side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));marker.rotation.x=-Math.PI/2;marker.position.y=.012;player.add(marker);
 return {player,visual,model,version:manifest.version,actorId,label:preset.label,modules:[...preset.modules]};
}

export function disposeWalkingAvatar(avatar){
 const geometries=new Set(),materials=new Set(),textures=new Set();
 avatar.player.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:o.material?[o.material]:[])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
 for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures){t.dispose();t.source?.data?.close?.();}
}
