// ==== Ejection shot pool stages (E1-E6, 2026-09-16 night) ====
// Each branch configures the shared scene/camera and defines update/reset/begin.
// All props are procedural (no S1/asset-pipeline changes), mirroring the fire
// stage's structure. Timings live in IMMERSION_CONFIG.timings.

// ============================================================ SPACE (E1) ===
else if (style === 'space') {
 // 钟楼夜空弹射: carried to the tower top, then launched into the star field.
 scene.background = new THREE.Color('#05070f');
 const starGeo = new THREE.BufferGeometry();
 const starCount = 700;
 const starPos = new Float32Array(starCount * 3);
 for (let i = 0; i < starCount; i++) {
  const a = Math.random() * Math.PI * 2, bm = Math.acos(Math.random() * 1.6 - 0.6), r = 20;
  starPos[i * 3] = r * Math.sin(bm) * Math.cos(a);
  starPos[i * 3 + 1] = Math.abs(r * Math.cos(bm)) + 0.5;
  starPos[i * 3 + 2] = r * Math.sin(bm) * Math.sin(a);
 }
 starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
 scene.add(new THREE.Points(starGeo, take(new THREE.PointsMaterial({color: '#cfe0ff', size: 0.1, sizeAttenuation: true, fog: false}))));
 scene.add(new THREE.Mesh(take(new THREE.CircleGeometry(9, 40)), take(new THREE.MeshStandardMaterial({color: '#10162a', roughness: 1})))).children;
 const voidFloor = scene.children[scene.children.length - 1];
 voidFloor.rotation.x = -Math.PI / 2; voidFloor.position.y = -9;
 const towerTop = take(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 2.4), new THREE.MeshStandardMaterial({color: '#3a3440', roughness: 0.9})));
 towerTop.position.y = -0.15; scene.add(towerTop);
 const moon = take(new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), new THREE.MeshBasicMaterial({color: '#dfe6ee', fog: false})));
 moon.position.set(8, 9, -12); scene.add(moon);
 scene.add(new THREE.HemisphereLight('#3d4f86', '#05060c', 0.55));
 const moonlight = new THREE.DirectionalLight('#bcd2ff', 1.0);
 moonlight.position.set(4, 8, 6); scene.add(moonlight);

 const walkEnd = 1.5, liftEnd = 2.6, carryEnd = 4.0, launchEnd = 5.0;
 stage.beats = {walkEnd, liftEnd, carryEnd, launchEnd};

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  const walkK = ease(clamp01(elapsed / walkEnd));
  const bx = lerp(-1.2, 0, walkK) + (elapsed > launchEnd ? (elapsed - launchEnd) * 0.4 : 0);
  const by = elapsed < launchEnd
   ? lerp(0.12, 0.62, ease(clamp01(elapsed / launchEnd)))
   : 0.62 + Math.pow(elapsed - launchEnd, 1.15) * 1.6;
  poseOnce(targetId, elapsed > launchEnd ? 'carried' : 'standing');
  target.player.position.set(bx, by, 0);
  if (elapsed > launchEnd) target.player.rotation.z += reduced.value ? 0.004 : 0.02; // slow weightless tumble
  const driftYaw = elapsed > launchEnd ? (elapsed - launchEnd) * 0.12 : 0;
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    a.player.position.set(Math.sin(a.player.position.x * 0.7 + 1) * 1.0, 0, Math.cos(a.player.position.z * 0.7 + 2) * 1.0);
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  stage.wingSplay = ease(clamp01((elapsed - launchEnd) / 0.8));
  const camTrackSelf = [
   [0, [-1.1, 1.05, -0.9]], [carryEnd, [-0.2, 1.15, 0]], [launchEnd, [0, 1.05, 0]], [8.0, [1.6, 6.6, -2.0]],
  ];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [-1.2, 1.1, -1.2]], [8.0, [-1.2, 1.1, -1.2]]], eyePos);
  let yaw, pitch;
  if (isSelf && elapsed > launchEnd) {
   // drifting away: look down at the shrinking tower platform
   yaw = driftYaw; pitch = -0.95;
  } else {
   const dx = target.player.position.x - position.x, dz = target.player.position.z - position.z;
   yaw = Math.atan2(-dx, -dz);
   pitch = Math.atan2(target.player.position.y + 0.6 - position.y, Math.hypot(dx, dz));
  }
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = yaw;
  stage.basePitch = pitch;
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
  target.player.rotation.z = 0;
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}

// ======================================================== QUICKSAND (E2) ===
else if (style === 'quicksand') {
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
  stage.wingSplay = depth; // wings spread wider as the sand takes hold
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    a.player.position.set(Math.sin(id.length * 2.1) * 1.9, 0, Math.cos(id.length * 1.7) * 1.6);
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  const camTrackSelf = [
   [0, [1.7, 0.95, 1.55]], [sinkStart + 3, [1.6, 0.8, 1.4]], [8.5, [1.25, 0.3, 1.0]],
  ];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [-1.9, 1.0, -1.3]], [8.5, [-1.9, 1.0, -1.3]]], eyePos);
  const dx = target.player.position.x - position.x, dz = target.player.position.z - position.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = elapsed > sinkSpan * 0.55 ? lerp(-0.35, 0.75, clamp01((elapsed - sinkSpan * 0.55) / (8.5 - sinkSpan * 0.55)))
   : Math.atan2(target.player.position.y + 0.4 - position.y, Math.hypot(dx, dz));
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = yaw;
  stage.basePitch = pitch;
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

