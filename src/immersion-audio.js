// Local Web Audio synthesis for the immersion cues. One shared AudioContext, unlocked
// from a user gesture; every failure stays silent instead of blocking the experience.
export function createImmersionAudio() {
 let context = null, master = null;
 let muted = false;
 const live = new Set();

 function ensureContext() {
  if (context) return context;
  try {
   context = new (window.AudioContext || window.webkitAudioContext)();
   master = context.createGain();
   master.gain.value = muted ? 0 : 1;
   master.connect(context.destination);
  } catch {
   context = null;
  }
  return context;
 }

 function track(nodes) {
  for (const n of nodes) live.add(n);
  const last = nodes[nodes.length - 1];
  setTimeout(() => { for (const n of nodes) live.delete(n); }, 8000);
  return last;
 }

 function env(gainNode, t0, peak, attack, decay) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  g.exponentialRampToValueAtTime(0.0002, t0 + attack + decay);
 }

 function tone(type, freq, t0, peak, attack, decay, detune = 0) {
  const osc = context.createOscillator(), gain = context.createGain();
  osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
  env(gain, t0, peak, attack, decay);
  osc.connect(gain).connect(master);
  osc.start(t0); osc.stop(t0 + attack + decay + 0.05);
  return [osc, gain];
 }

 function noise(t0, duration, peak, filterType, f0, f1) {
  const frames = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const source = context.createBufferSource(); source.buffer = buffer;
  const filter = context.createBiquadFilter(); filter.type = filterType;
  filter.frequency.setValueAtTime(f0, t0);
  if (f1 !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + duration);
  const gain = context.createGain();
  env(gain, t0, peak, 0.012, duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(t0); source.stop(t0 + duration + 0.05);
  return [source, filter, gain];
 }

 function play(cue) {
  if (muted) return;
  const ctx = ensureContext();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.01;
  try {
   switch (cue) {
    case 'bell': {
     track(tone('sine', 830, t0, 0.5, 0.008, 1.1));
     track(tone('sine', 1244, t0, 0.22, 0.008, 0.8, 6));
     track(tone('triangle', 622, t0, 0.16, 0.01, 0.5, -4));
     track(noise(t0, 0.05, 0.2, 'highpass', 2500));
     break;
    }
    case 'chair':
     track(noise(t0, 0.16, 0.18, 'lowpass', 900, 300));
     break;
    case 'splash':
     track(noise(t0, 0.5, 0.5, 'lowpass', 4200, 300));
     track(noise(t0 + 0.05, 0.35, 0.25, 'bandpass', 900));
     break;
    case 'underwater':
     for (let i = 0; i < 4; i++)
      track(tone('sine', 260 + i * 90, t0 + i * 0.42, 0.08, 0.02, 0.16));
     break;
    case 'whoosh':
     track(noise(t0, 0.55, 0.3, 'bandpass', 500, 1600));
     break;
    case 'fire':
     for (let i = 0; i < 7; i++)
      track(noise(t0 + i * 0.16 + Math.random() * 0.05, 0.09, 0.14, 'bandpass', 1400 + Math.random() * 900));
     track(noise(t0, 1.6, 0.1, 'lowpass', 500, 240));
     break;
    default:
     break;
   }
  } catch {
   // Audio must never break the experience.
  }
 }

 return {
  unlock() {
   const ctx = ensureContext();
   if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  },
  play,
  setMuted(value) {
   muted = Boolean(value);
   if (master) master.gain.value = muted ? 0 : 1;
  },
  isMuted() { return muted; },
  pause() {
   if (context && context.state === 'running') context.suspend().catch(() => {});
  },
  resume() {
   // muting is gain-based; a suspended context must always resume or later
   // cues stay silent even after unmute
   if (context && context.state === 'suspended') context.resume().catch(() => {});
  },
  stop() {
   for (const node of live) {
    try { if (node.stop) node.stop(); } catch { /* already stopped */ }
    try { node.disconnect(); } catch { /* already disconnected */ }
   }
   live.clear();
  },
  dispose() {
   this.stop();
   if (context) { context.close().catch(() => {}); context = null; master = null; }
  },
 };
}
