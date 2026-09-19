# Experience polish pass for the six new ejection stages (2026-09-17 morning).
# Fixes verified against multi-frame timeline screenshots.
import io

def sub(p, pairs):
    src = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert src.count(old) == 1, (p, old[:60], src.count(old))
        src = src.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
    print('patched', p)

# ---------------- SPACE: town lights below, platform lit, star twinkle,
# keep NPCs off the camera drift path ----------------
sub('src/immersion-ejection.js', [
 (""" const voidFloor = scene.children[scene.children.length - 1];
 voidFloor.rotation.x = -Math.PI / 2; voidFloor.position.y = -9;""",
  """ const voidFloor = scene.children[scene.children.length - 1];
 voidFloor.rotation.x = -Math.PI / 2; voidFloor.position.y = -9;
 // town lights below so the drift has something to look at
 const townGeo = new THREE.BufferGeometry();
 const townPos = new Float32Array(240 * 3);
 for (let i = 0; i < 240; i++) {
  townPos[i * 3] = (Math.random() - 0.5) * 26;
  townPos[i * 3 + 1] = -8.9;
  townPos[i * 3 + 2] = (Math.random() - 0.5) * 26;
 }
 townGeo.setAttribute('position', new THREE.BufferAttribute(townPos, 3));
 const townLights = take(new THREE.Points(townGeo, new THREE.PointsMaterial({color: '#ffd98a', size: 0.14, sizeAttenuation: true, fog: false})));
 townLights.position.y = -8.9; scene.add(townLights);
 const platformGlow = new THREE.PointLight('#ffd9a2', 2.5, 5);
 platformGlow.position.set(0, 1.2, 0); scene.add(platformGlow);"""),
 (""" starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
 scene.add(new THREE.Points(starGeo, take(new THREE.PointsMaterial({color: '#cfe0ff', size: 0.1, sizeAttenuation: true, fog: false}))));""",
  """ starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
 const starMat = take(new THREE.PointsMaterial({color: '#cfe0ff', size: 0.1, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9}));
 scene.add(new THREE.Points(starGeo, starMat));"""),
 ("""  stage.wingSplay = ease(clamp01((elapsed - launchEnd) / 0.8));""",
  """  stage.wingSplay = ease(clamp01((elapsed - launchEnd) / 0.8));
  starMat.opacity = 0.75 + Math.sin(elapsed * 2.3) * 0.15; // gentle twinkle"""),
 ("""  const camTrackSelf = [
   [0, [-1.1, 1.05, -0.9]], [carryEnd, [-0.2, 1.15, 0]], [launchEnd, [0, 1.05, 0]], [8.0, [1.6, 6.6, -2.0]],
  ];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [-1.2, 1.1, -1.2]], [8.0, [-1.2, 1.1, -1.2]]], eyePos);
  let yaw, pitch;
  if (isSelf && elapsed > launchEnd) {
   // drifting away: look down at the shrinking tower platform
   yaw = driftYaw; pitch = -0.95;
  } else {""",
  """  const camTrackSelf = [
   [0, [-1.1, 1.05, -0.9]], [carryEnd, [-0.2, 1.15, 0]], [launchEnd, [0, 1.05, 0]],
   [launchEnd + 1.2, [0.5, 4.2, -0.8]], [8.0, [1.6, 6.4, -1.8]],
  ];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [-1.6, 1.1, 1.3]], [8.0, [-1.6, 1.1, 1.3]]], eyePos);
  let yaw, pitch;
  if (isSelf && elapsed > launchEnd) {
   // drifting away: sweep between the moon, the stars and the town below
   const k = elapsed - launchEnd;
   yaw = driftYaw + Math.sin(k * 0.5) * 0.55;
   pitch = -0.85 + Math.sin(k * 0.34 + 1.2) * 0.4;
  } else {"""),
 ("""   a.player.position.set(Math.sin(a.player.position.x * 0.7 + 1) * 1.0, 0, Math.cos(a.player.position.z * 0.7 + 2) * 1.0);""",
  """   a.player.position.set(Math.sin(a.player.position.x * 0.7 + 1) * 1.55, 0, Math.cos(a.player.position.z * 0.7 + 2) * 1.55);"""),
])

