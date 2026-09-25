// 1.7.0 town round (design-kill-report.md): the duck hidden among the townsfolk,
// its kill decisions, the corpse-leg ledger and the meeting bookkeeping.
// Pure logic only — zero Three.js, DOM, network or clock imports. The only time
// that advances anything is tick(dt), and the caller skips it while busy/paused
// (same contract as the walk state machine). Every number comes from
// TOWN_ROUND_CONFIG; nothing is hard-coded here.
import {TOWN_ROUND_CONFIG} from './immersion-config.js';

// Same LCG family as walk-npcs.js / pickSessionSpeeches: one seed replays a run.
const makeRng = seed => {
 let s = (seed * 2654435761) >>> 0;
 return () => {
  s = (Math.imul(s, 1103515245) + 12345) >>> 0;
  return s / 4294967296;
 };
};
const span = (rng, range) => range[0] + rng() * (range[1] - range[0]);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clonePos = p => Array.isArray(p) ? [p[0], p[1]] : [0, 0];

export function createTownRound({config = TOWN_ROUND_CONFIG, playerActorId = null} = {}) {
 let seed = config.seed;
 let rng = makeRng(seed);
 let duckId = null;
 let townsfolk = [];        // ids from the last start(); alive = townsfolk - dead - eliminated
 let dead = [];             // killed this round; outlives the legs (cleared only by nextRound/start)
 let corpses = [];          // legs on the ground: {actor, position:[x,z]} oldest first
 let eliminated = [];       // meeting-ejected ids, this round
 let cooldown = Infinity;   // seconds until the duck may kill again
 let kills = 0;
 let witnessBypass = false; // one-shot: the next canKill ignores witness checks (?round=force-kill)
 let killsHeld = false;     // debug-only hold (?round=force-kill smoke): cooldown frozen, no kills

 const aliveIds = () => townsfolk.filter(id => !dead.includes(id) && !eliminated.includes(id));

 // start(): all townsfolk finished loading this frame. Picks the duck and arms
 // the first-kill cooldown; one seed always replays the same duck and the same
 // cooldown sequence.
 function start(ids) {
  townsfolk = (ids || []).filter(id => id !== playerActorId);
  dead = []; corpses = []; eliminated = []; kills = 0; duckId = null; witnessBypass = false;
  rng = makeRng(seed);
  if (!townsfolk.length) return null;
  duckId = townsfolk[Math.floor(rng() * townsfolk.length)];
  cooldown = span(rng, config.firstKillCooldown);
  return duckId;
 }

 // nextRound(): seed+1, clear the round ledger; the caller repopulates the town
 // and calls start(newIds) once the reload finishes.
 function nextRound() {
  seed += 1;
  dead = []; corpses = []; eliminated = []; kills = 0; duckId = null; cooldown = Infinity;
  witnessBypass = false;
 }

 function tick(dt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return;
  if (killsHeld) return;
  if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
 }

 // ?round=force-kill debug hook: cooldown to zero plus a ONE-SHOT witness
 // bypass for the next canKill. Never touches the seed or the duck.
 function forceKill() {
  cooldown = 0;
  witnessBypass = true;
 }

 // ?round=force-kill debug hook: while held the cooldown does not advance and
 // canKill always says no, so a smoke can walk to the bell without a fresh leg
 // turning E into a report. Touches nothing else (seed, duck, ledger, cooldown
 // value, witness bypass); the hold survives nextRound/start until released.
 function holdKills(on) {
  killsHeld = Boolean(on);
  return killsHeld;
 }

 // Kill eligibility, design §2 刀人资格, every call. Returns the victim id or null.
 // duck: {id, position, paused}; victims: [{id, position}] (no duck, no legs);
 // player: {position, firstPerson, forward:[x,z]}.
 function canKill({duck, victims, player}) {
  if (killsHeld) return null;
  if (!duck || duck.id !== duckId || duck.paused) return null;
  if (cooldown > 0) return null;
  if (!Array.isArray(victims) || !victims.length) return null;
  if (aliveIds().length < 2) return null;                    // 存活镇民（含鸭子）≥ 2
  if (corpses.length >= config.maxCorpses) return null;      // 腿数上限
  // Nearest in-range victim is the candidate target.
  let target = null, best = Infinity;
  for (const v of victims) {
   if (!v || v.id === duck.id) continue;
   const d = dist2(duck.position, v.position);
   if (d <= config.killRange && d < best) { best = d; target = v; }
  }
  if (!target) return null;
  if (!witnessBypass && player && Array.isArray(player.position)) {
   const d = dist2(player.position, target.position);
   // 俯视:5m内即禁止。第一人称:刀点方向与视线点积 < witnessForwardDot 才算
   // 背对(允许);否则视为看见,与俯视同样禁止。
   const dx = target.position[0] - player.position[0], dz = target.position[1] - player.position[1];
   const len = Math.hypot(dx, dz) || 1e-9;
   const f = Array.isArray(player.forward) ? player.forward : [0, 0];
   const fl = Math.hypot(f[0], f[1]) || 1e-9;
   const blind = player.firstPerson && (dx / len) * (f[0] / fl) + (dz / len) * (f[1] / fl) < config.witnessForwardDot;
   if (d < config.witnessDistance && !blind) return null;
  }
  return target.id;
 }

 // The kill animation finished: register the leg and rearm the cooldown.
 // Idempotent per victim — a duplicate call must not redraw the cooldown.
 function recordKill(id, position) {
  if (!townsfolk.includes(id) || dead.includes(id)) return;
  dead.push(id);
  corpses.push({actor: id, position: clonePos(position)});
  kills += 1;
  cooldown = span(rng, config.killCooldown);
  witnessBypass = false;
 }

 // Nearest leg within reportDistance of the player, or null.
 function reportable(playerPos) {
  if (!Array.isArray(playerPos)) return null;
  let best = null, bestD = Infinity;
  for (const c of corpses) {
   const d = dist2(playerPos, c.position);
   if (d <= config.reportDistance && d < bestD) { bestD = d; best = c; }
  }
  return best;
 }

 // Meeting roster: full 8-seat list via rosterFn(playerActorId) plus the absent
 // ledger, filtered to the roster (a dead townsperson is always rostered, but
 // stay defensive — the seats must never name an outsider).
 function meetingStart(rosterFn) {
  const actorIds = rosterFn ? rosterFn(playerActorId) : [];
  const inRoster = ids => ids.filter(id => actorIds.includes(id) && id !== playerActorId);
  return {
   actorIds,
   absent: {
    dead: inRoster(dead),
    eliminated: inRoster(eliminated),
   },
  };
 }

 // Meeting resolved (RETURN, not CANCEL): the legs go with the meeting's end but
 // the killed stay gone this round; the ejected id (or null for selfDemo) decides
 // the outcome. duck-out starts a new round (seed+1, ledger cleared); goose-out
 // keeps it running with the duck's cooldown reset; none only clears the legs.
 function resolveMeeting({ejectedId} = {}) {
  const legsCleared = corpses.length;
  corpses = [];
  if (!ejectedId || !townsfolk.includes(ejectedId) || dead.includes(ejectedId)) {
   return {outcome: 'none', newRound: false, ejectedId: null, cleared: legsCleared};
  }
  if (ejectedId === duckId) {
   nextRound();
   return {outcome: 'duck-out', newRound: true, ejectedId, cleared: legsCleared};
  }
  eliminated.push(ejectedId);
  cooldown = span(rng, config.killCooldown);
  return {outcome: 'goose-out', newRound: false, ejectedId, cleared: legsCleared};
 }

 // 存活镇民 ≤ 1 且无腿可报 → silence, the caller starts a new round.
 function checkSilence() {
  return corpses.length === 0 && aliveIds().length <= 1;
 }

 const state = () => ({
  seed, duck: duckId, duckId,
  corpses: corpses.map(c => ({actor: c.actor, position: [...c.position]})),
  dead: [...dead],
  eliminated: [...eliminated],
  alive: aliveIds(),
  cooldown: cooldown === Infinity ? null : +cooldown.toFixed(3),
  kills,
  maxCorpses: config.maxCorpses,
 });

 return {start, nextRound, tick, canKill, forceKill, holdKills, killsHeld: () => killsHeld, recordKill, reportable, meetingStart, resolveMeeting, checkSilence,
  duckId: () => duckId, alive: aliveIds, corpses: () => corpses.map(c => ({actor: c.actor, position: [...c.position]})),
  eliminated: () => [...eliminated], state};
}
