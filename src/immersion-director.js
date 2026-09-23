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
 let ejectionWings = null;
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

 function buildEjectionWings() {
  destroyEjectionWings();
  if (!actors || !ejectionStage || !ejectionStage.isSelf) return;
  ejectionWings = actors.buildWingRig(playerActorId);
  if (!ejectionWings) return;
  // Own material clones: double-sided with a style-matched faint emissive so the
  // wing's far side reads as a lit wing instead of a black silhouette against the
  // fire or the deep water. Disposed with the rig below.
  const warm = ejectionStage.style === 'fire';
  for (const wing of ejectionWings.children) {
   wing.geometry.computeBoundingBox();
   const cx = wing.geometry.boundingBox.getCenter(new THREE.Vector3()).x;
   wing.userData.side = Math.sign(cx) || 1;
   if (wing.material) {
    const m = wing.material.clone();
    m.side = THREE.DoubleSide;
    if (m.emissive) {
     m.emissive = new THREE.Color(warm ? '#3f170b' : '#141b23');
     if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6;
    }
    wing.material = m;
    wing.userData.povWingOwned = true;
   }
  }
  ejectionWings.matrixAutoUpdate = false;
  ejectionStage.scene.add(ejectionWings);
 }

 // Narrow the wing rig toward the body center on narrow aspects so both wing roots
 // stay readable in portrait; the world view never gets a FOV compensation instead.
 // Per frame the clones re-derive their model-local placement from the source meshes
 // (pose-fresh), then add a small outward offset plus the stage's splay so the wings
 // droop away from the sight line while carried under or settled in the pit.
 const wingInv = new THREE.Matrix4();
 const wingScaleMat = new THREE.Matrix4(); // per-frame scratch, no allocation in the wing loop
 const ONES = new THREE.Vector3(1, 1, 1);
 const wingOff = new THREE.Matrix4();
 const wingOffPos = new THREE.Vector3();
 const wingOffQuat = new THREE.Quaternion();
 const wingOffEuler = new THREE.Euler();
 function updateEjectionWings() {
  if (!ejectionWings || !actors || !ejectionStage) return;
  const avatar = actors.get(playerActorId);
  if (!avatar) return;
  const aspect = host.clientWidth / Math.max(1, host.clientHeight);
  const narrow = aspect >= 1.3 ? 1 : aspect >= 0.8 ? lerp(1, 0.78, (1.3 - aspect) / 0.5) : 0.74;
  avatar.model.updateWorldMatrix(true, true);
  wingInv.copy(avatar.model.matrixWorld).invert();
  ejectionWings.matrix.multiplyMatrices(avatar.model.matrixWorld, wingScaleMat.makeScale(narrow, 1, 1));
  const splay = ejectionStage.wingSplay || 0;
  for (const wing of ejectionWings.children) {
   const source = wing.userData.source;
   if (!source) continue;
   const side = wing.userData.side || 1;
   wingOffPos.set(side * (0.09 + splay * 0.15), -0.04 - splay * 0.04, 0.16);
   // Wing geometry is a vertical XY-plane surface (thin along Z) whose broad face
   // already faces the travel direction; the yaw component spreads the tips into a
   // clear V clear of the sight line, the small roll droops them naturally.
   wingOffEuler.set(0, -side * (0.62 + splay * 0.45), -side * 0.2);
   wingOffQuat.setFromEuler(wingOffEuler);
   wingOff.compose(wingOffPos, wingOffQuat, ONES);
   wing.matrix.multiplyMatrices(wingInv, source.matrixWorld).multiply(wingOff);
  }
 }

 function destroyEjectionWings() {
  if (ejectionWings) {
   for (const wing of ejectionWings.children)
    if (wing.userData.povWingOwned && wing.material && wing.material.dispose) wing.material.dispose();
   if (ejectionWings.parent) ejectionWings.parent.remove(ejectionWings);
  }
  ejectionWings = null;
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
    destroyEjectionWings();
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
    buildEjectionWings();
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
   updateEjectionWings();
   if (ejectionStage.lookMode === 'free' && look.state().enabled) {
    look.apply(ejectionStage.camera, ejectionStage.baseYaw, ejectionStage.basePitch);
   } else {
    ejectionStage.camera.rotation.set(ejectionStage.basePitch ?? 0, ejectionStage.baseYaw ?? 0, 0, 'YXZ');
   }
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
  destroyEjectionWings();
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
