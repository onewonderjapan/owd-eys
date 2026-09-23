// FLUSH (E6) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
// Also plays for any unknown style: the original file's trailing `else` branch.
import * as THREE from 'three';
import {lerp, clamp01, ease, track, addSkyDome} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, lastPose, setHiddenParts} = ctx;
 // 冲水飞湖: comedy spiral into a drain, launched over the town, splash landing.
 scene.background = new THREE.Color('#1c2a33');
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(24, 24)),
  take(new THREE.MeshStandardMaterial({color: '#34503e', roughness: 0.9}))); // R2: night lawn around the lake, the washroom sits on its own tiles
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


 // R2 2026-09-24 set dressing: the flush read as abstract blue discs. The spiral
 // now happens in a tiled washroom corner (tiled floor, back wall, a cistern and
 // seat that make the basin read as a toilet), and the landing is a lake under an
 // evening sky with ripples that spread after the splash (performance-time
 // driven; reduced motion keeps a single static ring).
 addSkyDome(ctx, {top: '#23324a', mid: '#6f8ea6', bottom: '#1c2a33', horizon: -0.05});
 if (typeof document !== 'undefined') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#d9e3e6'; g2.fillRect(0, 0, 128, 128);
  g2.strokeStyle = '#9fb0b6'; g2.lineWidth = 4;
  for (let t = 0; t <= 128; t += 32) {
   g2.beginPath(); g2.moveTo(t, 0); g2.lineTo(t, 128); g2.stroke();
   g2.beginPath(); g2.moveTo(0, t); g2.lineTo(128, t); g2.stroke();
  }
  const tiles = take(new THREE.CanvasTexture(cv));
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(3, 3); tiles.colorSpace = THREE.SRGBColorSpace;
  const floorTile = new THREE.Mesh(take(new THREE.PlaneGeometry(6, 6)), take(new THREE.MeshStandardMaterial({map: tiles, roughness: 0.4})));
  floorTile.rotation.x = -Math.PI / 2; floorTile.position.set(0, 0.004, 0); scene.add(floorTile);
  const backWall = new THREE.Mesh(take(new THREE.PlaneGeometry(6, 3)), take(new THREE.MeshStandardMaterial({map: tiles, roughness: 0.5, color: '#bcd0d8'})));
  backWall.position.set(0, 1.5, -3); scene.add(backWall);
 }
 const porcelain = take(new THREE.MeshStandardMaterial({color: '#f2f2ec', roughness: 0.3}));
 const cistern = new THREE.Mesh(take(new THREE.BoxGeometry(1.5, 0.95, 0.42)), porcelain);
 cistern.position.set(0, 0.95, -1.18); scene.add(cistern);
 const seat = new THREE.Mesh(take(new THREE.TorusGeometry(0.96, 0.07, 10, 32)), porcelain);
 seat.rotation.x = Math.PI / 2; seat.position.set(0, 0.54, 0); scene.add(seat);
 const shore = new THREE.Mesh(take(new THREE.RingGeometry(1.4, 2.2, 30)),
  take(new THREE.MeshStandardMaterial({color: '#3f6b45', roughness: 1, side: THREE.DoubleSide})));
 shore.rotation.x = -Math.PI / 2; shore.position.set(7.5, 0.008, 0); scene.add(shore);
 const rippleGeo = take(new THREE.RingGeometry(0.2, 0.27, 28));
 const ripples = [0, 1, 2].map(() => {
  const mat = take(new THREE.MeshBasicMaterial({color: '#d8eef7', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false}));
  const r = new THREE.Mesh(rippleGeo, mat);
  r.rotation.x = -Math.PI / 2; r.position.set(7.5, 0.02, 0); r.visible = false; scene.add(r);
  return r;
 });
 const dressedUpdate = stage.update;
 stage.update = args => {
  dressedUpdate(args);
  const since = args.elapsed - splashEnd;
  ripples.forEach((r, i) => {
   const t = reduced.value ? (i === 0 && since > 0 ? 0.6 : -1) : since - i * 0.35;
   r.visible = t > 0;
   if (t > 0) { r.scale.setScalar(1 + t * 3.2); r.material.opacity = Math.max(0, 0.7 - t * 0.35); }
  });
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
