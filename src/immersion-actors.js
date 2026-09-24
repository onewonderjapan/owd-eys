// Independent actor loading and posing for the immersion session. One ActorSet per
// session owns its eight avatars; the walking avatar on the map is never touched.
import * as THREE from 'three';
import {loadWalkingAvatar, disposeWalkingAvatar} from './map-walk-avatar.js';

const SEAT_DROP = 0.052;      // model-space drop so the hips rest on the 0.30 seat
const SEAT_LEG_ANGLE = -1.22; // legs swung forward toward the table
const CARRY_LEG_ANGLE = -0.85;
const CARRY_WING_ANGLE = -0.65;

function isLegNode(name) { return /foot|shin|paddle/i.test(name); }
function isWingNode(name) { return /wing/i.test(name); }

function saveTransforms(root) {
  const saved = new Map();
  root.traverse(o => saved.set(o, {position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone()}));
  return saved;
}

// Wrap a mesh in a pivot at its local top so rotations read as a joint, keeping the
// mesh's world transform. Returns null when the node already sits inside a pivot.
function wrapInPivot(node) {
  if (node.parent && node.parent.userData.immersionPivot) return node.parent;
  node.updateWorldMatrix(true, false);
  // The pivot's LOCAL transform must be parentWorld^-1 * nodeWorld. The old code
  // decomposed node.matrixWorld directly, i.e. used WORLD values as local ones —
  // under the 0.28-scaled visual parent that collapsed every leg node onto the
  // model origin (all legs bunched on the body axis: the seated 'clipping').
  const local = new THREE.Matrix4().copy(node.parent.matrixWorld).invert().multiply(node.matrixWorld);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  local.decompose(pos, quat, scale);
  const pivot = new THREE.Group();
  pivot.userData.immersionPivot = true;
  pivot.name = node.name + ' pivot';
  node.parent.add(pivot);
  node.parent.remove(node);
  pivot.add(node);
  pivot.position.copy(pos);
  pivot.quaternion.copy(quat);
  pivot.scale.copy(scale);
  // Re-express the node in pivot space with an identity transform so the pivot's
  // placement fully determines the node's world pose.
  node.position.set(0, 0, 0);
  node.quaternion.identity();
  node.scale.set(1, 1, 1);
  return pivot;
}

function collectPoseNodes(model) {
  const legs = [], wings = [];
  model.traverse(o => {
    if (!o.isMesh && !o.isGroup) return;
    const name = o.name || '';
    if (isLegNode(name)) legs.push(o);
    else if (isWingNode(name)) wings.push(o);
  });
  return {legs, wings};
}

