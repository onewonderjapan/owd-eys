// Pure event state machine for the immersion session. No Three.js, DOM or network imports.
// The only clock is tick(dt) driven by the walking RAF; wall-clock time never advances phases.
import {IMMERSION_CONFIG, TOWN_ROUND_CONFIG} from './immersion-config.js';

export const IMMERSION_PHASES = Object.freeze(['roam', 'preparing', 'error', 'ringing', 'reporting', 'seating', 'discussion', 'voting', 'result', 'ejection', 'finished', 'returning']);

const TIMED_NEXT = {ringing: 'seating', reporting: 'seating', seating: 'discussion', discussion: 'voting', result: 'ejection', ejection: 'finished', returning: 'roam'};

function durationOf(phase, style, timings) {
 if (phase === 'discussion') return timings.discussionSegments * timings.discussionSegment;
 if (phase === 'ejection') return timings[style] ?? timings.water;
 // 1.7.0: the discovery performance. The single source is IMMERSION_CONFIG.timings
 // (see the comment there); TOWN_ROUND_CONFIG.reporting is a fallback only.
 if (phase === 'reporting') return timings.reporting ?? TOWN_ROUND_CONFIG.reporting;
 return {ringing: timings.ringing ?? 1.2, seating: timings.seating, result: timings.result, returning: timings.returning}[phase] ?? 0;
}

// Deterministic scripted ballot (1.7.0 rewrite, design-kill-report.md §2 会议名单).
// `present` is the ordered roster minus dead/eliminated, player first.
// selfDemo: every present NPC votes the player, player abstains.
// Normal: the first ceil(n/2) present members vote the target, the last present
// member abstains, and everyone between votes "the next different present NPC"
// (cycling NPCs only, never the player) so the target is always strictly ahead.
// With the full 8 present this is byte-identical to the pre-1.7.0 script.
function computeVotes(present, playerActorId, targetId, selfDemo) {
 const votes = {};
 for (const id of present) {
  if (selfDemo) { votes[id] = id === playerActorId ? null : playerActorId; continue; }
  const index = present.indexOf(id);
  if (index < Math.ceil(present.length / 2)) { votes[id] = targetId; continue; }
  if (index === present.length - 1) { votes[id] = null; continue; }
  let choice = null;
  for (let k = 1; k < present.length && !choice; k++) {
   const candidate = present[1 + ((index - 1 + k) % (present.length - 1))];
   if (candidate !== targetId) choice = candidate;
  }
  votes[id] = choice;
 }
 return votes;
}

export function countVotesFor(votes, targetId) {
 return Object.values(votes || {}).filter(v => v === targetId).length;
}

