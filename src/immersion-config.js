// Single source of truth for the POV immersion feature: sizes, timings, cast, ejection styles.
// All ground coordinates use the map's Three X/Z convention (Y up), never Blender axes.
export const IMMERSION_CONFIG = Object.freeze({
 mapId: 'map_reference_v2',
 bell: Object.freeze({
  base: Object.freeze([9.70, 0.338, -7.65]),
  interaction: Object.freeze([9.12, -7.56]),
  radius: 0.16,
  totalHeight: 0.80,
  height: Object.freeze([0.338, 1.138]),
  triggerDistance: 0.95,
  room: '04',
  proxyName: 'immersion-bell',
  ringDuration: 1.2,
 }),
 // Second meeting entry: the red emergency button on the square table at the
 // center of the circular plaza (GLB mesh Plaza_|_circular_paving003_6).
 // The table is ~1.5 wide, so stand beside it; no room gate (plaza zone).
 button: Object.freeze({
  interaction: Object.freeze([-0.72, -1.98]),
  triggerDistance: 1.6,
  room: null,
 }),
 // B7 light-flicker mood event: approaching the emergency-button table dips the
 // town lights twice (slow cosine, never a strobe) then restores them exactly.
 flicker: Object.freeze({
  radius: 2.1,        // trigger distance from the button table
  rearmGap: 1.0,      // must leave radius+rearmGap before re-arming
  duration: 2.2,      // seconds per trigger
  dips: 2,            // gentle bright-dim cycles inside the window
  floor: 0.55,        // dimmest intensity factor
  reducedFloor: 0.7,  // reduced-motion: one calm dip instead of oscillation
 }),
 meeting: Object.freeze({
  tableRadius: 1.10,
  tableTopY: 0.72,
  tableThickness: 0.09,
  seatRadius: 1.48,
  seatY: 0.30,
  seatCount: 8,
  camera: Object.freeze({position: Object.freeze([0, 1.05, 1.62]), lookY: 0.85, fov: 78}),
  pitchRange: Object.freeze([-0.70, 0.55]),
 }),
 timings: Object.freeze({
  seating: 0.8,
  returning: 0.25,
  discussionSegment: 2.6,
  discussionSegments: 3,
  result: 1.2,
  // User-scripted ejection timeline (2026-09-15 feedback): the cast walks up, lifts
  // the target, carries it, holds at the edge, drops it, and the sink is watchable.
  // water 9.5s = walk 1.7 + lift 1.2 + carry 1.6 + pause 0.6 + drop 0.8 + sink; the
  // underwater window keeps >=3s of observable sinking (eye crosses ~6.0s).
  // fire 7.5s = walk 1.7 + lift 1.2 + carry 1.4 + toss 1.0 + settle.
  water: 9.5,
  fire: 7.5,
  space: 8.0,
  quicksand: 8.5,
  chandelier: 6.5,
  boulder: 6.0,
  bridge: 8.5,
  flush: 6.5,
 }),
 // Discussion lines: the original scripted three stay first for continuity; each
 // session deterministically picks three distinct lines via pickSessionSpeeches.
 speechPool: Object.freeze([
  '我刚才在码头。', '先听听大家怎么说。', '那我们投票吧。',
  '铃响之前我就在这附近。', '谁最后见过那只灰鹅？', '先别急着投，听听下一句。',
  '我什么都没看见，真的。', '按规矩来，一票一票投。',
 ]),
 rosterCandidates: Object.freeze(['cast.02', 'cast.03', 'cast.04', 'cast.05', 'cast.07', 'cast.08', 'cast.09', 'cast.10']),
 castSize: 8,
 maxConcurrentActorLoads: 2,
 styles: Object.freeze(['water', 'fire', 'space', 'quicksand', 'chandelier', 'boulder', 'bridge', 'flush']),
 styleLabels: Object.freeze({water: '沉水', fire: '火堆', space: '星空', quicksand: '流沙', chandelier: '吊灯', boulder: '巨石', bridge: '断桥', flush: '冲水'}),
 defaultStyle: 'water',
 underwaterPitchRange: Object.freeze([-1.45, 1.10]),
 chainLinks: 28,
 limits: Object.freeze({flameRings: 9, flameLayers: 2, bubbles: 6, escorts: 2}),
});

// B4 walk-NPC townsfolk: roaming extras for free roam. Speech lines are local
// ambient chatter and must never overlap the meeting speechPool above.
export const WALK_NPC_CONFIG = Object.freeze({
 count: 4,            // desktop townsfolk
 mobileCount: 2,      // phone townsfolk
 speed: 1.4,          // stroll speed, units/second (slower than the player's 2.35)
 pauseRange: Object.freeze([1.5, 4.0]),
 avoidPlayerRadius: 0.9,  // wait in place instead of shoving through the player
 spawnMinDistance: 3.0,
 bubble: Object.freeze({
  duration: 2.8,
  cooldown: Object.freeze([6, 14]),
  pool: Object.freeze([
   '今天广场的风真舒服。', '码头的木箱又堆高了。', '酒馆说晚上有新烤饼。',
   '礼拜堂的钟声真稳。', '河边的芦苇黄了一半。', '散步有助于思考人生。',
   '理发店的椅子总是空的。', '仓库的木桶又滚到路中间了。',
  ]),
 }),
});

// Player always sits at seat 0; the seven NPCs come from the fixed candidate order.
export function selectRoster(playerActorId) {
 if (typeof playerActorId !== 'string' || !playerActorId) throw new Error('缺少玩家角色ID');
 const others = IMMERSION_CONFIG.rosterCandidates.filter(id => id !== playerActorId).slice(0, IMMERSION_CONFIG.castSize - 1);
 if (others.length < IMMERSION_CONFIG.castSize - 1) throw new Error('NPC候选不足');
 return [playerActorId, ...others];
}

// Runtime-only collision proxy for the bell stand; never written back into map-walk-props.json.
export function createBellProxy() {
 const {base, radius, proxyName, room, height} = IMMERSION_CONFIG.bell;
 const [x, , z] = base, poly = [];
 for (let i = 0; i < 12; i++) {
  const a = i * Math.PI * 2 / 12;
  poly.push([x + Math.cos(a) * radius, z + Math.sin(a) * radius]);
 }
 return {name: proxyName, room, height: [...height], poly};
}

export const seatTransform = i => {
 const angle = i * Math.PI * 2 / IMMERSION_CONFIG.meeting.seatCount;
 return {angle, position: [Math.sin(angle) * IMMERSION_CONFIG.meeting.seatRadius, 0, Math.cos(angle) * IMMERSION_CONFIG.meeting.seatRadius]};
};

// Deterministic three-line pick for one session: same seed -> same lines, no
// repeats, always drawn from speechPool (LCG so tests can reproduce exactly).
export function pickSessionSpeeches(seed) {
 const pool = IMMERSION_CONFIG.speechPool;
 let s = ((seed + 1) * 2654435761) >>> 0;
 const picks = [], used = new Set();
 while (picks.length < 3 && used.size < pool.length) {
  s = (Math.imul(s, 1103515245) + 12345) >>> 0;
  const idx = s % pool.length;
  if (!used.has(idx)) { used.add(idx); picks.push(pool[idx]); }
 }
 return picks;
}
