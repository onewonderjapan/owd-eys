// First-person head mount for the player's own avatar (2026-09-24). Shared by the
// bell ring, the meeting and the self ejection so all three put the camera on the
// real body the same way. Nothing here is hand-placed per character or per angle:
//
// - the eye point comes from the eye meshes' bounds in model space, on the midline,
//   pushed just ahead of the face (and of the head surface at eye height) so the
//   lens is outside the head;
// - only the head is hidden (eyes, beak, nostrils, crown feathers, plus any
//   headwear/facewear socket), so looking down shows the real posed body;
// - the goose head and body are ONE mesh, so the head surface cannot be hidden on
//   its own; a gaze off the body's facing would look through your own head. The
//   caller therefore turns the body with the gaze (alignBodyToCamera) and then
//   re-seats the lens on the eye.
import * as THREE from 'three';

// GLTFLoader sanitizes node names (spaces -> '_'), so every pattern accepts either.
const BODY_NAME = /seamless[\s_]rounded[\s_]body/i;
const EYE_BOUNDS_NAME = /eye[\s_](white[\s_]sclera|ink[\s_]rim)/i;
const HEAD_PART_NAME = /(^|[\s_|])eye([\s_]|$)|beak|nostril|crown|mouth[\s_]crease/i;
// 0.2 model units (~5.6cm at the 0.28 avatar scale) ahead of the face, so a raised
// gaze does not catch the top of the head in the upper edge of the frame.
const EYE_AHEAD = 0.2;

export function createHeadMount(avatar) {
 if (!avatar || !avatar.model) return null;
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
  if (BODY_NAME.test(name)) bodyMesh = o;
  if (EYE_BOUNDS_NAME.test(name)) { part.setFromObject(o); part.applyMatrix4(toModel); eyeBox.union(part); }
  if (HEAD_PART_NAME.test(name)) hidden.push({o, visible: o.visible});
 });
 if (eyeBox.isEmpty()) return null;
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
 const eyeLocal = new THREE.Vector3(0, eyeCenter.y, front + EYE_AHEAD);
 const camDir = new THREE.Vector3(), bodyDir = new THREE.Vector3();
 let headHidden = false;

 const mount = {
  avatar,
  eyeLocal,
  hidden,
  get headHidden() { return headHidden; },
  setHeadHidden(next) {
   if (headHidden === next) return;
   headHidden = next;
   for (const h of hidden) h.o.visible = next ? false : h.visible;
  },
  // World-space eye point for the avatar's current pose.
  eyeWorld(out = new THREE.Vector3()) {
   avatar.player.updateWorldMatrix(true, true);
   return out.copy(eyeLocal).applyMatrix4(model.matrixWorld);
  },
  // Yaw `body` (default: the avatar's player group) until the model faces the
  // camera's horizontal heading. Returns false when either direction is vertical.
  alignBodyToCamera(camera, body = avatar.player) {
   camera.updateMatrixWorld();
   camera.getWorldDirection(camDir);
   model.updateWorldMatrix(true, false);
   model.getWorldDirection(bodyDir); // +z of the model = where the goose faces
   if (Math.hypot(camDir.x, camDir.z) < 1e-3 || Math.hypot(bodyDir.x, bodyDir.z) < 1e-3) return false;
   const delta = Math.atan2(camDir.x, camDir.z) - Math.atan2(bodyDir.x, bodyDir.z);
   body.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta));
   body.updateWorldMatrix(true, true);
   return true;
  },
  // Face a world point: yaw the body so the model looks at (x, z).
  faceTowards(x, z, body = avatar.player) {
   model.updateWorldMatrix(true, false);
   model.getWorldDirection(bodyDir);
   const p = new THREE.Vector3();
   model.getWorldPosition(p);
   const want = Math.atan2(x - p.x, z - p.z), have = Math.atan2(bodyDir.x, bodyDir.z);
   const delta = want - have;
   body.rotation.y += Math.atan2(Math.sin(delta), Math.cos(delta));
   body.updateWorldMatrix(true, true);
  },
  release() { mount.setHeadHidden(false); },
 };
 return mount;
}
