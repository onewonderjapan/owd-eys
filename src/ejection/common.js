// Shared scaffolding for the ejection stages (mechanical split out of
// immersion-ejection.js, 2026-09-23 night — zero behavior change). One stage per
// playback. The stage owns a continuous body trajectory (lift -> carry ->
// release/throw -> settle); the director reads the eye from it and layers the
// user's look deltas on top. Chain anchors bind to the performed body and to the
// GLB's chain_anchor world position.
//
// `createEjectionContext` builds everything every stage needs before its
// style-specific setup: the offscreen scene/camera pair, the ownership list
// (`take`), the pose deduper, the cast split into escorts/watchers with their
// millimeter-detail hiding, and the pit-facing helper. `finishStage(ctx, build)`
// runs a stage module's buildStage(ctx) and then attaches the shared epilogue
// (projection / detachActors / dispose), in the same order as the original file.
import * as THREE from 'three';

export const UP = new THREE.Vector3(0, 1, 0);
export const tmpMat = new THREE.Matrix4();
export const tmpVecA = new THREE.Vector3();
// Per-frame scratch for the chain solve and camera track — the ejection update
// used to allocate ~5 objects per link per frame (GC churn during the showpiece)
export const tmpVecB = new THREE.Vector3(), tmpVecC = new THREE.Vector3(), tmpVecD = new THREE.Vector3(), tmpVecE = new THREE.Vector3();
export const tmpLink = new THREE.Vector3(), tmpEnd = new THREE.Vector3(), tmpScale = new THREE.Vector3(0.8, 1, 0.8);
export const tmpQuat = new THREE.Quaternion();
export const TWIST_Q = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = t => Math.min(1, Math.max(0, t));
export const ease = t => t * t * (3 - 2 * t);
// Smooth waypoint track: keys = [[time, [x,y,z]], ...] with ascending times.
// Writes into `out` — callers own the vector, no per-frame allocation.
export function track(t, keys, out) {
 if (t <= keys[0][0]) return out.set(...keys[0][1]);
 for (let i = 1; i < keys.length; i++) {
  if (t <= keys[i][0]) {
   const [t0, a] = keys[i - 1], [t1, b] = keys[i];
   const k = ease((t - t0) / (t1 - t0));
   return out.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
  }
 }
 return out.set(...keys[keys.length - 1][1]);
}

export function createEjectionContext({actors, targetId, playerActorId, style, config, props}) {
 const isSelf = targetId === playerActorId;
 const target = actors.get(targetId);
 const targetModel = target.model;

 const scene = new THREE.Scene();
 const camera = new THREE.PerspectiveCamera(74, 1, 0.035, 80);
 scene.add(camera);
 const owned = [];
 const eyePos = new THREE.Vector3(); // camera-track scratch, reused each frame
 const take = o => {
  if (Array.isArray(o)) owned.push(...o);
  else owned.push(o);
  return o;
 };

 const stage = {scene, camera, style, isSelf, lookMode: 'free', wingSplay: 0, trajectory: {body: [0, 0, 0], eye: [0, 0, 0]}};

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
 // Detail-only simplification for carried figures. NEVER use bare /seam/ —
 // the body+head mesh is 'BASE_|_shared_seamless_rounded_body' and /seam/
 // matched it, hiding every watcher's body (floating heads/eyes bug). Also
 // avoid /crown/: it hides hat crowns. Only true millimeter details:
 const watcherSimplify = /toe_seam|nostril|eye_sparkle|mouth_crease/i;
 const escortSimplify = /toe_seam|nostril|eye_sparkle|mouth_crease/i;
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

 return {actors, targetId, playerActorId, style, config, props,
  isSelf, target, targetModel, scene, camera, owned, take, eyePos, stage,
  reduced, lastPose, poseOnce,
  dockDeckY, sinkX, chainLength, stoneScale, eyeH, pitX, bindLocal,
  escorts, watchers, faceYaw, setHiddenParts, facePit};
}

export function finishStage(ctx, build) {
 const {actors, scene, camera, owned, stage} = ctx;
 build(ctx);

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
