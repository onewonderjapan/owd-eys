// BOULDER (E4) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {lerp, clamp01, ease, track} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, poseOnce, lastPose, setHiddenParts} = ctx;
 // 巨石滚落: comedy staging - the target is flattened then drifts off as a
 // 'paper goose'. No gore.
 scene.background = new THREE.Color('#1a1610');
 scene.fog = new THREE.Fog('#241d14', 8, 26);
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(26, 14)),
  take(new THREE.MeshStandardMaterial({color: '#4a3a28', roughness: 1})));
 ground.rotation.x = -Math.PI / 2; scene.add(ground);
 for (const zSide of [-2.6, 2.6]) {
  const wall = new THREE.Mesh(take(new THREE.BoxGeometry(17, 2.0, 0.6)),
   take(new THREE.MeshStandardMaterial({color: '#3a2f22', roughness: 1})));
  wall.position.set(0, 1.0, zSide); scene.add(wall);
 }
 const boulder = take(new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 0),
  new THREE.MeshStandardMaterial({color: '#6b6157', roughness: 0.95, flatShading: true})));
 boulder.position.set(-9, 1.15, 0); scene.add(boulder);
 const sun = new THREE.DirectionalLight('#ffd9a0', 1.3);
 sun.position.set(6, 8, 4); scene.add(sun);
 scene.add(new THREE.HemisphereLight('#8a7a63', '#2a221a', 1.05));
 const streetlamp = new THREE.DirectionalLight('#ffe2b0', 0.9);
 streetlamp.position.set(-4, 6, 3); scene.add(streetlamp);

 const rollStart = 1.0, rollEnd = 3.1, flatten = 2.15;
 stage.beats = {walkEnd: rollStart, liftEnd: rollStart, carryEnd: rollStart, pauseEnd: rollStart, dropEnd: flatten};

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