// ======================================================== CHANDELIER (E3) ===
else if (style === 'chandelier') {
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
  const camTrackSelf = [[0, [1.85, 1.35, 1.85]], [impact, [1.6, 1.15, 1.6]], [6.5, [1.5, 0.9, 1.5]]];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [-1.85, 1.3, -1.7]], [6.5, [-1.85, 1.3, -1.7]]], eyePos);
  const dx = target.player.position.x - position.x, dz = target.player.position.z - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = Math.atan2(-dx, -dz);
  stage.basePitch = elapsed < impact
   ? Math.atan2(2.6 - position.y, Math.hypot(dx, dz)) * 0.7  // watch the swinging chandelier above
   : -0.35;                                                   // then the petals on the floor
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

// ========================================================== BOULDER (E4) ===
else if (style === 'boulder') {
 // 巨石滚落: comedy staging - the target is flattened then drifts off as a
 // 'paper goose'. No gore.
 scene.background = new THREE.Color('#1a1610');
 scene.fog = new THREE.Fog('#241d14', 8, 26);
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(26, 14)),
  take(new THREE.MeshStandardMaterial({color: '#4a3a28', roughness: 1})));
 ground.rotation.x = -Math.PI / 2; scene.add(ground);
 for (const zSide of [-2.6, 2.6]) {
  const wall = new THREE.Mesh(take(new THREE.BoxGeometry(17, 2.0, 0.6)),
   take(new THREE.MeshStandardMaterial({color: '#3a2f22', roughness: 1})));
  wall.position.set(0, 1.0, zSide); scene.add(wall);
 }
 const boulder = take(new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 0),
  new THREE.MeshStandardMaterial({color: '#6b6157', roughness: 0.95, flatShading: true})));
 boulder.position.set(-9, 1.15, 0); scene.add(boulder);
 const sun = new THREE.DirectionalLight('#ffd9a0', 1.3);
 sun.position.set(6, 8, 4); scene.add(sun);
 scene.add(new THREE.HemisphereLight('#8a7a63', '#2a221a', 0.75));

 const rollStart = 1.0, rollEnd = 3.1, flatten = 2.15;
 stage.beats = {walkEnd: rollStart, liftEnd: rollStart, carryEnd: rollStart, pauseEnd: rollStart, dropEnd: flatten};

 stage.update = ({elapsed, reducedMotion}) => {
  reduced.value = Boolean(reducedMotion);
  stage.lookMode = 'free';
  target.player.position.set(0, 0.12, 0);
  target.player.rotation.set(0, Math.PI / 2, 0);
  if (elapsed >= flatten && elapsed < flatten + 0.15) target.player.scale.y = 0.08;
  else if (elapsed >= flatten + 0.15) {
   // paper-goose drift: flattened, floating up and away
   const k = clamp01((elapsed - flatten - 0.15) / 3);
   target.player.scale.y = 0.08;
   target.player.position.y = 0.12 + k * 1.6;
   target.player.position.x = k * 1.1;
   target.player.rotation.x = Math.PI / 2;
   target.player.rotation.z = k * 2.4;
  }
  const rollT = clamp01((elapsed - rollStart) / (rollEnd - rollStart));
  boulder.position.x = lerp(-9, 9, rollT);
  boulder.rotation.z -= ((elapsed - rollStart) > 0 ? 2.2 : 0) * 0.016 * (elapsed > rollStart && elapsed < rollEnd ? 1 : 0);
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a || id === targetId) continue;
   a.player.visible = true;
   a.player.position.set(Math.sin(id.length * 2.1) * 2.4, 0, Math.sign(id.length - 6) * 3.4);
   a.player.rotation.y = Math.atan2(boulder.position.x - a.player.position.x, 0 - a.player.position.z) * 0.3;
  }
  const camTrackSelf = [[0, [0, 1.3, -4.6]], [flatten, [0.4, 1.1, -3.6]], [6.0, [1.0, 1.2, -3.2]]];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [0, 1.25, 4.6]], [6.0, [0, 1.25, 4.6]]], eyePos);
  const look = elapsed > flatten ? target.player.position : {x: boulder.position.x, y: 1.0, z: 0};
  const dx = look.x - position.x, dz = (look.z || 0) - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = Math.atan2(-dx, -dz);
  stage.basePitch = elapsed < flatten ? Math.atan2(1.0 - position.y, Math.hypot(dx, dz)) : -0.2;
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
  target.player.scale.y = 1;
  target.player.rotation.set(0, 0, 0);
  target.player.position.set(0, 0.12, 0);
  for (const key of Object.keys(lastPose)) delete lastPose[key];
  actors.reset();
 };
}

// =========================================================== BRIDGE (E5) ===
else if (style === 'bridge') {
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
 scene.add(new THREE.HemisphereLight('#8fc0e2', '#0a1a2a', 0.95));

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
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    a.player.position.set(Math.sign(id.length - 5.5) * 3.4, 0.05, (id.length % 2 ? 0.9 : -0.9));
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  const camTrackSelf = [[0, [-1.9, 1.1, 0]], [crossEnd - 0.3, [1.6, 1.05, 0.6]], [fallEnd, [1.4, -0.55, 1.1]], [8.5, [1.5, -0.5, 1.3]]];
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

// ============================================================ FLUSH (E6) ===
else if (style === 'flush') {
 // 冲水飞湖: comedy spiral into a drain, launched over the town, splash landing.
 scene.background = new THREE.Color('#1c2a33');
 const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(24, 24)),
  take(new THREE.MeshStandardMaterial({color: '#24343a', roughness: 0.6})));
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
   if (k >= 1 && splash.userData.last !== 1) { splash.userData.last = 1; }
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