export function createImmersionState(config = IMMERSION_CONFIG) {
 let phase = 'roam', elapsed = 0, paused = false;
 let actorIds = [], playerActorId = null;
 let entry = 'ring', absent = {dead: [], eliminated: []}, present = [];
 let selectedId = null, targetId = null, style = config.defaultStyle;
 let selfDemo = false, votes = null, speakerIndex = 0, error = null;
 let reducedMotion = false;

 const duration = () => durationOf(phase, style, config.timings);
 const resetSession = () => {
  actorIds = []; playerActorId = null; selectedId = null; targetId = null;
  entry = 'ring'; absent = {dead: [], eliminated: []}; present = [];
  selfDemo = false; votes = null; speakerIndex = 0; error = null; elapsed = 0; paused = false;
 };
 const enter = next => { phase = next; elapsed = 0; speakerIndex = 0; };

 function dispatch(event) {
  if (!event || typeof event !== 'object') return;
  switch (event.type) {
   case 'START': {
    if (phase !== 'roam') return;
    const ids = Array.isArray(event.actorIds) ? event.actorIds : [];
    const player = event.playerActorId ?? ids[0];
    if (ids.length !== config.castSize || new Set(ids).size !== ids.length || ids[0] !== player || !player) {
     error = '演员名单无效：需要8位不重复角色且玩家首席';
     phase = 'error'; elapsed = 0; return;
    }
    // 1.7.0: entry 'ring' (bell/button) or 'report' (corpse discovery); absent
    // lists seat holders that must not take part. Every absent id must sit on
    // the roster and never be the player.
    const wantedEntry = event.entry === 'report' ? 'report' : 'ring';
    const dead = Array.isArray(event.absent?.dead) ? event.absent.dead : [];
    const eliminated = Array.isArray(event.absent?.eliminated) ? event.absent.eliminated : [];
    const absentInvalid = [...dead, ...eliminated].some(id => !ids.includes(id) || id === player)
     || new Set(dead).size !== dead.length || new Set(eliminated).size !== eliminated.length
     || dead.some(id => eliminated.includes(id));
    if (absentInvalid) {
     error = '缺席名单无效：缺席者必须在名单内且不是玩家';
     phase = 'error'; elapsed = 0; return;
    }
    resetSession();
    actorIds = [...ids]; playerActorId = player;
    entry = wantedEntry;
    absent = {dead: [...dead], eliminated: [...eliminated]};
    present = ids.filter(id => !dead.includes(id) && !eliminated.includes(id));
    style = config.styles.includes(event.style) ? event.style : config.defaultStyle;
    reducedMotion = Boolean(event.reducedMotion);
    enter('preparing');
    return;
   }
   case 'READY':
    if (phase !== 'preparing') return;
    enter(entry === 'report' ? 'reporting' : 'ringing');
    return;
   case 'LOAD_FAILED':
    if (phase !== 'preparing') return;
    error = String(event.error || '会议准备失败');
    enter('error');
    return;
   case 'RETRY':
    if (phase !== 'error') return;
    error = null;
    enter('preparing');
    return;
   case 'BEGIN_VOTE':
    if (phase !== 'discussion') return;
    enter('voting');
    return;
   case 'SELECT': {
    if (phase !== 'voting') return;
    const id = event.actorId;
    // 1.7.0: dead/eliminated seats stay empty — only present members can be picked.
    if (!present.includes(id) || id === playerActorId) return;
    selectedId = id; selfDemo = false;
    return;
   }
   case 'SELF_DEMO':
    if (phase !== 'voting') return;
    selectedId = playerActorId; selfDemo = true;
    return;
   case 'SET_STYLE':
    if (phase !== 'discussion' && phase !== 'voting') return;
    if (!config.styles.includes(event.style)) return;
    style = event.style;
    return;
   case 'CONFIRM':
    if (phase !== 'voting' || !selectedId) return;
    targetId = selectedId;
    votes = computeVotes(present, playerActorId, targetId, selfDemo);
    enter('result');
    return;
   case 'SKIP': {
    const skippable = ['ringing', 'reporting', 'seating', 'discussion', 'result', 'ejection'];
    if (!skippable.includes(phase)) return;
    enter(TIMED_NEXT[phase]);
    return;
   }
   case 'REPLAY':
    if (phase !== 'finished') return;
    enter('ejection');
    return;
   case 'RETURN':
    if (phase !== 'finished') return;
    enter('returning');
    return;
   case 'CANCEL':
    if (phase === 'roam') return;
    resetSession();
    phase = 'roam';
    return;
   case 'PAUSE':
    if (phase === 'roam') return;
    paused = true;
    return;
   case 'RESUME':
    paused = false;
    return;
   default:
    return;
  }
 }

 function tick(dt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0 || paused) return;
  elapsed += Math.min(dt, 0.05);
  if (phase === 'discussion') speakerIndex = Math.min(config.timings.discussionSegments - 1, Math.floor(elapsed / config.timings.discussionSegment));
  if (phase === 'returning') { if (elapsed >= duration()) { resetSession(); phase = 'roam'; } return; }
  let guard = 4;
  while (TIMED_NEXT[phase] && elapsed >= duration() && guard-- > 0) enter(TIMED_NEXT[phase]);
 }

 const snapshot = () => ({
  phase, elapsed, paused,
  actorIds: [...actorIds], playerActorId,
  entry, absent: {dead: [...absent.dead], eliminated: [...absent.eliminated]}, present: [...present],
  selectedId, targetId, style, selfDemo,
  votes: votes ? {...votes} : null,
  speakerIndex, error,
  reducedMotion,
  busy: phase !== 'roam',
 });

 return {dispatch, tick, snapshot};
}
