// Meeting visuals: the world courthouse bell and the round-table stage. Prop instances
// share library resources (removed, never disposed here); actors are reparented in and
// out by the director. Dynamic water/fire/live lighting live in other modules.
import * as THREE from 'three';
import {seatTransform} from './immersion-config.js';

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

function buildBackdrop(scene) {
 const floorGeo = new THREE.CircleGeometry(3.6, 48);
 const floorMat = new THREE.MeshStandardMaterial({color: '#2b211b', roughness: 0.95});
 const floor = new THREE.Mesh(floorGeo, floorMat);
 floor.rotation.x = -Math.PI / 2;
 floor.position.y = -0.002;
 scene.add(floor);
 const wallGeo = new THREE.CylinderGeometry(4.4, 4.4, 2.0, 40, 1, true);
 const wallMat = new THREE.MeshStandardMaterial({color: '#39262a', roughness: 1, side: THREE.BackSide});
 const wall = new THREE.Mesh(wallGeo, wallMat);
 wall.position.y = 1.0;
 scene.add(wall);
 const trimGeo = new THREE.CylinderGeometry(4.41, 4.41, 0.16, 40, 1, true);
 const trimMat = new THREE.MeshStandardMaterial({color: '#57331f', roughness: 0.8, side: THREE.BackSide});
 const trim = new THREE.Mesh(trimGeo, trimMat);
 trim.position.y = 1.7;
 scene.add(trim);
 return [floor, wall, trim, floorGeo, floorMat, wallGeo, wallMat, trimGeo, trimMat];
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
 const fill = new THREE.DirectionalLight('#ffffff', 0.55);
 fill.position.set(2, 2.4, 4);
 scene.add(fill);

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
  avatar.player.visible = actorId !== playerActorId;
  scene.add(avatar.player);
  seated.push({actorId, avatar, baseYaw, angle});
 }

 // First-person wings hang off the camera so the bottom edge reads as "you".
 const wings = actors.extractWings(playerActorId);
 let wingsRig = null;
 if (wings) {
  wingsRig = new THREE.Group();
  wingsRig.name = 'pov-wings-rig';
  wings.position.set(0, -0.185, -0.42);
  wings.rotation.set(0.15, 0, 0);
  wingsRig.add(wings);
 }

 const camera = new THREE.PerspectiveCamera(meeting.camera.fov, 1, 0.035, 60);
 camera.position.set(...meeting.camera.position);
 camera.lookAt(0, meeting.camera.lookY, 0);
 scene.add(camera);
 if (wingsRig) camera.add(wingsRig);

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
    s.avatar.player.visible = s.actorId !== playerActorId;
   }
  },
  detachActors() {
   for (const s of seated) {
    s.avatar.model.rotation.y = 0;
    s.avatar.visual.rotation.z = 0;
    if (s.avatar.player.parent === scene) scene.remove(s.avatar.player);
   }
   if (wingsRig && wingsRig.parent === camera) camera.remove(wingsRig);
  },
  dispose() {
   this.detachActors();
   for (const object of owned) if (object.parent === scene) scene.remove(object);
   if (wingsRig) wingsRig.clear();
   for (const part of backdropParts) if (part.dispose) part.dispose();
   scene.clear();
  },
 };
}