export async function loadImmersionActors(actorIds, {onProgress = () => {}, isCurrent = () => true, maxConcurrent = 2} = {}) {
  const actors = new Map();
  let done = 0, failure = null;
  const report = () => onProgress(done, actorIds.length);

  const loadOne = async id => {
    try {
      const avatar = await loadWalkingAvatar(id);
      if (!isCurrent()) {
        disposeWalkingAvatar(avatar);
        throw Object.assign(new Error('cancelled'), {cancelled: true});
      }
      // The roam-only ground shadow and selection ring would read as debug circles.
      for (const child of avatar.player.children) if (child.isMesh) child.visible = false;
      const saved = saveTransforms(avatar.player);
      const poseNodes = collectPoseNodes(avatar.model);
      actors.set(id, {avatar, saved, poseNodes, pivots: []});
      done += 1;
      report();
    } catch (e) {
      if (!failure) failure = e;
    }
  };

  const queue = [...actorIds];
  const workers = Array.from({length: Math.min(maxConcurrent, queue.length)}, async () => {
    while (queue.length && !failure) {
      const id = queue.shift();
      await loadOne(id);
    }
  });
  await Promise.all(workers);
  const releaseAll = () => {
    for (const entry of actors.values())
      if (entry && entry.avatar) disposeWalkingAvatar(entry.avatar);
    actors.clear();
  };
  if (failure) {
    // Release everything that did load; late arrivals must not leak either.
    releaseAll();
    throw failure;
  }
  if (actors.size !== actorIds.length) {
    releaseAll();
    throw new Error('演员未能全部就绪');
  }

  return {
    get(id) { return actors.get(id)?.avatar || null; },
    ids: [...actors.keys()],
    count: actors.size,
    pose(id, mode) {
      const entry = actors.get(id);
      if (!entry) return;
      const {avatar, saved, poseNodes, pivots} = entry;
      // Undo any previous posing: restore every transform and unwrap pivots.
      for (const [node, t] of saved) {
        node.position.copy(t.position);
        node.quaternion.copy(t.quaternion);
        node.scale.copy(t.scale);
      }
      for (const pivot of pivots) {
        if (pivot.parent) {
          pivot.parent.add(...pivot.children);
          pivot.parent.remove(pivot);
        }
      }
      pivots.length = 0;
      entry.reachPivots = null;
      if (mode === 'standing') return;
      const legAngle = mode === 'carried' ? CARRY_LEG_ANGLE : SEAT_LEG_ANGLE;
      for (const node of poseNodes.legs) {
        const pivot = wrapInPivot(node);
        pivot.rotation.x = legAngle;
        pivots.push(pivot);
      }
      if (mode === 'carried') {
        for (const node of poseNodes.wings) {
          const pivot = wrapInPivot(node);
          pivot.rotation.x = CARRY_WING_ANGLE;
          pivots.push(pivot);
        }
      }
      if (mode === 'seated') avatar.model.position.y -= SEAT_DROP;
      else avatar.model.position.y = saved.get(avatar.model).position.y;
      avatar.player.updateMatrixWorld(true);
    },
    reset() {
      for (const id of actors.keys()) this.pose(id, 'standing');
    },
    // Lift both wings forward (0 = at rest, 1 = reaching out), e.g. toward the bell
    // in the ring beat now that the player sees its own real body. Uses the same
    // pivot mechanism as the poses; the next pose() call unwraps it.
    reachWings(id, amount) {
      const entry = actors.get(id);
      if (!entry) return;
      if (!entry.reachPivots) {
        entry.reachPivots = entry.poseNodes.wings.map(node => {
          const pivot = wrapInPivot(node);
          if (!entry.pivots.includes(pivot)) entry.pivots.push(pivot);
          return pivot;
        });
      }
      for (const pivot of entry.reachPivots) pivot.rotation.x = -amount * 1.1;
    },
    // Clones of the wing meshes for the player's first-person view; shares read-only
    // geometry/material with the owned actor, disposed once with the ActorSet.
    extractWings(id) {
      const entry = actors.get(id);
      if (!entry) return null;
      const group = new THREE.Group();
      group.name = 'pov-wings';
      entry.avatar.model.traverse(o => {
        if (o.isMesh && isWingNode(o.name)) {
          const clone = new THREE.Mesh(o.geometry, o.material);
          clone.name = o.name;
          clone.userData.povWing = true;
          group.add(clone);
        }
      });
      return group.children.length ? group : null;
    },
    // Wing clones in model-local coordinates for the self first-person body proxy.
    // Each clone keeps the source mesh's exact transform relative to the model root
    // (re-derived from matrixWorld every frame by the director, so posed pivots are
    // honored); the caller owns and disposes any material clone it makes.
    buildWingRig(id) {
      const entry = actors.get(id);
      if (!entry) return null;
      const group = new THREE.Group();
      group.name = 'self-wing-rig';
      let count = 0;
      entry.avatar.model.updateWorldMatrix(true, true);
      entry.avatar.model.traverse(o => {
        if (o.isMesh && isWingNode(o.name)) {
          const clone = new THREE.Mesh(o.geometry, o.material);
          clone.name = o.name;
          clone.userData.povWing = true;
          clone.userData.source = o;
          clone.matrixAutoUpdate = false;
          clone.frustumCulled = false;
          group.add(clone);
          count += 1;
        }
      });
      return count ? group : null;
    },
    dispose() {
      releaseAll();
    },
  };
}
