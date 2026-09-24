// Meeting visuals: the world courthouse bell and the round-table stage. Prop instances
// share library resources (removed, never disposed here); actors are reparented in and
// out by the director. Dynamic water/fire/live lighting live in other modules.
import * as THREE from 'three';
import {createHeadMount} from './immersion-headmount.js';
import {seatTransform} from './immersion-config.js';

// Seated first-person lens height above the table top (see povSync).
const MEETING_EYE_LIFT = 0.30;

export function createWorldBell({config, props}) {
 const group = props.instantiate('prop_bell');
 const names = props.nodeNames();
 const [x, groundY, z] = config.bell.base;
 group.position.set(x, groundY, z);
 const swing = group.getObjectByName(names.bellSwingPivot);
 const clapper = group.getObjectByName(names.bellClapperPivot);
 let ringing = -1;
 return {
  group,
  ring() { ringing = 0; },
  isRinging() { return ringing >= 0; },
  update(dt) {
   if (ringing < 0) return;
   ringing += dt;
   const decay = Math.exp(-ringing * 3.0);
   if (swing) swing.rotation.z = Math.sin(ringing * 17) * 0.22 * decay;
   if (clapper) clapper.rotation.z = Math.sin(ringing * 17 + 0.7) * 0.5 * decay;
   if (ringing > 1.8) {
    if (swing) swing.rotation.z = 0;
    if (clapper) clapper.rotation.z = 0;
    ringing = -1;
   }
  },
  dispose() {
   if (group.parent) group.parent.remove(group);
  },
 };
}

// R2 2026-09-24 courtroom backdrop (was a dark 2m band in a brown void). The
// V8 sample's windows floated because they rose above a 2m wall; the wall is
// now 3.4m with a wainscot, chair rail and crown trim, the windows sit inside
// it, and a ceiling closes the room. Camera stays the player's seat POV.
// Everything is emissive/standard material -- no extra real-time lights.
function buildBackdrop(scene) {
 const parts = [];
 const keep = o => { parts.push(o); return o; };
 const add = (geo, mat, setup) => { const m = new THREE.Mesh(keep(geo), keep(mat)); setup(m); scene.add(m); return m; };
 const R = 4.4, H = 3.4;
 add(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({color: '#3a2a1f', roughness: 0.9}), m => { m.rotation.x = -Math.PI / 2; m.position.y = -0.002; });
 add(new THREE.CircleGeometry(2.45, 48), new THREE.MeshStandardMaterial({color: '#5c2b27', roughness: 1}), m => { m.rotation.x = -Math.PI / 2; m.position.y = 0.001; });
 add(new THREE.RingGeometry(2.45, 2.6, 48), new THREE.MeshStandardMaterial({color: '#b08a4a', roughness: 0.8}), m => { m.rotation.x = -Math.PI / 2; m.position.y = 0.0015; });
 add(new THREE.CylinderGeometry(R, R, H, 48, 1, true), new THREE.MeshStandardMaterial({color: '#4d3528', roughness: 1, side: THREE.BackSide}), m => { m.position.y = H / 2; });
 add(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 1.0, 48, 1, true), new THREE.MeshStandardMaterial({color: '#2e1f17', roughness: 0.9, side: THREE.BackSide}), m => { m.position.y = 0.5; });
 const trimMat = keep(new THREE.MeshStandardMaterial({color: '#6a4a30', roughness: 0.8, side: THREE.BackSide}));
 for (const [y, h] of [[1.03, 0.08], [H - 0.06, 0.12]]) {
  const trim = new THREE.Mesh(keep(new THREE.CylinderGeometry(R - 0.03, R - 0.03, h, 48, 1, true)), trimMat);
  trim.position.y = y; scene.add(trim);
 }
 add(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({color: '#20160f', roughness: 1}), m => { m.rotation.x = Math.PI / 2; m.position.y = H; });
 // arched windows set into the wall, facing the table; night blue outside
 // unlit panes: the warm key lights washed a lit pane out to grey
 const paneMat = keep(new THREE.MeshBasicMaterial({color: '#3f5f93'}));
 const frameMat = keep(new THREE.MeshStandardMaterial({color: '#2a1b12', roughness: 0.9}));
 const paneGeo = keep(new THREE.PlaneGeometry(0.9, 1.35));
 const archGeo = keep(new THREE.CircleGeometry(0.45, 18, 0, Math.PI));
 const frameGeo = keep(new THREE.PlaneGeometry(1.06, 1.95));
 const barGeo = keep(new THREE.PlaneGeometry(0.04, 1.8));
 for (const a of [Math.PI, Math.PI - 0.62, Math.PI + 0.62, Math.PI - 1.3, Math.PI + 1.3]) {
  const g = new THREE.Group();
  g.position.set(Math.sin(a) * (R - 0.05), 0, Math.cos(a) * (R - 0.05));
  g.lookAt(0, 0, 0);
  const frame = new THREE.Mesh(frameGeo, frameMat); frame.position.set(0, 1.9, -0.005); g.add(frame);
  const pane = new THREE.Mesh(paneGeo, paneMat); pane.position.set(0, 1.78, 0); g.add(pane);
  const arch = new THREE.Mesh(archGeo, paneMat); arch.position.set(0, 2.455, 0); g.add(arch);
  const bar = new THREE.Mesh(barGeo, frameMat); bar.position.set(0, 1.95, 0.004); g.add(bar);
  scene.add(g); parts.push(g);
 }
 // low chandelier over the table: rod from the ceiling, gold ring, candle glow
 const gold = keep(new THREE.MeshStandardMaterial({color: '#c9a13b', roughness: 0.35, metalness: 0.6}));
 const glowMat = keep(new THREE.MeshStandardMaterial({color: '#ffe6b0', emissive: '#ffd684', emissiveIntensity: 1.2}));
 const lamp = new THREE.Group();
 const rod = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.018, 0.018, H - 2.4, 8)), gold); rod.position.y = (H - 2.4) / 2; lamp.add(rod);
 const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.42, 0.03, 8, 32)), gold); ring.rotation.x = Math.PI / 2; lamp.add(ring);
 const bulbGeo = keep(new THREE.SphereGeometry(0.05, 10, 8));
 for (let b = 0; b < 6; b++) {
  const a = b / 6 * Math.PI * 2;
  const bulb = new THREE.Mesh(bulbGeo, glowMat); bulb.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42); lamp.add(bulb);
 }
 lamp.position.y = 2.4; // high enough to frame the top edge without pressing on the table
 scene.add(lamp); parts.push(lamp);
 return parts;
}

