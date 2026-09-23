// WATER ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {UP, TWIST_Q, tmpMat, tmpVecA, tmpVecB, tmpVecC, tmpVecD, tmpVecE,
 tmpLink, tmpEnd, tmpScale, tmpQuat, lerp, clamp01, ease} from './common.js';

function softBubbleTexture() {
 // Soft filled bubble: a gentle core with only a slightly brighter rim. The old
 // near-transparent core + bright rim read as a hollow RING when a bubble drifted
 // close past the camera (reviewed as "circle artifacts", V3 2026-09-24).
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = 64;
 const g = canvas.getContext('2d');
 const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
 grad.addColorStop(0, 'rgba(215,238,250,0.30)');
 grad.addColorStop(0.62, 'rgba(210,235,248,0.26)');
 grad.addColorStop(0.88, 'rgba(222,242,252,0.34)');
 grad.addColorStop(1, 'rgba(222,242,252,0)');
 g.fillStyle = grad;
 g.beginPath();
 g.arc(32, 32, 30, 0, Math.PI * 2);
 g.fill();
 const tex = new THREE.CanvasTexture(canvas);
 tex.colorSpace = THREE.SRGBColorSpace;
 return tex;
}

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, targetModel, config, props,
  scene, camera, take, eyePos, stage, reduced, poseOnce, lastPose,
  dockDeckY, sinkX, chainLength, stoneScale, eyeH, bindLocal,
  escorts, watchers, faceYaw, setHiddenParts} = ctx;

 scene.background = new THREE.Color('#0d3357');
 scene.fog = new THREE.Fog('#0d3357', 9.0, 20);
 const domeGeo = take(new THREE.SphereGeometry(22, 20, 14));
 const domeCount = domeGeo.attributes.position.count;
 const tint = new Float32Array(domeCount * 3);
 const topC = new THREE.Color('#2f7ab4'), bottomC = new THREE.Color('#03101f');
 const cc = new THREE.Color();
 for (let i = 0; i < domeCount; i++) {
  cc.lerpColors(bottomC, topC, clamp01(domeGeo.attributes.position.getY(i) / 22 * 0.5 + 0.5));
  tint[i * 3] = cc.r; tint[i * 3 + 1] = cc.g; tint[i * 3 + 2] = cc.b;
 }
 domeGeo.setAttribute('color', new THREE.BufferAttribute(tint, 3));
 scene.add(new THREE.Mesh(domeGeo, take(new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, fog: false}))));

 const water = new THREE.Mesh(take(new THREE.PlaneGeometry(34, 34)),
  // 0.55 (was 0.82): the sink column and stone sit below the surface; an almost
  // opaque plane hid them entirely on the look-down beat (V3 2026-09-24).
  take(new THREE.MeshStandardMaterial({color: '#123f66', roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.55})));
 water.rotation.x = -Math.PI / 2;
 scene.add(water);

 const sun = new THREE.DirectionalLight('#bfe2ff', 1.35);
 sun.position.set(0.5, 8, 2.5);
 scene.add(sun);
 // Ground lift so the dock underside reads as dark wood from below instead of a
 // pure-black slab (V3 2026-09-24).
 scene.add(new THREE.HemisphereLight('#8fc0e2', '#2c3c4c', 0.95));

 const dock = props.instantiate('prop_dock');
 dock.position.set(-2.6, 0.02, 0);
 scene.add(dock);
 take(dock);
 // R2 2026-09-24: from underwater the dock read as a pure-black slab (the GLB's
 // planks only face up). A plank-toned underside panel with a faint emissive
 // lift sits just below the deck so it reads as wood seen from below.
 {
  dock.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(dock);
  if (!box.isEmpty()) {
   const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
   const under = new THREE.Mesh(take(new THREE.PlaneGeometry(size.x * 0.98, size.z * 0.98, 1, 8)),
    take(new THREE.MeshStandardMaterial({color: '#5b4330', emissive: '#2a1c12', emissiveIntensity: 0.9, roughness: 0.95})));
   under.rotation.x = Math.PI / 2; // face down, toward the water
   under.position.set(center.x, box.min.y + 0.004, center.z);
   scene.add(under);
   // plank seams so it does not read as a flat board
   const seamMat = take(new THREE.MeshBasicMaterial({color: '#2b1d13'}));
   const seamGeo = take(new THREE.PlaneGeometry(size.x * 0.98, 0.025));
   for (let k = 1; k < 8; k++) {
    const seam = new THREE.Mesh(seamGeo, seamMat);
    seam.rotation.x = Math.PI / 2;
    seam.position.set(center.x, box.min.y + 0.002, box.min.z + size.z * k / 8);
    scene.add(seam);
   }
  }
 }

 const stoneRoot = props.instantiate('prop_sink_stone');
 stoneRoot.scale.setScalar(stoneScale * 1.2);
 scene.add(stoneRoot);
 take(stoneRoot);
 const stoneBody = stoneRoot.getObjectByName('sink_stone_body');
 if (stoneBody && stoneBody.material) {
  stoneBody.material = stoneBody.material.clone();
  take(stoneBody.material);
  // Brightened so the stone reads against the deep water on the look-down beat
  // (V3 2026-09-24 — design 1.2: the chain and stone must be visible).
  stoneBody.material.color = new THREE.Color('#77848f');
  stoneBody.material.emissive = new THREE.Color('#161c22');
 }
 const stoneAnchorNode = stoneRoot.getObjectByName(props.nodeNames().chainAnchor);

 const chainProto = props.chainPrototype();
 const chainMat = take(chainProto.material.clone());
 // Bright steel tones so the links read against the deep water (V3 2026-09-24;
 // the old #4c565f vanished into the background on the look-down beat).
 chainMat.color = new THREE.Color('#93a3b2');
 chainMat.emissive = new THREE.Color('#1c242c');
 const chainCount = config.chainLinks;
 // library geometry is BORROWED read-only (see immersion-props.js contract):
 // never take() it into the stage's owned list — disposing it here would free
 // the shared prototype's GPU buffers out from under the prop library
 const chain = new THREE.InstancedMesh(chainProto.geometry, chainMat, chainCount);
 chain.frustumCulled = false;
 scene.add(chain);

 const splashGeo = take(new THREE.PlaneGeometry(1.1, 0.72));
 const splashMat = take(new THREE.MeshBasicMaterial({color: '#cfe6f2', transparent: true, opacity: 0, depthTest: false, fog: false}));
 const splash = new THREE.Mesh(splashGeo, splashMat);
 splash.position.set(0, 0, -0.6);
 splash.renderOrder = 5;
 camera.add(splash);

 const bubbleTex = take(softBubbleTexture());
 const bubbleMat = take(new THREE.SpriteMaterial({map: bubbleTex, transparent: true, opacity: 0.32, depthWrite: false, fog: false}));
 const bubbles = [];
 for (let i = 0; i < config.limits.bubbles; i++) {
  const b = new THREE.Sprite(bubbleMat);
  b.scale.setScalar(0.045 + (i % 3) * 0.018);
  b.userData.seed = i * 2.399;
  b.visible = false;
  scene.add(b);
  bubbles.push(b);
 }

 // Fish = rounded low-poly body + vertical tail fin, soft silvery tones, orbits away
 // from the eye so they stay mid/background reference.
 const fishBodyGeo = take(new THREE.SphereGeometry(0.05, 7, 5));
 fishBodyGeo.scale(1.7, 0.8, 0.6);
 const fishTailGeo = take(new THREE.ConeGeometry(0.04, 0.09, 4));
 fishTailGeo.rotateX(-Math.PI / 2);
 fishTailGeo.scale(0.3, 1, 1);
 const fishBodyMat = take(new THREE.MeshStandardMaterial({color: '#a9c0cf', roughness: 0.55, emissive: '#182631', emissiveIntensity: 0.4}));
 const fishTailMat = take(new THREE.MeshStandardMaterial({color: '#8ca5b4', roughness: 0.6, emissive: '#141f28', emissiveIntensity: 0.4}));
 const fishes = [];
 for (let i = 0; i < 8; i++) {
  const fish = new THREE.Group();
  const body = new THREE.Mesh(fishBodyGeo, fishBodyMat);
  const tail = new THREE.Mesh(fishTailGeo, fishTailMat);
  tail.position.z = -0.1;
  fish.add(body, tail);
  fish.userData.seed = i * 2.399;
  fish.visible = false;
  scene.add(fish);
  fishes.push(fish);
 }
 // Orbit on the far side of the sink column so the fish never clutter the
 // chain/stone sight line, and keep a hard minimum distance from the eye.
 const fishCenter = new THREE.Vector2(sinkX + 1.9, -0.4);

 // One throw curve drives body, eye and every water event. The arc ends deep enough
 // that the eye (body + eyeOff) also passes the surface shortly after the body does;
 // events read the live trajectory heights, so they stay correct in reduced motion.
 // Beats follow the user script: cast walks up -> lift -> carry -> hold at the edge
 // -> drop; the eye keeps watching the shore through the fall and the slow sink.
 const walkEnd = 1.7, liftEnd = 2.9, carryEnd = 4.5, pauseEnd = 5.1, dropEnd = 5.9;
 stage.beats = {walkEnd, liftEnd, carryEnd, pauseEnd, dropEnd};
 // Self POV: once dropped, the authored gaze sinking toward the chain may look
 // steeply down past your own body (the level-gaze band applies before that).
 stage.selfPovFreePitchAfter = dropEnd;
 const eyeOff = eyeH * 0.9;
 const shorePoint = new THREE.Vector3(-1.1, 1.0, 0); // the crowd waiting on the dock
 const throwY = t => lerp(0.55, -0.75, ease(t)) + (reduced.value ? 0 : Math.sin(t * Math.PI) * 0.12);
 const slowSink = t => lerp(-0.75, -2.05, ease(clamp01((t - dropEnd) / 3.6)));
 const bodyY = t => {
  if (t < walkEnd) return dockDeckY;
  if (t < liftEnd) return lerp(dockDeckY, 0.55, ease(clamp01((t - walkEnd) / (liftEnd - walkEnd))));
  if (t < carryEnd) return 0.55 + (reduced.value ? 0 : Math.sin(clamp01((t - liftEnd) / (carryEnd - liftEnd)) * Math.PI * 4) * 0.03);
  if (t < pauseEnd) { const u = clamp01((t - carryEnd) / (pauseEnd - carryEnd)); return 0.55 + (reduced.value ? 0 : Math.sin(u * Math.PI * 2) * 0.022 * (1 - u)); }
  if (t < dropEnd) return throwY(clamp01((t - pauseEnd) / (dropEnd - pauseEnd)));
  return slowSink(t) + (reduced.value ? 0 : Math.sin(t * 1.4) * 0.045);
 };
 const bodyX = t => {
  if (t < liftEnd) return 0;
  if (t < carryEnd) return ease(clamp01((t - liftEnd) / (carryEnd - liftEnd))) * 1.15;
  if (t < dropEnd) return lerp(1.15, 1.22, ease(clamp01((t - pauseEnd) / (dropEnd - pauseEnd))));
  return 1.22;
 };
 const stoneTrack = t => {
  const restY = slowSink(dropEnd) - chainLength - 0.18;
  if (t < liftEnd) return -0.95;
  return lerp(-0.95, restY, ease(clamp01((t - liftEnd) / (dropEnd - liftEnd))))
   + (t > dropEnd ? slowSink(t) - slowSink(dropEnd) : 0);
 };
 const targetSway = e => {
  if (e < liftEnd || e >= dropEnd) return 0;
  if (e < carryEnd) return Math.sin(clamp01((e - liftEnd) / (carryEnd - liftEnd)) * Math.PI * 3) * 0.05;
  return Math.sin(e * 2.1) * 0.02 * (1 - clamp01((e - carryEnd) / (pauseEnd - carryEnd)));
 };
 const shoreGaze = pos => {
  const dx = shorePoint.x - pos.x, dy = shorePoint.y - pos.y, dz = shorePoint.z - pos.z;
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
 };
 const gripSpots = [[0.44, 0.62], [0.46, -0.62]];
 const backSpots = [[-0.5, 1.0], [-0.55, -1.0]];
 const escortStart = [[-1.9, 1.05], [-1.9, -1.05]];
 const crowdStart = [[-3.1, 1.35], [-3.25, 0.45], [-3.15, -0.5], [-3.0, -1.3], [-2.55, 1.6]];
 const crowdEnd = [[-0.95, 1.15], [-1.3, 0.4], [-1.1, -0.55], [-1.35, -1.25], [-0.65, 1.7]];

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const position = eyePos; // stage-scoped scratch, reused every frame
  let yaw = -Math.PI / 2, pitch = 0;
  const by = bodyY(elapsed);
  const bx = bodyX(elapsed);
  stoneRoot.position.set(sinkX + 0.06, stoneTrack(elapsed), 0.3); // z pulled toward the body axis so the look-down beat frames it (V3)

  // The target: carried the whole way, released at the edge.
  poseOnce(targetId, 'carried');
  target.player.position.set(bx, by, 0);
  target.player.rotation.set(0, -Math.PI / 2, reduced.value ? 0 : targetSway(elapsed));

  if (isSelf) {
   position.set(bx, by + eyeOff, 0);
   if (elapsed < walkEnd) {
    // The cast walks up; watch them come.
    yaw = Math.PI / 2; pitch = -0.08;
   } else if (elapsed < liftEnd) {
    // Gripped and raised: turn forward, look down at the hold (pitch leads the turn
    // so the sweeping view passes over the escorts' grip, not into their faces).
    const k = ease(clamp01((elapsed - walkEnd) / (liftEnd - walkEnd)));
    yaw = Math.PI / 2 + k * Math.PI; pitch = lerp(-0.08, -0.5, Math.min(1, k * 1.4));
   } else if (elapsed < carryEnd) {
    // Carried along the dock: the view sways gently side to side like a bumbled
    // carry, each swing catching one holding escort and the receding dock.
    const t = clamp01((elapsed - liftEnd) / (carryEnd - liftEnd));
    yaw = Math.PI * 1.5 - 0.3 + (reduced.value ? 0 : Math.sin(t * Math.PI * 3) * 0.45);
    pitch = lerp(-0.5, -0.42, t);
   } else if (elapsed < pauseEnd) {
    // Held at the shore edge: look straight down at the water, the holding escorts
    // leaning out ahead and the wing tips at the frame bottom.
    pitch = -0.55;
    yaw = Math.PI * 1.5 - 0.3;
   } else if (elapsed < dropEnd) {
    // Released: turn back to the crowd while falling.
    const t = ease(clamp01((elapsed - pauseEnd) / (dropEnd - pauseEnd)));
    const g = shoreGaze(position);
    yaw = Math.PI * 1.5 - t * Math.PI; pitch = lerp(-0.42, g[1], t);
   } else {
    // Slow sink: start on the shore gaze, then let the gaze sink toward the
    // chain/stone below so the look-down beat (design 1.2) actually frames them.
    const g = shoreGaze(position);
    const sinkK = clamp01((elapsed - dropEnd) / 1.1);
    [yaw, pitch] = [g[0], lerp(g[1], -1.0, sinkK)];
   }
  } else if (elapsed < dropEnd) {
   position.set(-1.75, dockDeckY + eyeH + 0.3, 0.35);
   yaw = Math.atan2(-(bx - position.x), -(0 - position.z));
   pitch = -0.06;
  } else {
   stage.lookMode = 'fixed';
   position.set(sinkX + 0.25, slowSink(elapsed) - 0.12, 2.55);
   yaw = 0;
   pitch = 0.02;
  }

  // Procession: everyone walks up; escorts take the grip, the rest watch from the
  // dock, and the escorts step back once the target is released.
  const walkK = ease(clamp01(elapsed / walkEnd));
  const release = clamp01((elapsed - dropEnd) / 0.5);
  const carryT = ease(clamp01((elapsed - liftEnd) / (carryEnd - liftEnd)));
  escorts.forEach((id, i) => {
   const avatar = actors.get(id);
   const s = escortStart[i % escortStart.length];
   const g = gripSpots[i % gripSpots.length];
   const b = backSpots[i % backSpots.length];
   // Walk in, take the grip, then keep pace just ahead-below of the carried body so
   // a downward glance lands on the holders; step back after the release.
   const hx = elapsed < liftEnd ? g[0] : lerp(g[0], bx + 0.35, carryT);
   const hz = elapsed < liftEnd ? g[1] : lerp(g[1], g[1] * 0.38, carryT);
   const px = lerp(s[0], hx, walkK), pz = lerp(s[1], hz, walkK);
   const fx = lerp(px, b[0], release), fz = lerp(pz, b[1], release);
   avatar.player.position.set(fx, dockDeckY, fz);
   avatar.player.rotation.set(0, faceYaw([fx, fz], elapsed < dropEnd ? [bx, 0] : [0.3, 0]), 0);
   poseOnce(id, elapsed < walkEnd ? 'standing' : elapsed < dropEnd - 0.04 ? 'carried' : 'standing');
  });
  watchers.forEach((id, i) => {
   const avatar = actors.get(id);
   const s = crowdStart[i % crowdStart.length];
   const e2 = crowdEnd[i % crowdEnd.length];
   const wx = lerp(s[0], e2[0], walkK), wz = lerp(s[1], e2[1], walkK);
   avatar.player.position.set(wx, dockDeckY, wz);
   avatar.player.rotation.set(0, faceYaw([wx, wz], [bx, 0]), 0);
   poseOnce(id, 'standing');
  });

  // Ambience follows the live curve: the splash fires when the BODY breaks the
  // surface, the underwater ambience when the EYE passes it; one splash, no second
  // flash. Wings part and droop as the eye sinks so the chain/stone stay readable.
  const bodyUnder = by < 0;
  const eyeUnder = by < -eyeOff;
  splashMat.opacity = !reduced.value && bodyUnder && by > -0.34 ? 1 - Math.min(1, -by / 0.34) : 0;
  stage.wingSplay = clamp01((-by - eyeOff) / 0.5) * 0.55;
  for (const b of bubbles) {
   const seed = b.userData.seed;
   const local = (elapsed * 0.4 + seed * 0.13) % 1;
   b.position.set(sinkX + Math.sin(seed * 3.1) * 0.5, by - 0.25 + local * 1.4, Math.cos(seed * 2.3) * 0.42 + 0.3);
   // Hide bubbles drifting right past the eye: a close sprite swelled into the
   // "ring artifact" the review flagged (V3 2026-09-24).
   const bx = b.position.x - position.x, byd = b.position.y - position.y, bz = b.position.z - position.z;
   b.visible = eyeUnder && elapsed < dropEnd + 3.5 && local < 0.7 && (bx * bx + byd * byd + bz * bz) > 0.2;
  }
  for (let i = 0; i < fishes.length; i++) {
   const f = fishes[i];
   const seed = f.userData.seed;
   const radius = 0.55 + (i % 3) * 0.3;
   const speed = 0.32 + (i % 4) * 0.07;
   const sign = i % 2 ? 1 : -1;
   const a = elapsed * speed * sign + seed;
   f.position.set(fishCenter.x + Math.cos(a) * radius, -0.45 - ((i * 0.23) % 0.85) - Math.sin(elapsed * 0.5 + seed) * 0.05, fishCenter.y + Math.sin(a) * radius * 0.7);
   f.rotation.y = Math.atan2(-Math.sin(a) * sign, Math.cos(a) * sign * 0.7);
   // Hard floor on eye distance: no fish ever lunges into the camera.
   const ex = f.position.x - position.x, ey = f.position.y - position.y, ez = f.position.z - position.z;
   const ed = Math.hypot(ex, ey, ez);
   if (eyeUnder && ed < 0.85 && ed > 1e-4) f.position.addScaledVector(tmpVecA.set(ex, ey, ez).normalize(), 0.85 - ed);
   f.visible = eyeUnder;
  }

  // Chain: bind to the performed body and to the GLB anchor, real link pitch.
  targetModel.updateWorldMatrix(true, false);
  const bindWorld = targetModel.localToWorld(tmpVecB.copy(bindLocal));
  stoneAnchorNode.updateWorldMatrix(true, false);
  const anchorWorld = stoneAnchorNode.getWorldPosition(tmpVecC);
  const span = tmpVecD.subVectors(anchorWorld, bindWorld);
  const len = Math.max(0.2, span.length());
  const dir = tmpVecE.copy(span).normalize();
 const linkLen = len / chainCount;
 const scaleLong = (linkLen * 1.14) / 0.126;
 // Slightly beefier links so they read at 1-2m on the look-down beat (V3).
 tmpScale.set(1.05, scaleLong, 1.05);
  for (let i = 0; i < chainCount; i++) {
   const t = (i + 0.5) / chainCount;
   tmpLink.copy(bindWorld).addScaledVector(span, t);
   tmpQuat.setFromUnitVectors(UP, dir);
   if (i % 2) tmpQuat.multiply(TWIST_Q);
   tmpMat.compose(tmpLink, tmpQuat, tmpScale);
   chain.setMatrixAt(i, tmpMat);
   if (i === 0) stage.linkTopEnd = tmpEnd.copy(tmpLink).addScaledVector(dir, -0.57 * linkLen).toArray();
   if (i === chainCount - 1) stage.linkBottomEnd = tmpEnd.copy(tmpLink).addScaledVector(dir, 0.57 * linkLen).toArray();
  }
  chain.instanceMatrix.needsUpdate = true;

  stage.modelTop = bindWorld.toArray();
  stage.modelBottom = anchorWorld.toArray();
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();

  camera.position.copy(position);
  stage.baseYaw = yaw;
  stage.basePitch = pitch;
 };

 stage.diagnostics = () => ({
  modelTop: stage.modelTop, modelBottom: stage.modelBottom,
  linkTopEnd: stage.linkTopEnd, linkBottomEnd: stage.linkBottomEnd,
  trajectory: stage.trajectory,
 });

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
  splashMat.opacity = 0;
  for (const b of bubbles) b.visible = false;
  for (const f of fishes) f.visible = false;
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
