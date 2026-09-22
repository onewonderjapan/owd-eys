// SPACE (E1) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {lerp, clamp01, ease, track} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, poseOnce, lastPose, setHiddenParts} = ctx;
 // 钟楼夜空弹射: carried to the tower top, then launched into the star field.
 scene.background = new THREE.Color('#05070f');
 const starGeo = new THREE.BufferGeometry();
 const starCount = 700;
 const starPos = new Float32Array(starCount * 3);
 for (let i = 0; i < starCount; i++) {
  const a = Math.random() * Math.PI * 2, bm = Math.acos(Math.random() * 1.6 - 0.6), r = 20;
  starPos[i * 3] = r * Math.sin(bm) * Math.cos(a);
  starPos[i * 3 + 1] = Math.abs(r * Math.cos(bm)) + 0.5;
  starPos[i * 3 + 2] = r * Math.sin(bm) * Math.sin(a);
 }
 starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
 const starMat = take(new THREE.PointsMaterial({color: '#cfe0ff', size: 0.1, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9}));
 scene.add(new THREE.Points(starGeo, starMat));
 scene.add(new THREE.Mesh(take(new THREE.CircleGeometry(9, 40)), take(new THREE.MeshStandardMaterial({color: '#1c2742', roughness: 1})))).children;
 const voidFloor = scene.children[scene.children.length - 1];
 voidFloor.rotation.x = -Math.PI / 2; voidFloor.position.y = -9;
 // town lights below so the drift has something to look at
 const townGeo = new THREE.BufferGeometry();
 const townPos = new Float32Array(240 * 3);
 for (let i = 0; i < 240; i++) {
  townPos[i * 3] = (Math.random() - 0.5) * 26;
  townPos[i * 3 + 1] = -8.9;
  townPos[i * 3 + 2] = (Math.random() - 0.5) * 26;
 }
 townGeo.setAttribute('position', new THREE.BufferAttribute(townPos, 3));
 const townLights = take(new THREE.Points(townGeo, new THREE.PointsMaterial({color: '#ffd98a', size: 0.14, sizeAttenuation: true, fog: false})));
 townLights.position.y = -8.9; scene.add(townLights);
 const platformGlow = new THREE.PointLight('#ffd9a2', 2.5, 5);
 platformGlow.position.set(0, 1.2, 0); scene.add(platformGlow);
 const towerTop = take(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 2.4), new THREE.MeshStandardMaterial({color: '#3a3440', roughness: 0.9})));
 towerTop.position.y = -0.15; scene.add(towerTop);
 const moon = take(new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), new THREE.MeshBasicMaterial({color: '#dfe6ee', fog: false})));
 moon.position.set(8, 9, -12); scene.add(moon);
 scene.add(new THREE.HemisphereLight('#4a5c96', '#0a0d18', 0.8));
 const moonlight = new THREE.DirectionalLight('#cddcff', 1.7);
 moonlight.position.set(4, 8, 6); scene.add(moonlight);

 const walkEnd = 1.5, liftEnd = 2.6, carryEnd = 4.0, launchEnd = 5.0;
 stage.beats = {walkEnd, liftEnd, carryEnd, launchEnd};

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const walkK = ease(clamp01(elapsed / walkEnd));
  const bx = lerp(-1.2, 0, walkK) + (elapsed > launchEnd ? (elapsed - launchEnd) * 0.4 : 0);
  const by = elapsed < launchEnd
   ? lerp(0.12, 0.62, ease(clamp01(elapsed / launchEnd)))
   : 0.62 + Math.pow(elapsed - launchEnd, 1.15) * 1.6;
  poseOnce(targetId, elapsed > launchEnd ? 'carried' : 'standing');
  target.player.position.set(bx, by, 0);
  if (elapsed > launchEnd) target.player.rotation.z += reduced.value ? 0.004 : 0.02; // slow weightless tumble
  const driftYaw = elapsed > launchEnd ? (elapsed - launchEnd) * 0.12 : 0;
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    a.player.position.set(Math.sin(a.player.position.x * 0.7 + 1) * 1.55, 0, Math.cos(a.player.position.z * 0.7 + 2) * 1.55);
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  stage.wingSplay = ease(clamp01((elapsed - launchEnd) / 0.8));
  starMat.opacity = 0.75 + Math.sin(elapsed * 2.3) * 0.15; // gentle twinkle
  const camTrackSelf = [
   [0, [-1.1, 1.05, -0.9]], [carryEnd, [-0.2, 1.15, 0]], [launchEnd, [0, 1.05, 0]],
   [launchEnd + 1.2, [0.5, 4.2, -0.8]], [8.0, [1.6, 6.4, -1.8]],
  ];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [-1.6, 1.1, 1.3]], [8.0, [-1.6, 1.1, 1.3]]], eyePos);
  let yaw, pitch;
  if (isSelf && elapsed > launchEnd) {
   // drifting away: sweep between the moon, the stars and the town below
   const k = elapsed - launchEnd;
   yaw = driftYaw + Math.sin(k * 0.5) * 0.55;
   pitch = -0.62 + Math.sin(k * 0.34 + 1.2) * 0.42;
  } else {
   const dx = target.player.position.x - position.x, dz = target.player.position.z - position.z;
   yaw = Math.atan2(-dx, -dz);
   pitch = Math.atan2(target.player.position.y + 0.6 - position.y, Math.hypot(dx, dz));
  }
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = yaw;
  stage.basePitch = pitch;
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
  target.player.rotation.z = 0;
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