export function createMeetingStage({actors, playerActorId, config, props}) {
 const scene = new THREE.Scene();
 scene.background = new THREE.Color('#262019');
 const meeting = config.meeting;
 const owned = [];

 const table = props.instantiate('prop_round_table');
 scene.add(table);
 owned.push(table);
 const chairRoots = [];
 for (let i = 0; i < meeting.seatCount; i++) {
  const chair = props.instantiate('prop_chair');
  const {angle, position} = seatTransform(i);
  chair.position.set(position[0], 0, position[2]);
  chair.rotation.y = angle + Math.PI;
  scene.add(chair);
  chairRoots.push(chair);
  owned.push(chair);
 }

 scene.add(new THREE.HemisphereLight('#8a7660', '#221a1c', 0.95));
 const warm = new THREE.PointLight('#ffd9a2', 26, 12, 1.7);
 warm.position.set(0, 2.7, 0.4);
 scene.add(warm);
 const warm2 = new THREE.PointLight('#ffc98a', 10, 10, 1.8);
 warm2.position.set(0, 1.6, -2.2);
 scene.add(warm2);
 const cool = new THREE.DirectionalLight('#a8c2dd', 1.1);
 cool.position.set(-4, 3.2, -5);
 scene.add(cool);
 const fill = new THREE.DirectionalLight('#ffffff', 0.85);
 fill.position.set(2, 2.4, 4);
 scene.add(fill);
 // Camera-side key: seated NPCs face the player, so light their fronts from
 // the player's side or pale feathers read as ghostly silhouettes.
 const key = new THREE.PointLight('#ffe9cf', 7, 7, 1.8);
 key.position.set(0, 1.5, 1.3);
 scene.add(key);

 const backdropParts = buildBackdrop(scene);

 // Actors: seat i faces the table center; base yaw stashed for speaker motion.
 const seated = [];
 for (let i = 0; i < meeting.seatCount; i++) {
  const actorId = actors.ids[i];
  const avatar = actors.get(actorId);
  if (!avatar) continue;
  const {angle, position} = seatTransform(i);
  actors.pose(actorId, 'seated');
  const baseYaw = angle + Math.PI;
  avatar.player.position.set(position[0], 0, position[2]);
  avatar.player.rotation.y = baseYaw;
  avatar.player.visible = true; // own seat too: the head mount hides only the head
  scene.add(avatar.player);
  seated.push({actorId, avatar, baseYaw, angle, position});
 }

 // First person sits on the player's real seated body (2026-09-24; the camera
 // used to carry two proxy wings). The head mount hides only the head; every
 // frame povSync() turns the body with the gaze and seats the lens on the eye.
 const ownSeat = seated.find(s => s.actorId === playerActorId) || null;
 const head = ownSeat ? createHeadMount(ownSeat.avatar) : null;
 if (head) head.setHeadHidden(true);

 const camera = new THREE.PerspectiveCamera(meeting.camera.fov, 1, 0.035, 60);
 camera.position.set(...meeting.camera.position);
 camera.lookAt(0, meeting.camera.lookY, 0);
 scene.add(camera);
 const povEye = new THREE.Vector3();

 let lastSpeakerIndex = -1;

 return {
  scene,
  camera,
  seatOf: id => seated.find(s => s.actorId === id),
  update({elapsed, speakerIndex, reducedMotion, actorIds}) {
   if (reducedMotion) return;
   if (lastSpeakerIndex !== speakerIndex) {
    for (const s of seated) s.avatar.model.rotation.y = 0;
    lastSpeakerIndex = speakerIndex;
   }
   const speaker = seated.find(s => s.actorId === actorIds[speakerIndex]);
   for (const s of seated) {
    if (s === speaker) {
     s.avatar.model.rotation.y = Math.sin(elapsed * 2.3) * 0.07;
     s.avatar.visual.rotation.z = Math.sin(elapsed * 1.7) * 0.02;
    } else if (speaker) {
     const dx = speaker.avatar.player.position.x - s.avatar.player.position.x;
     const dz = speaker.avatar.player.position.z - s.avatar.player.position.z;
     const target = Math.atan2(dx, dz) - s.baseYaw;
     const wrapped = Math.atan2(Math.sin(target), Math.cos(target));
     s.avatar.player.rotation.y = s.baseYaw + wrapped * 0.55;
    }
   }
  },
  projection(width, height) {
   camera.aspect = width / height;
   camera.updateProjectionMatrix();
  },
  reset() {
   lastSpeakerIndex = -1;
   for (const s of seated) {
    s.avatar.model.rotation.y = 0;
    s.avatar.visual.rotation.z = 0;
    s.avatar.player.rotation.y = s.baseYaw;
    s.avatar.player.visible = true;
   }
   if (head) head.setHeadHidden(true);
  },
  // Put the player back in the chair (the bell ring borrows the avatar into the
  // town scene) and re-pose it seated.
  seatPlayer() {
   if (!ownSeat) return;
   actors.pose(playerActorId, 'seated');
   ownSeat.avatar.player.position.set(ownSeat.position[0], 0, ownSeat.position[2]);
   ownSeat.avatar.player.rotation.set(0, ownSeat.baseYaw, 0);
   ownSeat.avatar.player.visible = true;
   if (ownSeat.avatar.player.parent !== scene) scene.add(ownSeat.avatar.player);
   if (head) head.setHeadHidden(true);
  },
  // After the look controller set the camera rotation: turn the seated body
  // with the gaze, then seat the lens on the eye. Returns the lens-to-eye gap.
  povSync() {
   if (!head || !ownSeat || ownSeat.avatar.player.parent !== scene) return null;
   head.alignBodyToCamera(camera);
   head.eyeWorld(povEye);
   // A seated goose's real eye is level with the table top and ~8cm from its edge,
   // so the table rim filled the frame and the others showed half a head. The lens
   // keeps the real eye's x/z (in front of the face, so never inside the head) and
   // sits up to MEETING_EYE_LIFT above the table top -- "sitting up straight".
   povEye.y = Math.max(povEye.y, meeting.tableTopY + MEETING_EYE_LIFT);
   camera.position.copy(povEye);
   return 0;
  },
  // Where the lens should be right now (the lifted eye); used by diagnostics.
  get lens() { return povEye; },
  get headMount() { return head; },
  detachActors() {
   for (const s of seated) {
    s.avatar.model.rotation.y = 0;
    s.avatar.visual.rotation.z = 0;
    if (s.avatar.player.parent === scene) scene.remove(s.avatar.player);
   }
   if (head) head.setHeadHidden(false);
   if (ownSeat) ownSeat.avatar.player.rotation.set(0, ownSeat.baseYaw, 0);
  },
  dispose() {
   this.detachActors();
   for (const object of owned) if (object.parent === scene) scene.remove(object);
   for (const part of backdropParts) if (part.dispose) part.dispose();
   scene.clear();
  },
 };
}
