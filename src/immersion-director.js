// Session director for the POV immersion feature. Owns the state machine clock, the
// temporary scenes/cameras handed to the walking render loop, actor/stage lifecycles,
// one-shot audio cues and the DOM UI. Never writes walker.position directly.
import * as THREE from 'three';
import {IMMERSION_CONFIG, selectRoster, pickSessionSpeeches} from './immersion-config.js';
import {createImmersionState} from './immersion-state.js';
import {createImmersionAudio} from './immersion-audio.js';
import {createImmersionLook} from './immersion-look.js';
import {ensureImmersionUi} from './immersion-ui.js';
import {loadImmersionActors} from './immersion-actors.js';
import {createWorldBell, createMeetingStage} from './immersion-meeting.js';
import {createEjectionStage} from './immersion-ejection.js';

const WING_SCALE = 0.28;
const lerp = (a, b, t) => a + (b - a) * t;

export function createImmersionDirector({props, worldScene, host, canvas, getWalker, getNavigation, getActorId, onEnd, onPropsUnavailable}) {
 const machine = createImmersionState();
 const audio = createImmersionAudio();
 const look = createImmersionLook({canvas, host});
 const ui = ensureImmersionUi(host);

 let session = 0; // increments on start/retry/cancel; late async results check against it
 let sessionSpeeches = [];
 let actors = null;
 let playerActorId = null;
 let worldBell = null;
 let meetingStage = null;
 let ejectionStage = null;
 let lastStageKind = null;
 let ringCamera = null;
 let ringWings = null;
 let selfPov = null; // head-mounted self camera state (see buildSelfPov)
 let loadingProgress = null;
 let nearBell = null;
 let endReason = null;
 let endNotified = false;
 let cues = new Set();
 let uiTick = 0;
 let walkFrozenAt = null;
 let positionDrift = null;

 const isCurrent = gen => gen === session;

 function attachWorldBell() {
  if (worldBell || !props.state().ready) return false;
  worldBell = createWorldBell({config: IMMERSION_CONFIG, props});
  worldScene.add(worldBell.group);
  return true;
 }

 function bellEyePose() {
  // interaction is [x, z] — the old [x, , z] destructure left z undefined and
  // parked the ring camera at world z=0, ~7m from the bell (V4 2026-09-24).
  const [x, z] = IMMERSION_CONFIG.bell.interaction;
  const [bx, by, bz] = IMMERSION_CONFIG.bell.base;
  return {position: [x, by + 0.755, z], target: [bx, by + 0.52, bz]};
 }

 // Projected on-screen width of the bell (bbox corners through the ring camera),
 // as a fraction of the viewport width. V4 2026-09-24: the ring beat used to show
 // the bell a few pixels wide; the smoke gates on this number.
 function ringBellProjection() {
  if (!worldBell || !ringCamera) return null;
  const bbox = new THREE.Box3().setFromObject(worldBell.group);
  if (bbox.isEmpty()) return null;
  const v = new THREE.Vector3();
  let minX = 1, maxX = -1, minY = 1, maxY = -1;
  for (let i = 0; i < 8; i++) {
   v.set(i & 1 ? bbox.max.x : bbox.min.x, i & 2 ? bbox.max.y : bbox.min.y, i & 4 ? bbox.max.z : bbox.min.z);
   v.project(ringCamera);
   minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
   minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return {widthFrac: +(maxX - minX).toFixed(4), heightFrac: +(maxY - minY).toFixed(4)};
 }

 function ensureRingCamera() {
  if (!ringCamera) {
   ringCamera = new THREE.PerspectiveCamera(78, 1, 0.05, 60);
   worldScene.add(ringCamera);
  }
  const eye = bellEyePose();
  ringCamera.position.set(...eye.position);
  ringCamera.lookAt(...eye.target);
  ringCamera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
  ringCamera.updateProjectionMatrix();
  return ringCamera;
 }

 function buildRingWings() {
  destroyRingWings();
  if (!actors) return;
  ringWings = actors.extractWings(playerActorId);
  if (!ringWings) return;
  ringWings.scale.setScalar(WING_SCALE);
  ringWings.position.set(0.2, -0.38, -0.5);
  ringWings.rotation.set(0.24, -0.3, 0);
  ensureRingCamera().add(ringWings);
 }

 function destroyRingWings() {
  if (ringWings && ringWings.parent) ringWings.parent.remove(ringWings);
  ringWings = null;
 }

 // ---------------------------------------------------------------------------
 // Self POV: the camera rides the player's own head and the real body is shown
 // (2026-09-24). This replaces the proxy wing rig, which followed the tumbling
 // body while the camera followed a separately authored eye track, so the "hands"
 // flew around the frame (measured drift: flush 0.80, boulder 6.0, space 8.2 NDC).
 //
 // Nothing is hand-placed per angle or per character:
 // - the eye point comes from the eye meshes' bounds (model space), on the
 //   midline, pushed just in front of the face so the camera is outside the head;
 // - only the head is hidden in first person (eyes, beak, crown feathers, and any
 //   headwear/facewear socket), so looking down shows your chest, wings, feet and
 //   clothes -- always in sync because it is the actual posed body;
 // - the stage keeps its framing intent: whatever point its authored camera was
 //   looking at, the head camera looks at the same point;
 // - stabilised: the own body stays upright (a stage's spin/tumble survives only
 //   as a mild camera wobble, zero under reduced motion);
 // - a stage may hand the view back to its authored third-person camera from
 //   `stage.selfPovUntil` (e.g. the chandelier impact, the boulder flattening),
 //   with a 0.35s blend either way.
 const SELF_POV_BLEND = 0.35;
 const SELF_POV_NEAR = 0.5;    // metres: other heads closer than this to the lens are culled
 const SELF_POV_HEAD_Y = 0.72; // approximate head height above an actor's feet (0.28-scale avatars)
 const SELF_POV_PITCH = [-0.32, 0.45]; // default head-cam pitch band (rad); user look adds on top
 const povEye = new THREE.Vector3(), povAuthored = new THREE.Vector3(), povFwd = new THREE.Vector3(), povTarget = new THREE.Vector3();
 function setHeadHidden(hidden) {
  if (!selfPov || selfPov.headHidden === hidden) return;
  selfPov.headHidden = hidden;
  for (const h of selfPov.hidden) h.o.visible = hidden ? false : h.visible;
 }
 function buildSelfPov() {
  destroySelfPov();
  if (!actors || !ejectionStage || !ejectionStage.isSelf) return;
  const avatar = actors.get(playerActorId);
  if (!avatar) return;
  const model = avatar.model;
  model.updateWorldMatrix(true, true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const eyeBox = new THREE.Box3(), part = new THREE.Box3();
  const hidden = [];
  let bodyMesh = null;
  model.traverse(o => {
   const slot = o.userData && o.userData.slot;
   if (slot === 'headwear' || slot === 'facewear') { hidden.push({o, visible: o.visible}); return; }
   if (!o.isMesh) return;
   const name = o.name || '';
   // GLTFLoader sanitizes node names (spaces -> '_'), so match either separator.
   if (/seamless[\s_]rounded[\s_]body/i.test(name)) bodyMesh = o;
   if (/eye[\s_](white[\s_]sclera|ink[\s_]rim)/i.test(name)) { part.setFromObject(o); part.applyMatrix4(toModel); eyeBox.union(part); }
   if (/(^|[\s_|])eye([\s_]|$)|beak|nostril|crown|mouth[\s_]crease/i.test(name)) hidden.push({o, visible: o.visible});
  });
  if (eyeBox.isEmpty()) return;
  const eyeCenter = eyeBox.getCenter(new THREE.Vector3());
  // Head surface in front of the eyes on the midline, so the camera never sits inside the head.
  let front = eyeBox.max.z;
  if (bodyMesh && bodyMesh.geometry && bodyMesh.geometry.attributes.position) {
   const pos = bodyMesh.geometry.attributes.position, v = new THREE.Vector3();
   const meshToModel = new THREE.Matrix4().multiplyMatrices(toModel, bodyMesh.matrixWorld);
   for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(meshToModel);
    if (Math.abs(v.x) < 0.3 && Math.abs(v.y - eyeCenter.y) < 0.2 && v.z > front) front = v.z;
   }
  }
  selfPov = {
   avatar, hidden, headHidden: false, blend: 1, roll: 0, mode: 'head', camToEye: 0,
   // 0.2 model units (~5.6cm at the 0.28 avatar scale) ahead of the face, so a
   // raised gaze does not catch the top of the head in the upper edge of the frame.
   eyeLocal: new THREE.Vector3(0, eyeCenter.y, front + 0.2),
  };
  setHeadHidden(true);
 }
 const shortAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
 function applySelfPov(dt, elapsed, reducedMotion) {
  if (!selfPov || !ejectionStage) return;
  const stage = ejectionStage, cam = stage.camera, tp = selfPov.avatar.player;
  const handBack = typeof stage.selfPovUntil === 'number' && elapsed >= stage.selfPovUntil;
  const step = dt > 0 ? dt / SELF_POV_BLEND : 0;
  selfPov.blend = Math.min(1, Math.max(0, selfPov.blend + (handBack ? -step : step)));
  if (dt === 0) selfPov.blend = handBack ? 0 : 1; // paused/finished frames settle instantly, no drift
  selfPov.mode = handBack ? (selfPov.blend > 0 ? 'blend-out' : 'authored') : (selfPov.blend < 1 ? 'blend-in' : 'head');
  // Stabilise the own body; keep the stage's spin only as a mild camera wobble.
  const spin = tp.rotation.z;
  if (!handBack) { tp.rotation.z = 0; tp.visible = true; }
  setHeadHidden(!handBack);
  selfPov.roll = reducedMotion || handBack ? 0 : Math.sin(spin) * 0.18;
  // Authored framing: the point the stage camera meant to look at.
  const yaw = stage.baseYaw ?? 0, pitch = stage.basePitch ?? 0;
  povAuthored.copy(cam.position);
  povFwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  povTarget.copy(povAuthored).addScaledVector(povFwd, 3);
  tp.updateWorldMatrix(true, true);
  povEye.copy(selfPov.eyeLocal).applyMatrix4(selfPov.avatar.model.matrixWorld);
  const dx = povTarget.x - povEye.x, dy = povTarget.y - povEye.y, dz = povTarget.z - povEye.z;
  const flat = Math.hypot(dx, dz);
  // If the authored shot was looking at (or right past) the body itself, face
  // the way the body faces instead of staring into your own chest.
  tp.getWorldDirection(povFwd); // +z of the player group = where the goose faces
  const bodyYaw = Math.atan2(-povFwd.x, -povFwd.z); // camera yaw whose forward (-sin, -cos) equals the facing
  const headYaw = flat > 0.8 ? Math.atan2(-dx, -dz) : bodyYaw;
  // Default gaze stays near level: the authored cameras mostly shot from above,
  // and the same target seen from the head meant looking straight down into the
  // (large) goose body. The body shows at the bottom edge; dragging down still
  // reveals all of it, because the user's look delta is added on top.
  // A stage can release the band for a beat whose point IS looking down
  // (water: watching the chain and stone pull you under, design 1.2).
  const rawPitch = Math.atan2(dy, Math.max(flat, 1e-4));
  const pitchFree = typeof stage.selfPovFreePitchAfter === 'number' && elapsed >= stage.selfPovFreePitchAfter;
  const headPitch = pitchFree ? rawPitch : Math.min(SELF_POV_PITCH[1], Math.max(SELF_POV_PITCH[0], rawPitch));
  const b = selfPov.blend * selfPov.blend * (3 - 2 * selfPov.blend);
  cam.position.lerpVectors(povAuthored, povEye, b);
  stage.baseYaw = shortAngle(yaw, headYaw, b);
  stage.basePitch = pitch + (headPitch - pitch) * b;
  selfPov.camToEye = +cam.position.distanceTo(povEye).toFixed(4);
  if (stage.trajectory) stage.trajectory.eye = cam.position.toArray(); // audio cues follow the real eye
  // Near-camera cull: the escorts carrying you hold their heads right beside
  // yours, so a head would fill half the frame. Anyone whose head comes within
  // SELF_POV_NEAR of the lens is hidden while it stays that close. We keep our
  // own ledger and restore them ourselves: most stages set actor visibility only
  // once in begin(), so a cull that relied on the stage to undo it stuck for the
  // rest of the performance (the whole fire crowd vanished after the carry).
  const culledSet = selfPov.culledSet || (selfPov.culledSet = new Set());
  for (const id of actors.ids) {
   if (id === playerActorId) continue;
   const other = actors.get(id);
   if (!other) continue;
   other.player.getWorldPosition(povFwd);
   povFwd.y += SELF_POV_HEAD_Y;
   const near = b > 0.5 && povFwd.distanceTo(cam.position) < SELF_POV_NEAR;
   if (near && other.player.visible) { other.player.visible = false; culledSet.add(id); }
   else if (!near && culledSet.has(id)) { other.player.visible = true; culledSet.delete(id); }
  }
  selfPov.culled = culledSet.size;
 }
 function restoreSelfPovCulled() {
  if (!selfPov || !selfPov.culledSet || !actors) return;
  for (const id of selfPov.culledSet) { const other = actors.get(id); if (other) other.player.visible = true; }
  selfPov.culledSet.clear();
 }
 // The goose's head and body are ONE mesh, so the head cannot be hidden on its
 // own. With the lens just in front of the face, any gaze that is not the way the
 // body faces looked straight through your own head (centre-ray diagnostic: own
 // body mesh at 8cm). So in first person the body turns with the gaze, as in any
 // FPS: after the final camera rotation (authored + user look) is known, the body
 // is yawed until its facing matches the camera's horizontal heading, then the
 // eye point is re-derived and the lens re-seated on it. Self view only -- the
 // bystander (NPC) view keeps the stage's own choreography untouched.
 const alignCamDir = new THREE.Vector3(), alignBodyDir = new THREE.Vector3();
 function alignSelfBodyToGaze() {
  if (!selfPov || !ejectionStage || selfPov.blend <= 0.5) return;
  const cam = ejectionStage.camera, tp = selfPov.avatar.player, model = selfPov.avatar.model;
  cam.updateMatrixWorld();
  cam.getWorldDirection(alignCamDir);
  model.updateWorldMatrix(true, false);
  model.getWorldDirection(alignBodyDir); // +z of the model = where the goose faces
  if (Math.hypot(alignCamDir.x, alignCamDir.z) < 1e-3 || Math.hypot(alignBodyDir.x, alignBodyDir.z) < 1e-3) return;
  const delta = Math.atan2(alignCamDir.x, alignCamDir.z) - Math.atan2(alignBodyDir.x, alignBodyDir.z);
  tp.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta));
  tp.updateWorldMatrix(true, true);
  povEye.copy(selfPov.eyeLocal).applyMatrix4(model.matrixWorld);
  const b = selfPov.blend * selfPov.blend * (3 - 2 * selfPov.blend);
  cam.position.lerpVectors(povAuthored, povEye, b);
  selfPov.camToEye = +cam.position.distanceTo(povEye).toFixed(4);
  if (ejectionStage.trajectory) ejectionStage.trajectory.eye = cam.position.toArray();
 }
 // What the centre of the self view is looking at: first visible mesh hit by a
 // ray through the screen centre, its owner (actor id, or 'scene') and distance.
 // Diagnostic for the smoke -- a goose filling the frame shows up as a hit < 0.4m.
 const povRay = new THREE.Raycaster(), povNdc = new THREE.Vector2(0, 0);
 function selfPovCenterHit() {
  if (!ejectionStage) return null;
  const cam = ejectionStage.camera;
  cam.updateMatrixWorld();
  povRay.setFromCamera(povNdc, cam);
  povRay.near = 0.01; povRay.far = 30;
  const visibleChain = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  const hit = povRay.intersectObject(ejectionStage.scene, true).find(h => h.object.isMesh && visibleChain(h.object));
  if (!hit) return null;
  let owner = 'scene';
  for (const id of actors ? actors.ids : []) {
   const p = actors.get(id)?.player;
   for (let n = hit.object; n; n = n.parent) if (n === p) { owner = id; break; }
   if (owner !== 'scene') break;
  }
  return {owner, self: owner === playerActorId, name: String(hit.object.name || '').slice(0, 40), distance: +hit.distance.toFixed(3)};
 }
 function selfPovState() {
  if (!selfPov) return null;
  return {mode: selfPov.mode, blend: +selfPov.blend.toFixed(3), camToEye: selfPov.camToEye,
   bodyVisible: Boolean(selfPov.avatar.player.visible), headHidden: selfPov.headHidden, roll: +selfPov.roll.toFixed(3), culled: selfPov.culled || 0,
   centerHit: selfPovCenterHit(),
   eye: ejectionStage ? ejectionStage.camera.position.toArray().map(v => +v.toFixed(2)) : null,
   authored: povAuthored.toArray().map(v => +v.toFixed(2)),
   yaw: ejectionStage ? +ejectionStage.camera.rotation.y.toFixed(2) : null,
   pitch: ejectionStage ? +ejectionStage.camera.rotation.x.toFixed(2) : null,
   others: ejectionStage && actors ? actors.ids.filter(id => id !== playerActorId).map(id => {
    const pl = actors.get(id)?.player;
    if (!pl) return {id, missing: true};
    const w = pl.getWorldPosition(new THREE.Vector3()); w.y += SELF_POV_HEAD_Y;
    const n = w.clone().project(ejectionStage.camera);
    return {id: id.slice(-2), vis: pl.visible, inScene: pl.parent === ejectionStage.scene, ndc: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(3)]};
   }) : null};
 }
 function destroySelfPov() {
  if (selfPov) {
   setHeadHidden(false);
   restoreSelfPovCulled();
   selfPov.avatar.player.rotation.z = 0;
  }
  selfPov = null;
 }

 function fireCue(key, cue) {
  if (cues.has(key)) return;
  cues.add(key);
  audio.play(cue);
 }

 // Phase-entry side effects. Runs once per transition inside update().
 function enterPhase(phase) {
  const snapshot = machine.snapshot();
  switch (phase) {
   case 'ringing':
    ensureRingCamera();
    buildRingWings();
    if (worldBell) worldBell.update(0);
    break;
   case 'seating':
    if (worldBell) worldBell.update(0);
    if (meetingStage) {
     meetingStage.reset();
     meetingStage.projection(host.clientWidth, Math.max(1, host.clientHeight));
    }
    look.enable({yaw: 0, pitch: -0.12, minPitch: IMMERSION_CONFIG.meeting.pitchRange[0], maxPitch: IMMERSION_CONFIG.meeting.pitchRange[1]});
    fireCue('seating:enter', 'chair');
    break;
   case 'voting':
    ui.setAvatars(snapshot.actorIds.slice(1), snapshot.selectedId, extras.describeActor, false);
    break;
   case 'ejection': {
    if (meetingStage) meetingStage.detachActors();
    destroySelfPov();
    if (ejectionStage && stageMatches(snapshot)) {
     ejectionStage.reset();
    } else {
     if (ejectionStage) ejectionStage.dispose();
     ejectionStage = createEjectionStage({
      actors, targetId: snapshot.targetId, playerActorId,
      style: snapshot.style, config: IMMERSION_CONFIG, props,
     });
     lastStageKind = 'ejection';
    }
    ejectionStage.begin();
    buildSelfPov();
    ejectionStage.projection(host.clientWidth, Math.max(1, host.clientHeight));
    const underwater = snapshot.style === 'water';
    look.enable({
     yaw: -Math.PI / 2, pitch: -0.05,
     minPitch: underwater ? IMMERSION_CONFIG.underwaterPitchRange[0] : -0.9,
     maxPitch: underwater ? IMMERSION_CONFIG.underwaterPitchRange[1] : 0.7,
    });
    break;
   }
   case 'returning':
    break;
   default:
    break;
  }
 }

 function stageMatches(snapshot) {
  return ejectionStage && ejectionStage.style === snapshot.style;
 }

 function renderTargetFor(phase) {
  if (phase === 'ringing') return {scene: worldScene, camera: ensureRingCamera()};
  if (['seating', 'discussion', 'voting', 'result'].includes(phase) && meetingStage)
   return {scene: meetingStage.scene, camera: meetingStage.camera};
  if (['ejection', 'finished'].includes(phase) && ejectionStage)
   return {scene: ejectionStage.scene, camera: ejectionStage.camera};
  if (phase === 'returning' && lastStageKind === 'ejection' && ejectionStage)
   return {scene: ejectionStage.scene, camera: ejectionStage.camera};
  if (phase === 'returning' && meetingStage)
   return {scene: meetingStage.scene, camera: meetingStage.camera};
  return null;
 }

 function applyCamera(phase, snapshot, dt) {
  if (phase === 'ringing') {
   if (worldBell) worldBell.update(dt);
   const t = snapshot.elapsed;
   if (ringWings) {
    // 0-0.3s reach toward the bell, 0.3-0.9s withdraw, then rest.
    let reach = 0;
    if (t < 0.3) reach = t / 0.3;
    else if (t < 0.9) reach = 1 - (t - 0.3) / 0.6;
    ringWings.position.z = -0.55 - reach * 0.28;
    ringWings.rotation.x = 0.2 - reach * 0.35;
   }
   if (t >= 0.3) {
    if (worldBell && !worldBell.isRinging()) worldBell.ring();
    fireCue('ringing:strike', 'bell');
   }
   return;
  }
  if (meetingStage && ['seating', 'discussion', 'voting', 'result'].includes(phase)) {
   meetingStage.update({elapsed: snapshot.elapsed, speakerIndex: snapshot.speakerIndex, reducedMotion: snapshot.reducedMotion, actorIds: snapshot.actorIds});
   if (look.state().enabled) look.apply(meetingStage.camera, 0, -0.123);
   return;
  }
  if (ejectionStage && ['ejection', 'finished'].includes(phase)) {
   const duration = snapshot.style === 'fire' ? IMMERSION_CONFIG.timings.fire : IMMERSION_CONFIG.timings.water;
   // finished freezes the real end frame instead of re-sampling with a fake time.
   const elapsed = phase === 'finished' ? duration : snapshot.elapsed;
   ejectionStage.update({elapsed, reducedMotion: snapshot.reducedMotion});
   applySelfPov(phase === 'finished' ? 0 : dt, elapsed, snapshot.reducedMotion);
   if (ejectionStage.lookMode === 'free' && look.state().enabled) {
    look.apply(ejectionStage.camera, ejectionStage.baseYaw, ejectionStage.basePitch);
   } else {
    ejectionStage.camera.rotation.set(ejectionStage.basePitch ?? 0, ejectionStage.baseYaw ?? 0, 0, 'YXZ');
   }
   if (selfPov && selfPov.roll) ejectionStage.camera.rotation.z = selfPov.roll; // mild wobble, after the look is applied
   alignSelfBodyToGaze();
   if (snapshot.style === 'water' && elapsed >= 2.4) {
    // Wider vertical freedom once the eye passes the surface; user deltas preserved.
    look.setLimits(IMMERSION_CONFIG.underwaterPitchRange[0], IMMERSION_CONFIG.underwaterPitchRange[1]);
   }
   const beats = ejectionStage.beats;
   if (snapshot.style === 'water' && ejectionStage.trajectory) {
    const traj = ejectionStage.trajectory;
    const bodyUnder = traj.body[1] < 0; // body breaks the surface -> splash
    const eyeUnder = traj.eye[1] < 0;   // eye passes the surface -> underwater ambience
    if (eyeUnder) {
     // Wider vertical freedom once the eye is below; user deltas preserved.
     look.setLimits(IMMERSION_CONFIG.underwaterPitchRange[0], IMMERSION_CONFIG.underwaterPitchRange[1]);
     fireCue('ejection:underwater', 'underwater');
    }
    if (bodyUnder) fireCue('ejection:splash', 'splash');
    if (beats && elapsed >= beats.pauseEnd && elapsed < beats.pauseEnd + 0.35) fireCue('ejection:throw', 'whoosh');
   } else if (snapshot.style === 'fire' && beats) {
    if (elapsed >= beats.liftEnd - 0.3 && elapsed < beats.liftEnd) fireCue('ejection:lift', 'whoosh');
    if (elapsed >= beats.carryEnd && elapsed < beats.carryEnd + 0.3) fireCue('ejection:fire', 'fire');
   }
  }
 }

 function cleanupSession() {
  destroyRingWings();
  destroySelfPov();
  if (ringCamera) {
   // drop the hidden bell camera so the roam scene graph is back to its
   // pre-session state (it is re-created on demand by ensureRingCamera).
   // worldBell intentionally STAYS: it is the town's persistent bell prop
   // and must still be there for the next ring.
   worldScene.remove(ringCamera);
   ringCamera = null;
  }
  if (ejectionStage) {
   ejectionStage.dispose();
   ejectionStage = null;
  }
  if (meetingStage) {
   meetingStage.dispose();
   meetingStage = null;
  }
  if (actors) {
   actors.dispose();
   actors = null;
  }
  audio.stop();
  look.disable();
  ui.hideAll();
  loadingProgress = null;
  cues = new Set();
  lastStageKind = null;
 }

 function finalize(reason) {
  if (endNotified) return;
  endNotified = true;
  cleanupSession();
  if (walkFrozenAt && getWalker) {
   const now = getWalker().state.position;
   positionDrift = Math.hypot(now[0] - walkFrozenAt[0], now[1] - walkFrozenAt[1]);
   walkFrozenAt = null;
  }
  if (onEnd) onEnd({reason: reason || endReason || 'return', positionDrift});
 }

 async function loadSession(gen) {
  loadingProgress = {done: 0, total: 8};
  try {
   const roster = selectRoster(playerActorId);
   const set = await loadImmersionActors(roster, {
    onProgress: (done, total) => {
     loadingProgress = {done, total};
    },
    isCurrent: () => isCurrent(gen) && machine.snapshot().phase === 'preparing',
    maxConcurrent: IMMERSION_CONFIG.maxConcurrentActorLoads,
   });
   if (!isCurrent(gen)) {
    set.dispose();
    return;
   }
   actors = set;
   meetingStage = createMeetingStage({actors, playerActorId, config: IMMERSION_CONFIG, props});
   lastStageKind = 'meeting';
   loadingProgress = null;
   machine.dispatch({type: 'READY'});
  } catch (e) {
   if (!isCurrent(gen)) return;
   if (e && e.cancelled) return;
   loadingProgress = null;
   machine.dispatch({type: 'LOAD_FAILED', error: (e && e.message) || '演员加载失败'});
  }
 }

 const extras = {
  describeActor: null, // injected by map-walk via setDescribeActor
  get nearBell() { return nearBell; },
  get progress() { return loadingProgress; },
  get muted() { return audio.isMuted(); },
  get fade() { return machine.snapshot().phase === 'returning'; },
  get speeches() { return sessionSpeeches; },
  get propsReady() { return props.state().ready; },
  get propsError() { return props.state().error; },
 };

 ui.on.bell = () => begin();
 ui.on.cancel = () => cancel('ui');
 ui.on.retry = () => retry();
 ui.on.muteToggle = () => {
  audio.setMuted(!audio.isMuted());
 };
 ui.on.select = value => dispatchEvent({type: 'SELECT', actorId: value});
 ui.on.selfDemo = () => dispatchEvent({type: 'SELF_DEMO'});
 ui.on.confirm = () => dispatchEvent({type: 'CONFIRM'});
 ui.on.skip = () => dispatchEvent({type: 'SKIP'});
 ui.on.setStyle = value => dispatchEvent({type: 'SET_STYLE', style: value});
 ui.on.replay = () => dispatchEvent({type: 'REPLAY'});
 ui.on.return = () => dispatchEvent({type: 'RETURN'});

 async function begin() {
  if (machine.snapshot().phase !== 'roam') return false;
  if (!props.state().ready) {
   if (!props.state().loading && onPropsUnavailable) onPropsUnavailable();
   return false;
  }
  const walker = getWalker && getWalker();
  const nav = getNavigation && getNavigation();
  if (!walker || !nav) return false;
  const [x, z] = walker.state.position;
  // Accept ANY configured meeting trigger (courthouse bell or plaza fountain
  // button); room-gated triggers only fire inside their room.
  let atTrigger = false;
  for (const t of [IMMERSION_CONFIG.bell, IMMERSION_CONFIG.button]) {
   const [ix, iz] = t.interaction;
   if (Math.hypot(x - ix, z - iz) > t.triggerDistance) continue;
   if (t.room) {
    const room = nav.roomAt([x, z]);
    if (!room || room.id !== t.room) continue;
   }
   atTrigger = true;
   break;
  }
  if (!atTrigger) return false;
  audio.unlock();
  playerActorId = (getActorId && getActorId()) || playerActorId;
  if (!playerActorId) return false;
  walkFrozenAt = [x, z];
  endNotified = false;
  endReason = null;
  session += 1;
  sessionSpeeches = pickSessionSpeeches(session);
  const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  machine.dispatch({type: 'START', actorIds: selectRoster(playerActorId), playerActorId, style: IMMERSION_CONFIG.defaultStyle, reducedMotion: prefersReduced});
  loadSession(session);
  return true;
 }

 function retry() {
  if (machine.snapshot().phase !== 'error') return;
  audio.unlock();
  session += 1;
  machine.dispatch({type: 'RETRY'});
  loadSession(session);
 }

 function cancel(reason) {
  if (machine.snapshot().phase === 'roam') return;
  endReason = reason || 'cancel';
  session += 1;
  machine.dispatch({type: 'CANCEL'});
  finalize(endReason);
 }

 let prevPhase = 'roam';

 // Single phase-entry authority: every machine transition (UI events, tick, replay)
 // funnels through here so one-shot side effects and look resets always run.
 function dispatchEvent(event) {
  const before = machine.snapshot().phase;
  machine.dispatch(event);
  const after = machine.snapshot().phase;
  // REPLAY rewinds finished->ejection: the repeated performance must get its
  // one-shot audio cues again, so drop this session's cue memory
  if (event.type === 'REPLAY' && after !== before) cues.clear();
  if (after !== 'roam' && before !== after) enterPhase(after);
 }

 function update(dt) {
  const before = machine.snapshot().phase;
  machine.tick(dt);
  const snapshot = machine.snapshot();
  const phase = snapshot.phase;

  if (before !== 'roam' && phase === 'roam' && !endNotified) {
   // RETURN's timed exit lands here; CANCEL handles its own finalize.
   finalize('return');
  }
  if (phase !== 'roam' && before !== phase) enterPhase(phase);
  if (phase !== 'roam') {
   applyCamera(phase, snapshot, dt);
   if (++uiTick % 3 === 0) renderUi(snapshot);
  } else if (++uiTick % 3 === 0) {
   renderUi(snapshot);
  }
 }

 function renderUi(snapshot) {
  ui.render(snapshot, extras);
  if (snapshot.phase === 'voting')
   ui.setAvatars(snapshot.actorIds.slice(1), snapshot.selectedId, extras.describeActor, false);
 }

 return {
  begin,
  retry,
  cancel,
  update,
  dispatch: dispatchEvent,
  pause() {
   machine.dispatch({type: 'PAUSE'});
   audio.pause();
  },
  resume() {
   machine.dispatch({type: 'RESUME'});
   audio.resume();
  },
  projection(width, height) {
   if (ringCamera) {
    ringCamera.aspect = width / Math.max(1, height);
    ringCamera.updateProjectionMatrix();
   }
   if (meetingStage) meetingStage.projection(width, height);
   if (ejectionStage) ejectionStage.projection(width, height);
  },
  setNearBell(value) {
   nearBell = value || null; // trigger label ('按铃'/'按下按钮') or null
  },
  refresh() {
   renderUi(machine.snapshot());
  },
  setDescribeActor(fn) {
   extras.describeActor = fn;
  },
  refreshProps() {
   // attachWorldBell() adds the group itself; adding again here would re-parent
   // the same group for nothing
   attachWorldBell();
  },
  get busy() {
   return machine.snapshot().busy;
  },
  get renderTarget() {
   return renderTargetFor(machine.snapshot().phase);
  },
  state() {
   const snapshot = machine.snapshot();
   return {
    ...snapshot,
    sessionId: session,
    loadedActors: actors ? actors.count : 0,
    props: props.state(),
    ejection: ejectionStage && ejectionStage.diagnostics ? ejectionStage.diagnostics() : null,
    look: look.state(),
    positionDrift,
    ringBell: snapshot.phase === 'ringing' ? ringBellProjection() : null,
    selfPov: ['ejection', 'finished'].includes(snapshot.phase) ? selfPovState() : null,
   };
  },
  dispose() {
   session += 1;
   cleanupSession();
   audio.dispose();
   look.dispose();
  },
 };
}
