# One-off patcher (2026-09-24): bell ring on the real body + meeting POV sync in the
# director. Record of the change; not part of the build.
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
p = ROOT / 'src' / 'immersion-director.js'
s = p.read_text(encoding='utf-8')
assert 'function buildRingBody' not in s, 'already applied'


def rep(old, new):
    global s
    assert s.count(old) == 1, old[:80]
    s = s.replace(old, new)


# state: the proxy wing group becomes "the ring borrowed the player's body"
rep(" let ringWings = null;\n", " let ringBody = null; // {avatar, mount} while the bell ring borrows the player's body\n")

# ring camera: sit on the real eye while the body is in the town scene
rep("  const eye = bellEyePose();\n  ringCamera.position.set(...eye.position);\n  ringCamera.lookAt(...eye.target);\n",
    "  const eye = bellEyePose();\n"
    "  if (ringBody) ringCamera.position.copy(ringBody.mount.eyeWorld(ringEye));\n"
    "  else ringCamera.position.set(...eye.position);\n"
    "  ringCamera.lookAt(...eye.target);\n")

start = s.index(" function buildRingWings() {")
end = s.index(" // ---------------------------------------------------------------------------\n // Self POV:")
RING = r''' // Bell ring on the real body (2026-09-24; two proxy wings used to hang off the
 // ring camera). The player's own immersion avatar is borrowed from the meeting
 // scene into the town, stood at the bell's interaction spot facing the bell, and
 // the ring camera sits on its eye. It reuses the meeting stage's head mount --
 // that mount already hid the head at load, and a second mount would record the
 // hidden state as "original" and never show the head again. The avatar goes back
 // to its chair via meetingStage.seatPlayer() when seating begins.
 const ringEye = new THREE.Vector3();
 function buildRingBody() {
  destroyRingBody();
  if (!actors || !meetingStage || !meetingStage.headMount) return;
  const avatar = actors.get(playerActorId);
  if (!avatar) return;
  const mount = meetingStage.headMount;
  actors.pose(playerActorId, 'standing'); // pose() restores load transforms, so place afterwards
  const [ix, iz] = IMMERSION_CONFIG.bell.interaction;
  const [bx, by, bz] = IMMERSION_CONFIG.bell.base;
  avatar.player.position.set(ix, by, iz);
  avatar.player.rotation.set(0, 0, 0);
  avatar.player.visible = true;
  worldScene.add(avatar.player);
  mount.faceTowards(bx, bz);
  mount.setHeadHidden(true);
  ringBody = {avatar, mount};
 }

 function destroyRingBody() {
  if (ringBody) {
   actors?.reachWings(playerActorId, 0);
   if (ringBody.avatar.player.parent === worldScene) worldScene.remove(ringBody.avatar.player);
  }
  ringBody = null;
 }

'''
s = s[:start] + RING + s[end:]

assert s.count('buildRingWings();') == 1 and s.count('destroyRingWings();') == 1
s = s.replace('buildRingWings();', 'buildRingBody();').replace('destroyRingWings();', 'destroyRingBody();')

# ring beat: the real wings reach toward the bell instead of the proxy rig
rep("   if (ringWings) {\n"
    "    // 0-0.3s reach toward the bell, 0.3-0.9s withdraw, then rest.\n"
    "    let reach = 0;\n"
    "    if (t < 0.3) reach = t / 0.3;\n"
    "    else if (t < 0.9) reach = 1 - (t - 0.3) / 0.6;\n"
    "    ringWings.position.z = -0.55 - reach * 0.28;\n"
    "    ringWings.rotation.x = 0.2 - reach * 0.35;\n"
    "   }\n",
    "   if (ringBody) {\n"
    "    // 0-0.3s reach toward the bell, 0.3-0.9s withdraw, then rest (real wings now).\n"
    "    let reach = 0;\n"
    "    if (t < 0.3) reach = t / 0.3;\n"
    "    else if (t < 0.9) reach = 1 - (t - 0.3) / 0.6;\n"
    "    actors.reachWings(playerActorId, snapshot.reducedMotion ? 0 : reach);\n"
    "   }\n")

# meeting: seat the player back and keep the lens on its eye every frame
rep("   case 'seating':\n    if (worldBell) worldBell.update(0);\n    if (meetingStage) {\n     meetingStage.reset();",
    "   case 'seating':\n    if (worldBell) worldBell.update(0);\n    destroyRingBody();\n    if (meetingStage) {\n     meetingStage.seatPlayer();\n     meetingStage.reset();")
rep("   if (look.state().enabled) look.apply(meetingStage.camera, 0, -0.123);\n   return;\n",
    "   if (look.state().enabled) look.apply(meetingStage.camera, 0, -0.123);\n"
    "   meetingStage.povSync(); // real seated body: turn it with the gaze, lens on the eye\n"
    "   return;\n")

# diagnostics: where the ring / meeting lens sits relative to the eye
rep("    selfPov: ['ejection', 'finished'].includes(snapshot.phase) ? selfPovState() : null,\n",
    "    selfPov: ['ejection', 'finished'].includes(snapshot.phase) ? selfPovState() : null,\n"
    "    bodyPov: bodyPovState(snapshot.phase),\n")
rep(" function selfPovState() {",
    ''' // Ring / meeting first person: lens-to-eye gap, own body visible, head hidden,
 // and what the centre of the view hits (must never be the own body up close).
 function bodyPovState(phase) {
  let cam = null, scene = null, mount = null;
  if (phase === 'ringing' && ringBody) { cam = ringCamera; scene = worldScene; mount = ringBody.mount; }
  else if (['seating', 'discussion', 'voting', 'result'].includes(phase) && meetingStage && meetingStage.headMount) {
   cam = meetingStage.camera; scene = meetingStage.scene; mount = meetingStage.headMount;
  }
  if (!cam || !mount) return null;
  const eye = mount.eyeWorld(new THREE.Vector3());
  cam.updateMatrixWorld();
  povRay.setFromCamera(povNdc, cam);
  povRay.near = 0.01; povRay.far = 30;
  const visibleChain = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  const hit = povRay.intersectObject(scene, true).find(h => h.object.isMesh && visibleChain(h.object));
  let self = false;
  if (hit) for (let n = hit.object; n; n = n.parent) if (n === mount.avatar.player) { self = true; break; }
  return {phase, camToEye: +cam.position.distanceTo(eye).toFixed(4), bodyVisible: Boolean(mount.avatar.player.visible && mount.avatar.player.parent),
   headHidden: mount.headHidden, centerHit: hit ? {self, distance: +hit.distance.toFixed(3), name: String(hit.object.name || '').slice(0, 40)} : null};
 }
 function selfPovState() {''')

assert 'ringWings' not in s, [l for l in s.splitlines() if 'ringWings' in l][:3]
p.write_bytes(s.encode('utf-8'))
print('director: ring on the real body, meeting POV sync, bodyPov diagnostics')
