# One-off patcher (2026-09-24): meeting and bell ring use the real body with a head
# mounted camera, like the self ejection. Record of the change; not part of the build.
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]


def edit(path, pairs):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:70])
        s = s.replace(old, new)
    p.write_bytes(s.encode('utf-8'))
    print(path, 'ok')


# ------------------------------------------------------------------ meeting
edit('src/immersion-meeting.js', [
    ("import * as THREE from 'three';\n",
     "import * as THREE from 'three';\nimport {createHeadMount} from './immersion-headmount.js';\n"),
    # own seat is shown now (head hidden instead)
    ("  avatar.player.visible = actorId !== playerActorId;\n  scene.add(avatar.player);\n  seated.push({actorId, avatar, baseYaw, angle});\n",
     "  avatar.player.visible = true; // own seat too: the head mount hides only the head\n  scene.add(avatar.player);\n  seated.push({actorId, avatar, baseYaw, angle, position});\n"),
    # wing proxy -> head mount
    (" // First-person wings hang off the camera so the bottom edge reads as \"you\".\n"
     " const wings = actors.extractWings(playerActorId);\n"
     " let wingsRig = null;\n"
     " if (wings) {\n"
     "  wingsRig = new THREE.Group();\n"
     "  wingsRig.name = 'pov-wings-rig';\n"
     "  wings.position.set(0, -0.185, -0.42);\n"
     "  wings.rotation.set(0.15, 0, 0);\n"
     "  wingsRig.add(wings);\n"
     " }\n",
     " // First person sits on the player's real seated body (2026-09-24; the camera\n"
     " // used to carry two proxy wings). The head mount hides only the head; every\n"
     " // frame povSync() turns the body with the gaze and seats the lens on the eye.\n"
     " const ownSeat = seated.find(s => s.actorId === playerActorId) || null;\n"
     " const head = ownSeat ? createHeadMount(ownSeat.avatar) : null;\n"
     " if (head) head.setHeadHidden(true);\n"),
    (" scene.add(camera);\n if (wingsRig) camera.add(wingsRig);\n",
     " scene.add(camera);\n"
     " const povEye = new THREE.Vector3();\n"),
    # reset: own seat stays visible
    ("    s.avatar.player.visible = s.actorId !== playerActorId;\n   }\n  },\n",
     "    s.avatar.player.visible = true;\n   }\n   if (head) head.setHeadHidden(true);\n  },\n"
     "  // Put the player back in the chair (the bell ring borrows the avatar into the\n"
     "  // town scene) and re-pose it seated.\n"
     "  seatPlayer() {\n"
     "   if (!ownSeat) return;\n"
     "   actors.pose(playerActorId, 'seated');\n"
     "   ownSeat.avatar.player.position.set(ownSeat.position[0], 0, ownSeat.position[2]);\n"
     "   ownSeat.avatar.player.rotation.set(0, ownSeat.baseYaw, 0);\n"
     "   ownSeat.avatar.player.visible = true;\n"
     "   if (ownSeat.avatar.player.parent !== scene) scene.add(ownSeat.avatar.player);\n"
     "   if (head) head.setHeadHidden(true);\n"
     "  },\n"
     "  // After the look controller set the camera rotation: turn the seated body\n"
     "  // with the gaze, then seat the lens on the eye. Returns the lens-to-eye gap.\n"
     "  povSync() {\n"
     "   if (!head || !ownSeat || ownSeat.avatar.player.parent !== scene) return null;\n"
     "   head.alignBodyToCamera(camera);\n"
     "   head.eyeWorld(povEye);\n"
     "   camera.position.copy(povEye);\n"
     "   return 0;\n"
     "  },\n"
     "  get headMount() { return head; },\n"),
    # detach: give the head back; no wing rig any more
    ("   if (wingsRig && wingsRig.parent === camera) camera.remove(wingsRig);\n  },\n",
     "   if (head) head.setHeadHidden(false);\n   if (ownSeat) ownSeat.avatar.player.rotation.set(0, ownSeat.baseYaw, 0);\n  },\n"),
    ("   if (wingsRig) wingsRig.clear();\n", ""),
])
