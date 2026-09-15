// Short ejection performances (water / fire). One stage per playback. The stage owns a
// continuous body trajectory (lift -> carry -> release/throw -> settle); the director
// reads the eye from it and layers the user's look deltas on top. Chain anchors bind to
// the performed body and to the GLB's chain_anchor world position.
import * as THREE from 'three';
import {IMMERSION_CONFIG} from './immersion-config.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpMat = new THREE.Matrix4();
const tmpVecA = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.min(1, Math.max(0, t));
const ease = t => t * t * (3 - 2 * t);
// Smooth waypoint track: keys = [[time, [x,y,z]], ...] with ascending times.
function track(t, keys) {
 if (t <= keys[0][0]) return new THREE.Vector3(...keys[0][1]);
 for (let i = 1; i < keys.length; i++) {
  if (t <= keys[i][0]) {
   const [t0, a] = keys[i - 1], [t1, b] = keys[i];
   const k = ease((t - t0) / (t1 - t0));
   return new THREE.Vector3(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
  }
 }
 return new THREE.Vector3(...keys[keys.length - 1][1]);
}
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
function softBubbleTexture() {
 // Faint filled core with a brighter rim: reads as a transparent bubble outline
 // instead of a solid gray polygon.
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = 64;
 const g = canvas.getContext('2d');
 const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
 grad.addColorStop(0, 'rgba(215,238,250,0.10)');
 grad.addColorStop(0.62, 'rgba(210,235,248,0.16)');
 grad.addColorStop(0.88, 'rgba(222,242,252,0.42)');
 grad.addColorStop(1, 'rgba(222,242,252,0)');
 g.fillStyle = grad;
 g.beginPath();
 g.arc(32, 32, 30, 0, Math.PI * 2);
 g.fill();
 const tex = new THREE.CanvasTexture(canvas);
 tex.colorSpace = THREE.SRGBColorSpace;
 return tex;
}

export function createEjectionStage({actors, targetId, playerActorId, style, config, props}) {
 const isSelf = targetId === playerActorId;
 const target = actors.get(targetId);
 const targetModel = target.model;

 const scene = new THREE.Scene();
 const camera = new THREE.PerspectiveCamera(74, 1, 0.035, 80);
 scene.add(camera);
 const owned = [];
 const take = o => {
  if (Array.isArray(o)) owned.push(...o);
  else owned.push(o);
  return o;
 };

 const stage = {scene, camera, style, isSelf, lookMode: 'free', wingSplay: 0, trajectory: {body: [0, 0, 0], eye: [0, 0, 0]}};
 let flames = [], flameMat = null, flameTex = null;

 const reduced = {value: false}; // updated each frame from update({reducedMotion})
 const lastPose = {};
 const poseOnce = (id, mode) => {
  if (lastPose[id] !== mode) {
   actors.pose(id, mode);
   lastPose[id] = mode;
  }
 };

 const dockDeckY = 0.12;
 const sinkX = 1.15;
 const chainLength = 1.02;
 // Native stone is ~0.30m; scaled to ~0.31m it reads as an independent boulder at
 // 0.5-0.7x the target's body width per the water reference.
 const stoneScale = 0.85;
 const eyeH = 0.755;
 const pitX = 2.3;
 const bindLocal = new THREE.Vector3(0, 0.14, 0.12); // lower belly, slightly forward
 // Everyone except the target: the first two take the grip, the rest walk up as the
 // watching crowd (the user script: the whole cast comes for the ejected goose).
 const escorts = actors.ids.filter(id => id !== targetId).slice(0, config.limits.escorts);
 const watchers = actors.ids.filter(id => id !== targetId && !escorts.includes(id));
 const faceYaw = (from, to) => Math.atan2(to[0] - from[0], -(to[1] - from[1]));
 // The procession beat is draw-call bound in software renderers. Sub-centimeter parts
 // (toe seams, nostrils, eye sparkles, bill crease) never read at performance
 // distances, so background walkers skip them; escorts keep their crown tufts.
 const watcherSimplify = /seam|nostril|sparkle|crease|crown|chest feather/i;
 const escortSimplify = /seam|nostril|sparkle|crease/i;
 const hiddenParts = [];
 for (const id of watchers) {
  const avatar = actors.get(id);
  avatar?.player.traverse(o => { if (o.isMesh && watcherSimplify.test(o.name)) hiddenParts.push(o); });
 }
 for (const id of escorts) {
  const avatar = actors.get(id);
  avatar?.player.traverse(o => { if (o.isMesh && escortSimplify.test(o.name)) hiddenParts.push(o); });
 }
 const setHiddenParts = visible => { for (const o of hiddenParts) o.visible = visible; };

 // ============================================================ shared helpers ==
 const facePit = (pos, out) => {
  const tx = pitX, ty = 0.32, tz = 0;
  const dx = tx - pos.x, dz = tz - pos.z;
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(ty - pos.y, Math.hypot(dx, dz));
  return out;
 };

 // ================================================================== WATER ===
 if (style === 'water') {
  scene.background = new THREE.Color('#0d3357');
  scene.fog = new THREE.Fog('#0d3357', 3.0, 16);
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
   take(new THREE.MeshStandardMaterial({color: '#123f66', roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.94})));
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const sun = new THREE.DirectionalLight('#bfe2ff', 1.35);
  sun.position.set(0.5, 8, 2.5);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight('#7fb4d8', '#04121f', 0.5));

  const dock = props.instantiate('prop_dock');
  dock.position.set(-2.6, 0.02, 0);
  scene.add(dock);
  take(dock);

  const stoneRoot = props.instantiate('prop_sink_stone');
  stoneRoot.scale.setScalar(stoneScale * 1.2);
  scene.add(stoneRoot);
  take(stoneRoot);
  const stoneBody = stoneRoot.getObjectByName('sink_stone_body');
  if (stoneBody && stoneBody.material) {
   stoneBody.material = stoneBody.material.clone();
   take(stoneBody.material);
   stoneBody.material.color = new THREE.Color('#525d68');
   stoneBody.material.emissive = new THREE.Color('#13171c');
  }
  const stoneAnchorNode = stoneRoot.getObjectByName(props.nodeNames().chainAnchor);

  const chainProto = props.chainPrototype();
  const chainMat = take(chainProto.material.clone());
  chainMat.color = new THREE.Color('#4c565f'); // faint lift so links read in deep water
  chainMat.emissive = new THREE.Color('#12161c');
  const chainCount = 28;
  const chain = new THREE.InstancedMesh(take(chainProto.geometry), chainMat, chainCount);
  chain.frustumCulled = false;
  scene.add(chain);

  const splashGeo = take(new THREE.PlaneGeometry(1.1, 0.72));
  const splashMat = take(new THREE.MeshBasicMaterial({color: '#cfe6f2', transparent: true, opacity: 0, depthTest: false, fog: false}));
  const splash = new THREE.Mesh(splashGeo, splashMat);
  splash.position.set(0, 0, -0.6);
  splash.renderOrder = 5;
  camera.add(splash);

  const bubbleTex = take(softBubbleTexture());
  const bubbleMat = take(new THREE.SpriteMaterial({map: bubbleTex, transparent: true, opacity: 0.4, depthWrite: false, fog: false}));
  const bubbles = [];
  for (let i = 0; i < 6; i++) {
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
  const eyeOff = eyeH * 0.9;
  const shorePoint = new THREE.Vector3(-1.1, 1.0, 0); // the crowd waiting on the dock
  const throwY = t => lerp(0.55, -0.75, ease(t)) + (reduced.value ? 0 : Math.sin(t * Math.PI) * 0.12);
  const slowSink = t => lerp(-0.75, -1.19, ease(clamp01((t - dropEnd) / 3.6)));
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
   const position = new THREE.Vector3();
   let yaw = -Math.PI / 2, pitch = 0;
   const by = bodyY(elapsed);
   const bx = bodyX(elapsed);
   stoneRoot.position.set(sinkX + 0.06, stoneTrack(elapsed), 0.55);

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
     // Slow sink: keep watching the geese on the shore.
     [yaw, pitch] = shoreGaze(position);
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
    b.visible = eyeUnder && elapsed < dropEnd + 3.5 && local < 0.7;
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
   const bindWorld = targetModel.localToWorld(bindLocal.clone());
   stoneAnchorNode.updateWorldMatrix(true, false);
   const anchorWorld = stoneAnchorNode.getWorldPosition(new THREE.Vector3());
   const len = Math.max(0.2, bindWorld.distanceTo(anchorWorld));
   const dir = anchorWorld.clone().sub(bindWorld).normalize();
   const linkLen = len / chainCount;
   const scaleLong = (linkLen * 1.14) / 0.126;
   for (let i = 0; i < chainCount; i++) {
    const t = (i + 0.5) / chainCount;
    const linkPos = bindWorld.clone().addScaledVector(anchorWorld.clone().sub(bindWorld), t);
    const twist = new THREE.Quaternion().setFromAxisAngle(UP, (i % 2) * Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir).multiply(twist);
    tmpMat.compose(linkPos, q, new THREE.Vector3(0.8, scaleLong, 0.8));
    chain.setMatrixAt(i, tmpMat);
    if (i === 0) stage.linkTopEnd = linkPos.clone().addScaledVector(dir, -0.57 * linkLen).toArray();
    if (i === chainCount - 1) stage.linkBottomEnd = linkPos.clone().addScaledVector(dir, 0.57 * linkLen).toArray();
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

 // =================================================================== FIRE ===
 else {
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

  scene.add(new THREE.HemisphereLight('#6b5847', '#120c08', 0.4));
  const rim = new THREE.DirectionalLight('#8ea6c0', 0.35);
  rim.position.set(-3, 4, -4);
  scene.add(rim);

  // Flames: gradient-textured planes rooted at the logs; no hard rectangle edges.
  flameTex = take(softFlameTexture());
  const flameGeo = take(new THREE.PlaneGeometry(0.34, 0.62));
  flameGeo.translate(0, 0.31, 0); // origin at the flame root
  flameMat = take(new THREE.MeshBasicMaterial({map: flameTex, transparent: true, opacity: 0.85,
   blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
  flames = [];
  for (let i = 0; i < 9; i++) {
   const a = (i / 9) * Math.PI * 2;
   const fx = pitX + Math.cos(a) * 0.2, fz = Math.sin(a) * 0.2;
   for (const rot of [0, Math.PI / 2.6]) {
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
   [carryEnd, [0.95, 1.22, 0]], [dropEnd, [0.8, 0.92, 0]], [7.5, [0.72, 0.82, 0]],
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
   const position = track(elapsed, isSelf ? camTrackSelf : camTrackNpc);
   let yaw, pitch;
   if (isSelf && elapsed < walkEnd) {
    // The cast walks up; watch them come before the pit gaze takes over.
    yaw = Math.PI / 2; pitch = -0.05;
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

 stage.projection = (width, height) => {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
 };

 stage.detachActors = () => {
  for (const id of actors.ids) {
   const avatar = actors.get(id);
   if (avatar && avatar.player.parent === scene) scene.remove(avatar.player);
  }
 };

 stage.dispose = () => {
  stage.detachActors();
  for (const object of owned) if (object.dispose) object.dispose();
  scene.clear();
 };

 return stage;
}

export const EJECTION_STYLE_DURATION = style => (IMMERSION_CONFIG.timings[style] ?? IMMERSION_CONFIG.timings.water);
