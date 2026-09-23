// FLUSH (E6) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
// Also plays for any unknown style: the original file's trailing `else` branch.
import * as THREE from 'three';
import {lerp, clamp01, ease, track} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, lastPose, setHiddenParts} = ctx;
 // 冲水飞湖: comedy spiral into a drain, launched over the town, splash landing.
 scene.background = new THREE.Color('#1c2a33');
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(24, 24)),
  take(new THREE.MeshStandardMaterial({color: '#24343a', roughness: 0.6})));
 ground.rotation.x = -Math.PI / 2; scene.add(ground);
 const basin = new THREE.Mesh(take(new THREE.CylinderGeometry(1.05, 0.85, 0.5, 28)),
  take(new THREE.MeshStandardMaterial({color: '#e8e8e2', roughness: 0.35})));
 basin.position.set(0, 0.25, 0); scene.add(basin); take(basin);
 const basinWater = new THREE.Mesh(take(new THREE.CircleGeometry(0.92, 28)),
  take(new THREE.MeshStandardMaterial({color: '#3d7fa6', roughness: 0.2, transparent: true, opacity: 0.9})));
 basinWater.rotation.x = -Math.PI / 2; basinWater.position.set(0, 0.51, 0); scene.add(basinWater);
 const spin = new THREE.Group(); spin.position.set(0, 0.53, 0); scene.add(spin); take(spin);
 for (let i = 0; i < 3; i++) {
  const arc = new THREE.Mesh(take(new THREE.PlaneGeometry(1.4, 0.06)),
   take(new THREE.MeshBasicMaterial({color: '#bfe0ef', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false})));
  arc.rotation.x = -Math.PI / 2; arc.position.y = 0.01;
  arc.rotation.z = i * Math.PI / 3; spin.add(arc);
 }
 const pool = new THREE.Mesh(take(new THREE.CircleGeometry(1.4, 26)),
  take(new THREE.MeshStandardMaterial({color: '#3d7fa6', roughness: 0.25, transparent: true, opacity: 0.9})));
 pool.rotation.x = -Math.PI / 2; pool.position.set(7.5, 0.01, 0); scene.add(pool);
 scene.add(new THREE.HemisphereLight('#cfe0ea', '#24343a', 1.0));
 const top = new THREE.DirectionalLight('#ffffff', 0.9);
 top.position.set(2, 6, 3); scene.add(top);

 const spiralEnd = 2.2, airEnd = 4.3, splashEnd = 5.2;
 stage.beats = {walkEnd: spiralEnd, liftEnd: spiralEnd, carryEnd: airEnd, pauseEnd: airEnd, dropEnd: splashEnd};

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'fixed';
  if (elapsed < spiralEnd) {
   const k = ease(clamp01(elapsed / spiralEnd));
   const r = 2.2 * (1 - k), ang = k * 4.2;
   target.player.position.set(Math.cos(ang) * r, 0.12 - k * 0.06, Math.sin(ang) * r);
   target.player.rotation.y = -ang;
   spin.rotation.y = -elapsed * 5.2;
  } else if (elapsed < airEnd) {
   const k = clamp01((elapsed - spiralEnd) / (airEnd - spiralEnd));
   target.player.position.set(k * 7.5, 0.1 + 3.4 * k - 2.9 * k * k, 0);
   target.player.rotation.z = (reduced.value ? 0.2 : k * Math.PI * 2.2);
   spin.rotation.y -= 0.08;
  } else {
   const k = clamp01((elapsed - airEnd) / (splashEnd - airEnd));
   target.player.position.set(7.5, lerp(0.1, -0.55, k), 0);
   target.player.rotation.z = 0;
  }
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    a.player.position.set(Math.sin(id.length * 2.4) * 2.2, 0, 2.0 + Math.cos(id.length * 1.6) * 0.8);
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  // self camera rides the body through the spiral and the flight
  const camTrackSelf = [[0, [2.2, 0.9, 0]], [spiralEnd, [0.4, 0.75, 0]], [airEnd, [7.5, 4.2, 1.6]], [6.5, [7.5, 0.75, 1.5]]];
  const camTrackNpc = [[0, [0, 1.6, 3.2]], [6.5, [3.4, 2.2, 3.4]]];
  const position = track(elapsed, isSelf ? camTrackSelf : camTrackNpc, eyePos);
  const look = target.player.position;
  const dx = look.x - position.x, dz = look.z - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = Math.abs(dx) + Math.abs(dz) < 0.2 ? stage.baseYaw : Math.atan2(-dx, -dz);
  stage.basePitch = elapsed < spiralEnd ? -0.5 : Math.atan2(look.y - position.y, Math.hypot(dx, dz) || 1) * 0.6;
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
  target.player.rotation.set(0, 0, 0); target.player.scale.setScalar(1);
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
