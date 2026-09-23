// BRIDGE (E5) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {lerp, clamp01, ease, track} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, props, scene, camera, take, eyePos, stage, reduced, lastPose, setHiddenParts} = ctx;
 // 断桥坠落: the target crosses a plank bridge, the middle planks give way,
 // and the fall lands in the existing water read (deep blue below).
 scene.background = new THREE.Color('#0d3357');
 scene.fog = new THREE.Fog('#0d3357', 9, 20);
 const water = new THREE.Mesh(take(new THREE.PlaneGeometry(34, 34)),
  take(new THREE.MeshStandardMaterial({color: '#0d2f52', roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.9})));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.35; scene.add(water);
 for (const dx of [-3.4, 3.4]) {
  const dock = props.instantiate('prop_dock');
  dock.position.set(dx, 0, 0); scene.add(dock); take(dock);
 }
 const planks = [];
 for (let i = 0; i < 9; i++) {
  const plank = take(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.09, 1.0)),
   take(new THREE.MeshStandardMaterial({color: '#7a5c38', roughness: 0.9})));
  plank.position.set(-2.7 + i * 0.675, 0.02, 0);
  scene.add(plank); planks.push(plank);
 }
 const sun = new THREE.DirectionalLight('#bfe2ff', 1.35);
 sun.position.set(0.5, 8, 2.5); scene.add(sun);
 // Ground lift so plank/dock undersides read as dark wood in water, not pitch-black
 // silhouettes (V2 2026-09-24).
 scene.add(new THREE.HemisphereLight('#8fc0e2', '#2c3c4c', 0.95));

 const crossEnd = 3.0, fallEnd = 3.9;
 stage.beats = {walkEnd: crossEnd, liftEnd: crossEnd, carryEnd: crossEnd, pauseEnd: crossEnd, dropEnd: fallEnd};
 const splash = new THREE.Mesh(take(new THREE.CircleGeometry(0.5, 24)),
  take(new THREE.MeshBasicMaterial({color: '#cfe6f2', transparent: true, opacity: 0, depthWrite: false})));
  splash.rotation.x = -Math.PI / 2; splash.position.set(0.2, -1.3, 0); scene.add(splash);

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const walkK = ease(clamp01(elapsed / crossEnd));
  if (elapsed < fallEnd) {
   target.player.position.set(lerp(-2.2, 2.2, walkK), 0.05, 0);
   target.player.rotation.set(0, -Math.PI / 2, 0);
  } else {
   // treading water after the fall
   target.player.position.set(0.2, -0.78 + (reduced.value ? 0 : Math.sin(elapsed * 3) * 0.03), 0);
   target.player.rotation.set(0, Math.PI, 0);
  }
  const broke = elapsed > crossEnd;
  planks.forEach((plank, i) => {
   if (!broke || (i > 2 && i < 6)) {
    if (broke && i > 2 && i < 6) {
     const k = clamp01((elapsed - crossEnd) / 0.9);
     plank.rotation.x = k * (i % 2 ? 0.9 : -1.1);
     plank.position.y = 0.02 - k * 1.1;
    }
    return;
   }
  });
  splash.material.opacity = elapsed > crossEnd && elapsed < crossEnd + 1.2 ? 0.7 * (1 - (elapsed - crossEnd) / 1.2) : 0;
  splash.scale.setScalar(1 + (elapsed - crossEnd) * 2.2);
  // Watching crowd: one bird per spot along both shores (V2 2026-09-24 — the old
  // Math.sign(id.length - 5.5) placed every 'cast.NN' at the same +3.4 spot with
  // y below the deck, so the underwater camera saw them merged into the dock as
  // giant blown-out "white slabs"). Deck height follows the water stage.
  const watchSpots = [[-3.05, 0.8], [-3.25, 0.05], [-2.95, -0.75], [-3.4, -1.25], [3.0, 0.75], [3.3, -0.3], [2.9, -1.1], [-2.7, 1.45]];
  let watchIndex = 0;
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   // Keep the self target visible (same clause as begin()): this used to hide the
   // treading bird while its director-built wing rig stayed in the scene, leaving
   // two ownerless white wing slabs hovering at the waterline (V2 2026-09-24).
   a.player.visible = id !== targetId || !isSelf;
   if (a.player.visible) {
    const spot = watchSpots[watchIndex % watchSpots.length];
    watchIndex++;
    a.player.position.set(spot[0], 0.12, spot[1]);
    a.player.rotation.y = Math.atan2(target.player.position.x - spot[0], target.player.position.z - spot[1]);
   }
  }
  // Wings part and droop after the fall so the treading bird reads as body+wings.
  stage.wingSplay = clamp01((elapsed - crossEnd) / 0.6) * 0.5;
  // Stay just above the surface after the fall: from underwater the parted wings
  // (white-feathered, sun-broadside) read as two ownerless white slabs (V2). The
  // tail position pulls back +z so the sight line to the treading bird threads
  // between the intact planks and the fallen ones instead of across the debris.
  const camTrackSelf = [[0, [-1.9, 1.1, 0]], [crossEnd - 0.3, [1.6, 1.05, 0.6]], [fallEnd, [1.75, 1.5, 1.85]], [8.5, [1.8, 1.45, 2.0]]];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [2.8, 1.15, 2.2]], [8.5, [2.8, 1.15, 2.2]]], eyePos);
  const dx = target.player.position.x - position.x, dz = target.player.position.z - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = Math.atan2(-dx, -dz);
  stage.basePitch = elapsed > crossEnd ? Math.atan2(target.player.position.y - position.y, Math.hypot(dx, dz)) : 0.05;
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
  for (const plank of planks) { plank.rotation.x = 0; plank.position.y = 0.02; }
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
