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
  underwaterWindow: Object.freeze([6.0, 9.1]),
  fireWindow: Object.freeze([4.5, 7.3]),
 }),
 speeches: Object.freeze(['我刚才在码头。', '先听听大家怎么说。', '那我们投票吧。']),
 rosterCandidates: Object.freeze(['cast.02', 'cast.03', 'cast.04', 'cast.05', 'cast.07', 'cast.08', 'cast.09', 'cast.10']),
 castSize: 8,
 maxConcurrentActorLoads: 2,
 styles: Object.freeze(['water', 'fire']),
 defaultStyle: 'water',
 underwaterPitchRange: Object.freeze([-1.45, 1.10]),
 chainLinks: Object.freeze({min: 24, max: 32}),
 limits: Object.freeze({flames: 24, bubbles: 8, escorts: 2}),
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
