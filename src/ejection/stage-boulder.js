// BOULDER (E4) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {lerp, clamp01, track, addSkyDome, seededRandom} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, lastPose, setHiddenParts} = ctx;
 // 巨石滚落: comedy staging - the target is flattened then drifts off as a
 // 'paper goose'. No gore.
 scene.background = new THREE.Color('#1a1610');
 scene.fog = new THREE.Fog('#241d14', 8, 26);
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(26, 14)),
  take(new THREE.MeshStandardMaterial({color: '#5c4832', roughness: 1})));
 ground.rotation.x = -Math.PI / 2; scene.add(ground);
 for (const zSide of [-2.6, 2.6]) {
  const wall = new THREE.Mesh(take(new THREE.BoxGeometry(17, 2.0, 0.6)),
   take(new THREE.MeshStandardMaterial({color: '#3a2f22', roughness: 1})));
  wall.position.set(0, 1.0, zSide); scene.add(wall);
 }
 const boulder = take(new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1),
  new THREE.MeshStandardMaterial({color: '#6b6157', roughness: 0.95, flatShading: true})));
 boulder.position.set(-9, 1.15, 0); scene.add(boulder);
 const sun = new THREE.DirectionalLight('#ffd9a0', 1.3);
 sun.position.set(6, 8, 4); scene.add(sun);
 scene.add(new THREE.HemisphereLight('#8a7a63', '#2a221a', 1.05));
 const streetlamp = new THREE.DirectionalLight('#ffe2b0', 0.9);
 streetlamp.position.set(-4, 6, 3); scene.add(streetlamp);

 const rollStart = 1.0, rollEnd = 3.1, flatten = 2.15;
 stage.beats = {walkEnd: rollStart, liftEnd: rollStart, carryEnd: rollStart, pauseEnd: rollStart, dropEnd: flatten};
 // Self POV rides the head until the body is flattened into the paper goose.
 stage.selfPovUntil = flatten;

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  target.player.position.set(0, 0.12, 0);
  target.player.rotation.set(0, Math.PI / 2, 0);
  if (elapsed >= flatten && elapsed < flatten + 0.15) target.player.scale.y = 0.08;
  else if (elapsed >= flatten + 0.15) {
   // paper-goose drift: flattened, floating up and away
   const k = clamp01((elapsed - flatten - 0.15) / 3);
   target.player.scale.y = 0.08;
   target.player.position.y = 0.12 + k * 1.6;
   target.player.position.x = k * 1.1;
   target.player.rotation.x = Math.PI / 2;
   target.player.rotation.z = k * 2.4;
  }
  const rollT = clamp01((elapsed - rollStart) / (rollEnd - rollStart));
  boulder.position.x = lerp(-9, 9, rollT);
  boulder.rotation.z -= ((elapsed - rollStart) > 0 ? 2.2 : 0) * 0.016 * (elapsed > rollStart && elapsed < rollEnd ? 1 : 0);
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a || id === targetId) continue;
   a.player.visible = true;
   a.player.position.set(Math.sin(id.length * 2.1) * 2.4, 0, Math.sign(id.length - 6) * 3.4);
   a.player.rotation.y = Math.atan2(boulder.position.x - a.player.position.x, 0 - a.player.position.z) * 0.3;
  }
  // SELF = the target's eyes: stand in the lane, watch the boulder grow as it
  // closes, then after the flatten watch your own paper-goose body drift off.
  if (isSelf && elapsed >= flatten + 0.15 && !target.player.visible) target.player.visible = true;
  const camTrackSelf = [[0, [0, 1.02, 0]], [flatten, [0, 1.02, 0]], [flatten + 0.3, [0, 1.0, 0.45]], [6.0, [0.55, 0.95, 1.35]]];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [0, 1.25, 4.6]], [6.0, [0, 1.25, 4.6]]], eyePos);
  const look = (isSelf && elapsed >= flatten) ? target.player.position : {x: boulder.position.x, y: 1.0, z: 0};
  const dx = look.x - position.x, dz = (look.z || 0) - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  if (elapsed >= flatten && elapsed < flatten + 0.14) scene.background.set('#ffffff');
  else scene.background.set('#1a1610');
  stage.baseYaw = Math.abs(dx) + Math.abs(dz) < 0.15 ? Math.PI / 2 : Math.atan2(-dx, -dz);
  stage.basePitch = elapsed < flatten ? Math.atan2(1.0 - position.y, Math.hypot(dx, dz) || 1) * 0.8 : -0.15;
 };


 // R2 2026-09-24 set dressing: the corridor was two blank walls in a brown
 // void. An open sky over the temple run, stone coursing along both walls
 // (instanced, colour-varied), torches with warm glow, and a rounder boulder.
 addSkyDome(ctx, {top: '#4d6e80', mid: '#c49a66', bottom: '#2a2218', horizon: 0.05});
 scene.fog = new THREE.Fog('#3a2e20', 10, 30);
 const stoneRand = seededRandom(77);
 const stoneGeo = take(new THREE.BoxGeometry(1, 1, 1));
 const stoneMat = take(new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.95}));
 const perWall = 34;
 const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, perWall * 2 * 2);
 const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), ss = new THREE.Vector3(), sp = new THREE.Vector3(), sc = new THREE.Color();
 let si = 0;
 for (const zSide of [-2.6, 2.6]) for (let course = 0; course < 2; course++) for (let k = 0; k < perWall; k++) {
  const w = 0.42 + stoneRand() * 0.12;
  const x = -8.3 + k * 0.5 + (course ? 0.25 : 0);
  sm.compose(sp.set(x, 0.5 + course * 0.95 + stoneRand() * 0.04, zSide - Math.sign(zSide) * 0.33), sq, ss.set(w, 0.86, 0.1));
  stones.setMatrixAt(si, sm);
  sc.set('#8a7456').offsetHSL(0, (stoneRand() - 0.5) * 0.08, (stoneRand() - 0.5) * 0.14);
  stones.setColorAt(si, sc);
  si++;
 }
 stones.count = si;
 scene.add(take(stones));
 const torchGeo = take(new THREE.PlaneGeometry(0.16, 0.3));
 // Warm-capped flame color + camera-distance fade (R1 542c3d9 recipe, adapted):
 // additive planes clipped toward white over the bright dusk sky no matter how the
 // color was capped, so the cap lives in the solid flame color instead — an orange
 // flame that occludes the sky — and near-camera torches still fade with distance
 // (reduced-motion unaffected — pure brightness scaling).
 const torchMat = take(new THREE.MeshBasicMaterial({color: '#ff7a26', transparent: true, opacity: 0.92, blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
 const torchPoints = [];
 const postGeo = take(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6));
 const postMat = take(new THREE.MeshStandardMaterial({color: '#2a1d12', roughness: 1}));
 for (const x of [-6, -2, 2, 6]) for (const zSide of [-2.2, 2.2]) {
  const post = new THREE.Mesh(postGeo, postMat); post.position.set(x, 2.1, zSide); scene.add(post);
  const flame = new THREE.Mesh(torchGeo, torchMat); flame.position.set(x, 2.45, zSide); scene.add(flame);
  torchPoints.push(flame.position);
 }
 for (const x of [-4, 4]) {
  const glow = new THREE.PointLight('#ffb35a', 3.2, 6, 1.6);
  glow.position.set(x, 2.4, 0); scene.add(glow);
 }
 const dressedUpdate = stage.update;
 stage.update = args => {
  dressedUpdate(args);
  let nearest = Infinity;
  for (const p of torchPoints) nearest = Math.min(nearest, camera.position.distanceTo(p));
  torchMat.opacity = 0.92 * clamp01((nearest - 0.8) / 0.9);
 };
 stage.diagnostics = () => ({trajectory: stage.trajectory});

 stage.begin = () => {
  for (const id of actors.ids) {
   const avatar = actors.get(id);
   if (!avatar) continue;
   avatar.player.visible = id !== targetId || !isSelf;
   scene.add(avatar.player);
  }
  setHiddenParts(false);
 };
 stage.reset = () => {
  target.player.scale.y = 1;
  target.player.rotation.set(0, 0, 0);
  target.player.position.set(0, 0.12, 0);
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
