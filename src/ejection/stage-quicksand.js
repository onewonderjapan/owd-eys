// QUICKSAND (E2) ejection stage — mechanically moved from immersion-ejection.js
// (2026-09-23 night split; branch body unchanged, see docs/immersion/ejection-split-map.md).
import * as THREE from 'three';
import {tmpVecA, lerp, clamp01, ease, track, addSkyDome, seededRandom} from './common.js';

export function buildStage(ctx) {
 const {actors, targetId, isSelf, target, scene, camera, take, eyePos, stage, reduced, poseOnce, lastPose, setHiddenParts} = ctx;
 // 流沙吞没: the plaza sand pit opens and the target sinks, wings flailing.
 scene.background = new THREE.Color('#cfa96f');
 scene.fog = new THREE.Fog('#c9a86b', 7, 20);
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(22, 22)),
  take(new THREE.MeshStandardMaterial({color: '#c2a36b', roughness: 1})));
 ground.rotation.x = -Math.PI / 2; scene.add(ground);
 const pit = new THREE.Mesh(take(new THREE.CircleGeometry(1.35, 36)),
  take(new THREE.MeshStandardMaterial({color: '#8a6c42', roughness: 1})));
 pit.rotation.x = -Math.PI / 2; pit.position.y = 0.012; scene.add(pit);
 const rim = new THREE.Mesh(take(new THREE.RingGeometry(1.35, 1.62, 36)),
  take(new THREE.MeshStandardMaterial({color: '#a8854e', roughness: 1, side: THREE.DoubleSide})));
 rim.rotation.x = -Math.PI / 2; rim.position.y = 0.014; scene.add(rim);
 for (let i = 0; i < 6; i++) {
  const reed = take(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.5 + (i % 3) * 0.14, 5),
   take(new THREE.MeshStandardMaterial({color: '#7a8a4a', roughness: 1}))));
  const ra = i * Math.PI / 3 + 0.4;
  reed.position.set(Math.cos(ra) * 1.7, 0.25, Math.sin(ra) * 1.7);
  reed.rotation.z = (i % 2 ? 1 : -1) * 0.18; scene.add(reed);
 }
 const sun = new THREE.DirectionalLight('#fff0cf', 1.7);
 sun.position.set(5, 7, 3); scene.add(sun);
 scene.add(new THREE.HemisphereLight('#e8cfa0', '#8a6c4a', 1.1));

 const sinkStart = 1.4, sinkSpan = 6.6;
 stage.beats = {walkEnd: sinkStart, liftEnd: sinkStart, carryEnd: sinkStart, pauseEnd: sinkStart, dropEnd: sinkStart};

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const walkK = ease(clamp01(elapsed / sinkStart));
  const bx = lerp(-1.6, 0, walkK);
  const depth = ease(clamp01((elapsed - sinkStart) / sinkSpan));
  const by = elapsed < sinkStart ? 0.12 : lerp(0.12, -1.12, depth)
   + (reduced.value ? 0 : Math.sin(elapsed * 3) * 0.05 * (1 - depth));
  poseOnce(targetId, 'standing');
  target.player.position.set(bx, by, 0);
  target.player.rotation.z = reduced.value ? 0 : Math.sin(elapsed * 2.4) * 0.12 * (1 - depth * 0.6);
  const rimSpots = [[2.3, 1.7], [-1.9, 1.5], [0.3, -1.95]];
  let rimIdx = 0;
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    const spot = rimSpots[rimIdx++ % rimSpots.length];
    a.player.position.set(spot[0], 0, spot[1]);
    a.player.rotation.y = Math.atan2(target.player.position.x - spot[0], target.player.position.z - spot[1]);
   }
  }
  // SELF = first person sinking: your eyes descend with the body while the
  // watchers lean over the rim against the sky. NPC side keeps the spectator
  // track.
  const camTrackNpc = [[0, [-1.9, 1.0, -1.3]], [8.5, [-1.9, 1.0, -1.3]]];
  const position = eyePos;
  let yaw, pitch;
  if (isSelf) {
   const bx = lerp(-1.6, 0, walkK);
   position.set(bx, 0.12 - depth * 1.05 + 0.42, 0);
   yaw = Math.PI; // face the rim where the watchers lean in
   pitch = lerp(0.05, 0.95, depth);
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
 };


 // R2 2026-09-24 set dressing: the whole frame used to be one flat tan. A real
 // sky gradient, a ring of shaded dunes and a slow vortex in the pit give the
 // sink a place and a direction. The vortex is driven by performance time (so
 // it pauses with the performance) and holds still under reduced motion.
 addSkyDome(ctx, {top: '#79a2c4', mid: '#ead3a2', bottom: '#c7a56a', horizon: 0.0});
 scene.fog = new THREE.Fog('#dcc38f', 10, 32);
 const duneRand = seededRandom(311);
 const duneMats = ['#c9a86f', '#b38f57', '#d6b77d'].map(c => take(new THREE.MeshStandardMaterial({color: c, roughness: 1})));
 const duneGeo = take(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
 for (let i = 0; i < 16; i++) {
  const a = i / 16 * Math.PI * 2 + duneRand() * 0.3, r = 6 + duneRand() * 7;
  const dune = new THREE.Mesh(duneGeo, duneMats[i % 3]);
  dune.position.set(Math.cos(a) * r, -0.05, Math.sin(a) * r);
  dune.scale.set(2.2 + duneRand() * 2.6, 0.35 + duneRand() * 0.7, 1.6 + duneRand() * 2.2);
  dune.rotation.y = duneRand() * Math.PI;
  scene.add(dune);
 }
 // FrontSide: once the sinking self-camera is below ground the arms must not
 // show up as huge arcs across the sky (seen from underneath).
 const vortexMat = take(new THREE.MeshBasicMaterial({color: '#6a4d2b', transparent: true, opacity: 0.5, side: THREE.FrontSide, depthWrite: false}));
 const vortex = new THREE.Group();
 vortex.position.y = 0.02;
 for (let k = 0; k < 3; k++) {
  const arm = new THREE.Mesh(take(new THREE.RingGeometry(0.22 + k * 0.34, 0.3 + k * 0.34, 32, 1, k * 2.1, Math.PI * 1.1)), vortexMat);
  arm.rotation.x = -Math.PI / 2;
  vortex.add(arm);
 }
 scene.add(vortex);
 const dressedUpdate = stage.update;
 stage.update = args => {
  dressedUpdate(args);
  vortex.rotation.y = reduced.value ? 0 : -args.elapsed * 0.9;
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
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}
