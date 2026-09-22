// CHANDELIER (E3) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {tmpVecA, lerp, clamp01, ease, track} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, poseOnce, lastPose, setHiddenParts} = ctx;
 // 吊灯砸落: the target is walked under the chapel chandelier, which swings
 // loose and drops. Non-gory: impact hides the target and bursts petals.
 scene.background = new THREE.Color('#120d0a');
 scene.fog = new THREE.Fog('#120d0a', 6, 18);
 const floor = new THREE.Mesh(take(new THREE.PlaneGeometry(18, 18)),
  take(new THREE.MeshStandardMaterial({color: '#3a2c1e', roughness: 1})));
 floor.rotation.x = -Math.PI / 2; scene.add(floor);
 scene.add(new THREE.HemisphereLight('#6a5a48', '#1a120c', 0.9));
 const warm = new THREE.PointLight('#ffd9a2', 14, 12, 1.7);
 warm.position.set(0, 2.6, 1.2); scene.add(warm);

 const chandelier = new THREE.Group();
 const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 10, 24),
  new THREE.MeshStandardMaterial({color: '#c9a24a', metalness: 0.7, roughness: 0.35}));
 ring.rotation.x = Math.PI / 2; chandelier.add(ring);
 for (let i = 0; i < 6; i++) {
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 8),
   new THREE.MeshStandardMaterial({color: '#e8dcc2', roughness: 0.8}));
  const ca = i * Math.PI / 3;
  candle.position.set(Math.cos(ca) * 0.55, 0.14, Math.sin(ca) * 0.55);
  chandelier.add(candle);
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.2),
   new THREE.MeshBasicMaterial({color: '#ffca7a', transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
  flame.position.set(candle.position.x, 0.32, candle.position.z);
  flame.userData.flame = true;
  chandelier.add(flame);
 }
 for (let i = 0; i < 3; i++) {
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.4, 6),
   new THREE.MeshStandardMaterial({color: '#55432a', roughness: 0.8}));
  const cha = i * Math.PI * 2 / 3 + 0.5;
  chain.position.set(Math.cos(cha) * 0.3, 1.25, Math.sin(cha) * 0.3);
  chandelier.add(chain);
 }
 chandelier.position.set(0, 3.2, 0);
 scene.add(chandelier);
 take(chandelier);

 const petals = [];
 const petalGeo = take(new THREE.PlaneGeometry(0.09, 0.14));
 const petalMats = ['#f5c6d0', '#ffffff', '#e8a0b4'].map(c => take(new THREE.MeshBasicMaterial({color: c, transparent: true, opacity: 0.95, side: THREE.DoubleSide, fog: false})));
 const dropStart = 2.2, impact = 2.72;
 stage.beats = {walkEnd: 1.2, liftEnd: dropStart, carryEnd: dropStart, pauseEnd: dropStart, dropEnd: impact};

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const walkK = ease(clamp01(elapsed / 1.2));
  target.player.position.set(lerp(-1.5, 0, walkK), 0, 0);
  target.player.rotation.set(0, Math.PI / 2, 0);
  poseOnce(targetId, 'standing');

  const inSwing = elapsed < dropStart;
  const amp = inSwing ? lerp(0.12, 0.85, clamp01(elapsed / dropStart)) : 0;
  if (elapsed < impact) {
   chandelier.position.y = elapsed < dropStart ? 3.2 : lerp(3.2, 0.62, ease(clamp01((elapsed - dropStart) / (impact - dropStart))));
   chandelier.rotation.z = inSwing ? Math.sin(elapsed * 3.1) * amp : 0;
  } else if (!chandelier.userData.landed) {
   chandelier.userData.landed = true;
   chandelier.position.y = 0.62; chandelier.rotation.z = 0;
   target.player.visible = false;
   for (let i = 0; i < 14; i++) {
    const petal = new THREE.Mesh(petalGeo, petalMats[i % petalMats.length]);
    petal.position.set((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
    petal.userData.vy = -(0.4 + Math.random() * 0.3); petal.userData.spin = Math.random() * 4;
    scene.add(petal); petals.push(petal);
   }
  }
  for (const p of petals) {
   if (p.position.y > 0.03) {
    p.position.y += p.userData.vy * 0.016;
    p.rotation.z += p.userData.spin * 0.016;
   }
  }
  for (const o of chandelier.children) if (o.userData.flame) o.visible = elapsed < impact;
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = (id !== targetId || !isSelf) && !(elapsed >= impact && id === targetId);
   if (a.player.visible && id !== targetId) {
    a.player.position.set(Math.sin(id.length * 2.3) * 2.0, 0, Math.cos(id.length * 1.9) * 1.7);
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  // SELF = first person: you are walked under the chandelier, look up as it
  // swings and drops, and the impact leaves you on the ground looking up at
  // the ring and the falling petals. NPC side keeps the spectator track.
  const camTrackNpc = [[0, [-1.85, 1.3, -1.7]], [impact, [-1.7, 1.15, -1.5]], [6.5, [-1.5, 0.95, -1.3]]];
  const position = eyePos;
  let yaw, pitch;
  if (isSelf) {
   const under = ease(clamp01(elapsed / 1.2));
   position.set(lerp(-1.5, 0, under), elapsed < impact ? 0.45 + 0.1 * (1 - under)
    : lerp(0.45, 0.16, ease(clamp01((elapsed - impact) / 0.8))), 0);
   yaw = -Math.PI / 2; // facing +x, eyes on the chandelier
   if (elapsed < 1.2) pitch = 0.08;
   else if (elapsed < impact) pitch = lerp(0.12, 1.2, ease(clamp01((elapsed - 1.2) / (dropStart - 1.2))));
   else pitch = lerp(1.25, 0.95, clamp01((elapsed - impact) / 1.5));
  } else {
   position.copy(track(elapsed, camTrackNpc, tmpVecA));
   const dx = target.player.position.x - position.x, dz = target.player.position.z - position.z;
   yaw = Math.atan2(-dx, -dz);
   pitch = Math.atan2(target.player.position.y + 0.4 - position.y, Math.hypot(dx, dz));
  }
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = yaw;
  stage.basePitch = pitch;
  if (elapsed >= impact && elapsed < impact + 0.16) scene.background.set('#000000');
  else scene.background.set('#120d0a');
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
  chandelier.userData.landed = false; chandelier.position.y = 3.2;
  target.player.visible = true;
  for (const p of petals) scene.remove(p);
  petals.length = 0;
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