# ---------------- QUICKSAND: fixed rim camera (no body clipping),
# dust puffs, watchers framed ----------------
sub('src/immersion-ejection.js', [
 ("""  const camTrackSelf = [
   [0, [2.6, 1.25, 2.3]], [sinkStart + 3, [2.4, 1.0, 2.0]], [8.5, [1.9, 0.4, 1.5]],
  ];""",
  """  // camera stays on the rim - following the body down put the lens inside it
  const camTrackSelf = [
   [0, [2.6, 1.25, 2.3]], [sinkStart + 3, [2.5, 1.2, 2.2]], [8.5, [2.4, 1.15, 2.1]],
  ];"""),
 ("""  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    a.player.position.set(Math.sin(id.length * 2.1) * 1.9, 0, Math.cos(id.length * 1.7) * 1.6);
    a.player.rotation.y = Math.atan2(target.player.position.x - a.player.position.x, target.player.position.z - a.player.position.z);
   }
  }
  const camTrackSelf = [
   [0, [2.6, 1.25, 2.3]],""",
  """  const rimSpots = [[2.3, 0.4, 1.7], [-1.9, 0, 1.5], [0.3, 0, -1.95]];
  let rimIdx = 0;
  for (const id of actors.ids) {
   const a = actors.get(id);
   if (!a) continue;
   a.player.visible = id !== targetId;
   if (a.player.visible) {
    const spot = rimSpots[rimIdx++ % rimSpots.length];
    a.player.position.set(spot[0], 0, spot[2]);
    a.player.rotation.y = Math.atan2(target.player.position.x - spot[0], target.player.position.z - spot[2]);
   }
  }
  const camTrackSelf = [
   [0, [2.6, 1.25, 2.3]],"""),
])

# ---------------- BOULDER: self = the target's eyes, lit street ----------------
sub('src/immersion-ejection.js', [
 ("""  const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(26, 14)),
  take(new THREE.MeshStandardMaterial({color: '#4a3a28', roughness: 1})));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  for (const zSide of [-2.6, 2.6]) {
   const wall = new THREE.Mesh(take(new THREE.BoxGeometry(17, 2.0, 0.6)),
    take(new THREE.MeshStandardMaterial({color: '#3a2f22', roughness: 1})));
   wall.position.set(0, 1.0, zSide); scene.add(wall);
  }""",
  """  const ground = new THREE.Mesh(take(new THREE.PlaneGeometry(26, 14)),
  take(new THREE.MeshStandardMaterial({color: '#5a4832', roughness: 1})));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  for (const zSide of [-2.6, 2.6]) {
   const wall = new THREE.Mesh(take(new THREE.BoxGeometry(17, 2.0, 0.6)),
    take(new THREE.MeshStandardMaterial({color: '#4a3c2c', roughness: 1})));
   wall.position.set(0, 1.0, zSide); scene.add(wall);
  }
  const torchA = new THREE.PointLight('#ffb066', 6, 12, 1.5); torchA.position.set(-5, 2.4, -1.8); scene.add(torchA);
  const torchB = new THREE.PointLight('#ffb066', 5, 12, 1.5); torchB.position.set(3, 2.4, 1.8); scene.add(torchB);"""),
 ("""  const camTrackSelf = [[0, [0, 1.3, -4.6]], [flatten, [0.4, 1.1, -3.6]], [6.0, [1.0, 1.2, -3.2]]];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [0, 1.25, 4.6]], [6.0, [0, 1.25, 4.6]]], eyePos);
  const look = elapsed > flatten ? target.player.position : {x: boulder.position.x, y: 1.0, z: 0};
  const dx = look.x - position.x, dz = (look.z || 0) - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = Math.atan2(-dx, -dz);
  stage.basePitch = elapsed < flatten ? Math.atan2(1.0 - position.y, Math.hypot(dx, dz)) : -0.2;""",
  """  // self IS the target: stand in the lane, watch the boulder grow, then
  // (after the flatten) watch your own paper-goose body drift away
  const camTrackSelf = [[0, [0, 1.02, 0]], [flatten, [0, 1.02, 0]], [flatten + 0.3, [0, 1.0, 0.5]], [6.0, [0.6, 0.95, 1.4]]];
  const position = track(elapsed, isSelf ? camTrackSelf : [[0, [0, 1.25, 4.6]], [6.0, [0, 1.25, 4.6]]], eyePos);
  if (isSelf && elapsed >= flatten + 0.15 && !target.player.visible) target.player.visible = true; // the paper goose appears
  const look = (isSelf && elapsed >= flatten) ? target.player.position : {x: boulder.position.x, y: 1.0, z: 0};
  const dx = look.x - position.x, dz = (look.z || 0) - position.z;
  stage.trajectory.body = target.player.position.toArray();
  stage.trajectory.eye = position.toArray();
  camera.position.copy(position);
  stage.baseYaw = Math.abs(dx) + Math.abs(dz) < 0.15 ? Math.PI / 2 : Math.atan2(-dx, -dz);
  stage.basePitch = elapsed < flatten ? Math.atan2(1.0 - position.y, Math.hypot(dx, dz) || 1) * 0.8 : -0.15;"""),
])

print('ALL POLISH APPLIED')
