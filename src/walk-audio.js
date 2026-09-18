// Walk ambience + footsteps, local Web Audio synthesis only (no audio assets).
// Same house rules as immersion-audio.js: one lazy shared context, unlocked from
// the walk-enter gesture; every failure stays silent instead of blocking the walk.
const STORAGE_KEY = 'goose.walk.audio';

export function createWalkAudio() {
 let context = null, master = null, ambience = null;
 let muted = false, running = false, steps = 0;
 let stride = 0, suspendedForPause = false, ducked = false;
 try { muted = localStorage.getItem(STORAGE_KEY) === 'off'; } catch { /* private mode */ }

 // Master gain: mute wins, then ducking (meeting/ejection performances) sits
 // the ambience and footfalls at a low bed level instead of cutting them.
 const DUCK_GAIN = 0.18;
 function applyGain() {
  if (!master || !context) return;
  const target = muted ? 0 : (ducked ? DUCK_GAIN : 1);
  if (context.state === 'running') {
   try { master.gain.setTargetAtTime(target, context.currentTime, 0.08); return; }
   catch { /* fall through to direct set */ }
  }
  master.gain.value = target;
 }

 function ensureContext() {
  if (context) return context;
  try {
   context = new (window.AudioContext || window.webkitAudioContext)();
   master = context.createGain();
   master.gain.value = muted ? 0 : (ducked ? DUCK_GAIN : 1);
   master.connect(context.destination);
  } catch {
   context = null;
  }
  return context;
 }

 // Looping filtered noise with a slow filter drift reads as distant wind/water.
 function startAmbience() {
  const ctx = context;
  if (ambience) return;
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer; source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 380; filter.Q.value = 0.4;
  const drift = ctx.createOscillator(), driftGain = ctx.createGain();
  drift.frequency.value = 0.07; driftGain.gain.value = 90; // 290..470 Hz slow sweep
  drift.connect(driftGain).connect(filter.frequency);
  const gain = ctx.createGain();
  gain.gain.value = 0.035;
  source.connect(filter).connect(gain).connect(master);
  source.start();
  drift.start();
  ambience = {source, drift, gain};
 }

 function stopAmbience() {
  if (!ambience) return;
  try {
   ambience.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.15);
   const a = ambience;
   setTimeout(() => {
    try { a.source.stop(); a.drift.stop(); } catch { /* already stopped */ }
   }, 500);
  } catch { /* context gone */ }
  ambience = null;
 }

 // One footfall: short bandpass noise burst, pitch/volume jitter to avoid a
 // machine-gun loop. Same numeric rhythm as the visual bob (s.distance*15).
 function footfall() {
  if (muted || !context || context.state !== 'running') return;
  try {
   const t0 = context.currentTime + 0.005;
   const duration = 0.09;
   const frames = Math.max(1, Math.floor(context.sampleRate * duration));
   const buffer = context.createBuffer(1, frames, context.sampleRate);
   const data = buffer.getChannelData(0);
   for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
   const source = context.createBufferSource(); source.buffer = buffer;
   const filter = context.createBiquadFilter();
   filter.type = 'bandpass'; filter.Q.value = 0.9;
   const f0 = 700 * (0.92 + Math.random() * 0.16);
   filter.frequency.setValueAtTime(f0, t0);
   filter.frequency.exponentialRampToValueAtTime(250, t0 + duration);
   const gain = context.createGain();
   const peak = 0.12 * (0.9 + Math.random() * 0.2);
   gain.gain.setValueAtTime(0.0001, t0);
   gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
   gain.gain.exponentialRampToValueAtTime(0.0002, t0 + duration);
   source.connect(filter).connect(gain).connect(master);
   source.start(t0); source.stop(t0 + duration + 0.05);
   steps += 1;
  } catch { /* audio must never break the walk */ }
 }

 return {
  // Called from start(): entering walk is the user gesture that unlocks audio.
  start() {
   const ctx = ensureContext();
   if (!ctx) return;
   if (ctx.state === 'suspended') ctx.resume().catch(() => {});
   running = true;
   if (!muted) startAmbience();
  },
  // Called when leaving walk mode.
  stop() {
   running = false;
   if (context) stopAmbience();
   if (context && context.state === 'running') context.suspend().catch(() => {});
  },
  // Per-frame hook: accumulate travelled distance, emit a footfall per stride.
  frame(dt, moving, distance) {
   if (!running || !moving) { stride = 0; return; }
   void dt;
   if (stride === 0) { stride = distance; footfall(); return; }
   if (distance - stride >= 0.62) { stride = distance; footfall(); }
  },
  setMuted(value) {
   muted = Boolean(value);
   try { localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch { /* private mode */ }
   applyGain();
   if (running && context && !suspendedForPause) {
    if (muted) stopAmbience();
    else {
     if (context.state === 'suspended') context.resume().catch(() => {});
     startAmbience();
    }
   }
  },
  isMuted() { return muted; },
  // Busy (meeting/ejection performance) beds the walk audio down instead of
  // muting it; full level returns when the performance ends.
  setDucked(value) {
   const next = Boolean(value);
   if (next === ducked) return;
   ducked = next;
   applyGain();
  },
  pause() {
   suspendedForPause = true;
   if (context && context.state === 'running') context.suspend().catch(() => {});
  },
  resume() {
   suspendedForPause = false;
   if (context && context.state === 'suspended' && running) context.resume().catch(() => {});
  },
  state() {
   return {on: running, muted, ducked, steps, ambience: Boolean(ambience)};
  },
 };
}
