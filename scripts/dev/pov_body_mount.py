# One-off patcher (2026-09-24): replace the self-POV proxy wing rig with a camera
# mounted on the player's own head, showing the real body. Record of the change;
# not part of the build.
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
p = ROOT / 'src' / 'immersion-director.js'
s = p.read_text(encoding='utf-8')
assert 'function buildSelfPov' not in s, 'already applied'

start = s.index(' function buildEjectionWings() {')
end_marker = '  ejectionWings = null;\n }\n'
end = s.index(end_marker, start) + len(end_marker)

NEW = r''' // ---------------------------------------------------------------------------
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
   if (/seamless rounded body/i.test(name)) bodyMesh = o;
   if (/eye (white sclera|ink rim)/i.test(name)) { part.setFromObject(o); part.applyMatrix4(toModel); eyeBox.union(part); }
   if (/\beye\b|beak|nostril|crown|mouth crease/i.test(name)) hidden.push({o, visible: o.visible});
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
   eyeLocal: new THREE.Vector3(0, eyeCenter.y, front + 0.06),
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
  const headYaw = flat > 1e-4 ? Math.atan2(-dx, -dz) : yaw;
  const headPitch = Math.atan2(dy, Math.max(flat, 1e-4));
  const b = selfPov.blend * selfPov.blend * (3 - 2 * selfPov.blend);
  cam.position.lerpVectors(povAuthored, povEye, b);
  stage.baseYaw = shortAngle(yaw, headYaw, b);
  stage.basePitch = pitch + (headPitch - pitch) * b;
  selfPov.camToEye = +cam.position.distanceTo(povEye).toFixed(4);
  if (stage.trajectory) stage.trajectory.eye = cam.position.toArray(); // audio cues follow the real eye
 }
 function selfPovState() {
  if (!selfPov) return null;
  return {mode: selfPov.mode, blend: +selfPov.blend.toFixed(3), camToEye: selfPov.camToEye,
   bodyVisible: Boolean(selfPov.avatar.player.visible), headHidden: selfPov.headHidden, roll: +selfPov.roll.toFixed(3)};
 }
 function destroySelfPov() {
  if (selfPov) {
   setHeadHidden(false);
   selfPov.avatar.player.rotation.z = 0;
  }
  selfPov = null;
 }
'''
s = s[:start] + NEW + s[end:]

reps = [
    (" let ejectionWings = null;\n", " let selfPov = null; // head-mounted self camera state (see buildSelfPov)\n"),
]
for o, n in reps:
    assert s.count(o) == 1, o
    s = s.replace(o, n)
assert s.count('destroyEjectionWings();') == 2, s.count('destroyEjectionWings();')
s = s.replace('destroyEjectionWings();', 'destroySelfPov();')
assert s.count('    buildEjectionWings();\n') == 1
s = s.replace('    buildEjectionWings();\n', '    buildSelfPov();\n')

old_upd = "   ejectionStage.update({elapsed, reducedMotion: snapshot.reducedMotion});\n   updateEjectionWings();\n"
new_upd = "   ejectionStage.update({elapsed, reducedMotion: snapshot.reducedMotion});\n   applySelfPov(phase === 'finished' ? 0 : dt, elapsed, snapshot.reducedMotion);\n"
assert s.count(old_upd) == 1
s = s.replace(old_upd, new_upd)

old_rot = "    ejectionStage.camera.rotation.set(ejectionStage.basePitch ?? 0, ejectionStage.baseYaw ?? 0, 0, 'YXZ');\n   }\n"
new_rot = old_rot + "   if (selfPov && selfPov.roll) ejectionStage.camera.rotation.z = selfPov.roll; // mild wobble, after the look is applied\n"
assert s.count(old_rot) == 1
s = s.replace(old_rot, new_rot)

old_state = "    povWings: ['ejection', 'finished'].includes(snapshot.phase) ? povWingsOnScreen() : null,\n"
assert s.count(old_state) == 1
s = s.replace(old_state, "    selfPov: ['ejection', 'finished'].includes(snapshot.phase) ? selfPovState() : null,\n")

assert 'ejectionWings' not in s, [l for l in s.splitlines() if 'ejectionWings' in l][:5]
p.write_bytes(s.encode('utf-8'))
print('director: self POV body mount installed')
