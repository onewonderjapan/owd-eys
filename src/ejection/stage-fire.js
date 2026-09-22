// FIRE ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {lerp, clamp01, ease, track} from './common.js';

function softFlameTexture() {
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = 128;
 const g = canvas.getContext('2d');
 const grad = g.createRadialGradient(64, 80, 6, 64, 74, 62);
 grad.addColorStop(0, 'rgba(255,242,200,0.92)');
 grad.addColorStop(0.32, 'rgba(255,196,110,0.7)');
 grad.addColorStop(0.62, 'rgba(255,128,48,0.32)');
 grad.addColorStop(1, 'rgba(255,90,20,0)');
 g.fillStyle = grad;
 g.fillRect(0, 0, 128, 128);
 const tex = new THREE.CanvasTexture(canvas);
 tex.colorSpace = THREE.SRGBColorSpace;
 return tex;
}

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, config, props,
  scene, camera, take, eyePos, stage, reduced, poseOnce, lastPose,
  pitX, escorts, watchers, faceYaw, setHiddenParts, facePit} = ctx;
 let flames = [], flameMat = null, flameTex = null;

 scene.background = new THREE.Color('#171210');
 scene.fog = new THREE.Fog('#171210', 7, 22);
 const domeGeo = take(new THREE.SphereGeometry(22, 20, 14));
 const domeCount = domeGeo.attributes.position.count;
 const tint = new Float32Array(domeCount * 3);
 const topC = new THREE.Color('#3d2a1c'), bottomC = new THREE.Color('#0d0705');
 const cc = new THREE.Color();
 for (let i = 0; i < domeCount; i++) {
  cc.lerpColors(bottomC, topC, clamp01(domeGeo.attributes.position.getY(i) / 22 * 0.5 + 0.5));
  tint[i * 3] = cc.r; tint[i * 3 + 1] = cc.g; tint[i * 3 + 2] = cc.b;
 }
 domeGeo.setAttribute('color', new THREE.BufferAttribute(tint, 3));
 scene.add(new THREE.Mesh(domeGeo, take(new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, fog: false}))));

 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(16, 16)),
  take(new THREE.MeshStandardMaterial({color: '#241b14', roughness: 1})));
 ground.rotation.x = -Math.PI / 2;
 scene.add(ground);

 const firepit = props.instantiate('prop_firepit');
 firepit.position.set(pitX, 0, 0);
 scene.add(firepit);
 take(firepit);

 const fireLight = new THREE.PointLight('#ff9440', 7, 9, 1.6);
 fireLight.position.set(pitX, 0.55, 0);
 scene.add(fireLight);

 scene.add(new THREE.HemisphereLight('#7a6653', '#191009', 0.95));
 const rim = new THREE.DirectionalLight('#8ea6c0', 0.7);
 rim.position.set(-3, 4, -4);
 scene.add(rim);
 // Fire bounce: warm light from the pit onto the watchers' fronts so the
 // crowd reads as solid feathered bodies, not ghostly shapes in the dark.
 const bounce = new THREE.DirectionalLight('#d99a62', 0.6);
 bounce.position.set(pitX, 1.6, 0.5);
 scene.add(bounce);

 // Flames: gradient-textured planes rooted at the logs; no hard rectangle edges.
 flameTex = take(softFlameTexture());
 const flameGeo = take(new THREE.PlaneGeometry(0.34, 0.62));
 flameGeo.translate(0, 0.31, 0); // origin at the flame root
 flameMat = take(new THREE.MeshBasicMaterial({map: flameTex, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
 flames = [];
 const {flameRings, flameLayers} = config.limits;
 for (let i = 0; i < flameRings; i++) {
  const a = (i / flameRings) * Math.PI * 2;
  const fx = pitX + Math.cos(a) * 0.2, fz = Math.sin(a) * 0.2;
  for (let layer = 0; layer < flameLayers; layer++) {
   const rot = (layer / Math.max(1, flameLayers)) * Math.PI / 1.3;
   const flame = new THREE.Mesh(flameGeo, flameMat);
   flame.position.set(fx, 0.12 + (i % 3) * 0.05, fz);
   flame.rotation.y = rot;
   flame.userData.phase = i * 1.1 + rot;
   scene.add(flame);
   flames.push(flame);
  }
 }

 // Beats mirror the water script: the cast walks up first, then lift/carry/toss.
 const walkEnd = 1.7, liftEnd = 2.9, carryEnd = 4.3, dropEnd = 5.3;
 stage.beats = {walkEnd, liftEnd, carryEnd, pauseEnd: carryEnd, dropEnd};
 const camTrackSelf = [
  [0, [0.1, 0.85, 0]], [walkEnd, [-0.55, 1.18, 0]], [liftEnd, [-0.35, 1.2, 0]],
  [carryEnd, [1.3, 1.08, 0]], [dropEnd, [2.02, 0.58, 0]], [dropEnd + 0.45, [2.24, 0.38, 0]], [7.5, [2.26, 0.34, 0]],
 ];
 const camTrackNpc = [
  [0, [-0.15, 1.24, -1.5]], [carryEnd, [-0.15, 1.24, -1.5]],
  [dropEnd - 0.2, [0.85, 1.02, 1.3]], [7.5, [0.8, 0.98, 1.2]],
 ];
 // Grip at the body, then follow it to the pit rim (stones ~0.9 out from the pit
 // center) and let go there; the toss arcs the body the last stretch alone.
 const gripSpots = [[0.3, 0.55], [0.32, -0.55]];
 const rimSpot = 1.32;
 const backSpots = [[0.55, 0.9], [0.5, -0.95]];
 const escortStart = [[-1.7, 0.95], [-1.7, -0.95]];
 const crowdStart = [[-2.9, 1.3], [-3.0, 0.4], [-2.95, -0.55], [-2.8, -1.3], [-2.4, 1.55]];
 const crowdEnd = [[-0.85, 1.05], [-1.15, 0.35], [-0.95, -0.5], [-1.2, -1.15], [-0.55, 1.6]];

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const position = track(elapsed, isSelf ? camTrackSelf : camTrackNpc, eyePos);
  let yaw, pitch;
  if (isSelf && elapsed < walkEnd) {
   // The cast walks up; watch them come before the pit gaze takes over.
   yaw = Math.PI / 2; pitch = -0.05;
  } else if (isSelf && elapsed > dropEnd + 0.35) {
   // Inside the fire now: look back out toward the crowd, slightly up —
   // flames surround the view instead of the pit being watched from outside.
   const dx = -0.9 - position.x, dz = 0.9 - position.z;
   yaw = Math.atan2(-dx, -dz);
   pitch = Math.atan2(0.9 - position.y, Math.hypot(dx, dz)) * 0.55;
  } else {
   const look = facePit(position, {});
   yaw = look.yaw; pitch = look.pitch * 0.8;
  }

  let bx = 0, by = 0.12;
  if (elapsed < walkEnd) {
   bx = 0; by = 0.12;
  } else if (elapsed < liftEnd) {
   // Lift: escorts grip and raise the target toward the pit.
   const k = ease(clamp01((elapsed - walkEnd) / (liftEnd - walkEnd)));
   bx = 0; by = lerp(0.12, 0.5, k);
  } else if (elapsed < carryEnd) {
   // Carried along toward the pit rim.
   const t = clamp01((elapsed - liftEnd) / (carryEnd - liftEnd));
   bx = ease(t) * 1.55; by = lerp(0.5, 0.42, t);
  } else if (elapsed < dropEnd) {
   // Released at the rim: short toss into the pit with a small arc.
   const t = clamp01((elapsed - carryEnd) / (dropEnd - carryEnd));
   bx = lerp(1.55, pitX, ease(t));
   by = lerp(0.42, 0.16, ease(t)) + (reduced.value ? 0 : Math.sin(t * Math.PI) * 0.16 * (1 - t * 0.5));
  } else {
   // Settled in the pit; the fire keeps reference around the body.
   bx = pitX; by = 0.16 + (reduced.value ? 0 : Math.sin(elapsed * 1.2) * 0.012);
  }
  poseOnce(targetId, 'carried');
  target.player.position.set(bx, by, 0);
  target.player.rotation.set(0, -Math.PI / 2, reduced.value ? 0 : Math.sin(elapsed * 2.2) * 0.05);

  // Procession and grip; the escorts carry alongside, hold at the rim through the
  // toss start, then release and step back.
  const walkK = ease(clamp01(elapsed / walkEnd));
  const carryT = ease(clamp01((elapsed - liftEnd) / (carryEnd - liftEnd)));
  const release = clamp01((elapsed - dropEnd) / 0.5);
  escorts.forEach((id, i) => {
   const avatar = actors.get(id);
   const s = escortStart[i % escortStart.length];
   const g = gripSpots[i % gripSpots.length];
   const b = backSpots[i % backSpots.length];
   // Grip beside the body, then pace it (stopped at the rim) until the toss ends.
   const heldX = elapsed < liftEnd ? g[0] : Math.min(bx + 0.3, rimSpot - 0.1);
   const heldZ = elapsed < liftEnd ? g[1] : lerp(g[1], g[1] * 0.55, carryT);
   const px = lerp(s[0], heldX, walkK), pz = lerp(s[1], heldZ, walkK);
   const fx = lerp(px, b[0], release), fz = lerp(pz, b[1], release);
   avatar.player.position.set(fx, 0, fz);
   avatar.player.rotation.set(0, faceYaw([fx, fz], elapsed < dropEnd ? [bx, 0] : [pitX, 0]), 0);
   poseOnce(id, elapsed < walkEnd ? 'standing' : elapsed < dropEnd - 0.04 ? 'carried' : 'standing');
  });
  watchers.forEach((id, i) => {
   const avatar = actors.get(id);
   const s = crowdStart[i % crowdStart.length];
   const e2 = crowdEnd[i % crowdEnd.length];
   const wx = lerp(s[0], e2[0], walkK), wz = lerp(s[1], e2[1], walkK);
   avatar.player.position.set(wx, 0, wz);
   avatar.player.rotation.set(0, faceYaw([wx, wz], [bx, 0]), 0);
   poseOnce(id, 'standing');
  });

  // Once the body settles in the pit the wings droop outward so the flame core,
  // logs and pit rim stay visible between them.
  stage.wingSplay = ease(clamp01((elapsed - (dropEnd + 0.7)) / 0.6));

  const flicker = reduced.value ? 0.8 : 0.72 + Math.sin(elapsed * 11) * 0.12 + Math.sin(elapsed * 23.7) * 0.08;
  const feed = elapsed > dropEnd + 0.1 ? 1.15 : 1; // fire rises a little as the body lands
  fireLight.intensity = 7 * flicker * feed;
  for (const flame of flames) {
   const w = 0.8 + Math.sin(elapsed * 9 + flame.userData.phase) * 0.22;
   flame.scale.set(w, (0.85 + Math.sin(elapsed * 7.3 + flame.userData.phase * 1.7) * 0.25) * feed, 1);
  }

  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = yaw;
  stage.basePitch = pitch;
 };

 stage.diagnostics = () => ({trajectory: stage.trajectory});

 stage.begin = () => {
  // The whole cast walks in the procession, so everyone joins the stage scene.
  for (const id of actors.ids) {
   const avatar = actors.get(id);
   if (!avatar) continue;
   avatar.player.visible = id !== targetId || !isSelf;
   scene.add(avatar.player);
  }
  setHiddenParts(false);
 };
 stage.reset = () => {
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
