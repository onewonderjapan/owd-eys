// Performance gate (2026-09-23 night, F2 — PLAN.md phase B leftover, REVIEW P2-7).
// Real entry -> townsfolk `loaded` reaches the configured count -> 2s warmup -> one
// in-page requestAnimationFrame recorder sampled for 6s of roam (fetched with a single
// page.evaluate) -> water and fire self-demo ejections with per-beat fps sampling
// (beat windows borrowed from scripts/immersion/perf_probe.mjs).
//
// Headless here is software rendering, so ABSOLUTE fps is meaningless. The gate is
// relative + disaster thresholds only:
//   roam worst frame  max <= 500ms            (no catastrophic stall)
//   roam jitter       p95 <= 4 x median       (catches periodic hitches)
//   ejection beats    min fps >= 50% of the roam median fps
// Writes reports/local/perf.json; scripts/publish.py requires it to be passed and
// hashed against the current build.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createWalker} from './immersion/walk_harness.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const {WALK_NPC_CONFIG} = await import('../src/immersion-config.js');

const {createNavigation} = await import('../src/map-walk-simulation.js');
const layout = JSON.parse(readFileSync(new URL('../src/map-scene.json', import.meta.url), 'utf8'));
const props = JSON.parse(readFileSync(new URL('../src/map-walk-props.json', import.meta.url), 'utf8'));
const nav = createNavigation(layout.layout, props);
const {walkToBell} = createWalker(nav);

const ROAM_SAMPLE_MS = 6000, WARMUP_MS = 2000;
// fps over one beat window, sampled the same way perf_probe does it.
const BEATS = {
 water: [['walk', 0.3, 900], ['lift', 1.9, 700], ['carry', 3.2, 800], ['pause', 4.55, 400], ['drop', 5.15, 450], ['sink', 6.3, 1000], ['sink-late', 8.0, 800]],
 fire: [['walk', 0.3, 700], ['lift', 1.7, 700], ['carry', 3.0, 500], ['toss', 4.0, 500], ['settle', 5.2, 800]],
};

const stats = deltas => {
 const sorted = [...deltas].sort((a, b) => a - b);
 const pick = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
 const median = pick(0.5);
 return {median, p95: pick(0.95), max: sorted.length ? sorted[sorted.length - 1] : 0, frames: sorted.length};
};
// In-page recorder: installs a single RAF loop (repeat calls only reset the window —
// a second loop would push zero deltas into the same buffer and poison the median),
// later slices the deltas for a window.
const installRecorder = page => page.evaluate(() => {
 if (!window.__perfGateLoop) {
  window.__perfGateLoop = true;
  window.__perfGateLoopFn = () => {
   const t = performance.now(), d = t - window.__perfGate.last;
   window.__perfGate.last = t;
   window.__perfGate.frames += 1;
   if (window.__perfGate.deltas.length < 20000) window.__perfGate.deltas.push(d);
   requestAnimationFrame(window.__perfGateLoopFn);
  };
  window.__perfGate = {frames: 0, deltas: [], last: performance.now()};
  requestAnimationFrame(window.__perfGateLoopFn);
  return;
 }
 window.__perfGate = {frames: 0, deltas: [], last: performance.now()};
});
const sampleWindow = (page, span) => page.evaluate(async ms => {
 const d0 = window.__perfGate.deltas.length;
 await new Promise(res => setTimeout(res, ms));
 return window.__perfGate.deltas.slice(d0);
}, span);
const runEjection = async (page, branch) => {
 await page.keyboard.press('KeyE');
 await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'voting', null, {timeout: 60000}).catch(() => {});
 await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
 await page.evaluate(b => document.querySelector(`#immersion-style-${b}`)?.click(), branch);
 await page.waitForFunction(() => !document.querySelector('#immersion-confirm')?.disabled, null, {timeout: 5000}).catch(() => {});
 await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
 const inEjection = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ejection', null, {timeout: 15000}).then(() => true).catch(() => false);
 if (!inEjection) throw new Error(`ejection phase not reached for ${branch}`);
 await installRecorder(page);
 const beats = {};
 let minFps = Infinity;
 for (const [label, mark, span] of BEATS[branch]) {
  await page.waitForFunction(m => window.eys?.state?.().walk?.immersion?.elapsed >= m, mark, {timeout: 30000}).catch(() => {});
  const deltas = await sampleWindow(page, span);
  const s = stats(deltas);
  beats[label] = {fps: s.median ? +(1000 / s.median).toFixed(2) : 0, median: +s.median.toFixed(1), max: +s.max.toFixed(1), frames: s.frames};
  if (beats[label].fps < minFps) minFps = beats[label].fps;
 }
 return {minFps: +minFps.toFixed(2), beats};
};
const openSession = async browser => {
 const page = await browser.newPage({viewport: {width: 1440, height: 960}});
 page.on('pageerror', e => { throw new Error('pageerror: ' + e.message); });
 await page.goto(new URL('?actor=cast.10', url).href, {waitUntil: 'networkidle'});
 await page.locator('#walk-enter').click();
 await page.waitForFunction(() => window.eys?.state?.().walk?.active, null, {timeout: 90000});
 // townsfolk must be at full strength before any sampling means anything
 const npcs = await page.waitForFunction(expected => {
  const n = window.eys?.state?.().walk?.npcs;
  return n && n.loaded >= expected ? {loaded: n.loaded, hidden: n.hidden} : false;
 }, WALK_NPC_CONFIG.count, {timeout: 60000}).then(r => r.jsonValue()).catch(() => null);
 if (!npcs) throw new Error(`townsfolk never reached loaded >= ${WALK_NPC_CONFIG.count}`);
 return {page, npcs};
};

const browser = await chromium.launch({
 executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 headless: true, args: ['--enable-unsafe-swiftshader'],
});
let report = {passed: false, url, build_sha256: createHash('sha256').update(await fs.readFile('reports/build.json')).digest('hex'), reason: 'incomplete'};
try {
 // Session 1: roam sample + water ejection. Session 2: fresh page for fire.
 const {page, npcs} = await openSession(browser);
 await page.waitForTimeout(WARMUP_MS);
 await installRecorder(page);
 const roamDeltas = await sampleWindow(page, ROAM_SAMPLE_MS);
 const roam = stats(roamDeltas);
 await installRecorder(page); // restart the window so ejection beats measure only themselves
 const spawn = await page.evaluate(() => window.eys.state().walk.position);
 if (!await walkToBell(page, spawn)) throw new Error('walk to bell failed');
 const water = await runEjection(page, 'water');
 await page.close();

 const firePage = await openSession(browser).then(s => s.page);
 const spawn2 = await firePage.evaluate(() => window.eys.state().walk.position);
 if (!await walkToBell(firePage, spawn2)) throw new Error('walk to bell failed (fire session)');
 const fire = await runEjection(firePage, 'fire');
 await firePage.close();

 const roamMedianFps = 1000 / roam.median;
 const gates = {
  roamMaxOk: roam.max <= 500,
  roamJitterOk: roam.p95 <= 4 * roam.median,
  waterFpsOk: water.minFps >= 0.5 * roamMedianFps,
  fireFpsOk: fire.minFps >= 0.5 * roamMedianFps,
 };
 report = {
  passed: Object.values(gates).every(Boolean),
  build_sha256: report.build_sha256, url,
  roam: {median: +roam.median.toFixed(1), p95: +roam.p95.toFixed(1), max: +roam.max.toFixed(1), frames: roam.frames},
  ejection: {water, fire},
  roam_median_fps: +roamMedianFps.toFixed(2), npcs, gates,
  thresholds: {roamMaxMs: 500, jitterRatio: 4, ejectionFpsRatio: 0.5},
  sampled_at: new Date().toISOString(),
 };
} catch (e) {
 report = {...report, reason: String(e && e.message || e).slice(0, 300)};
} finally {
 await browser.close();
 await fs.mkdir('reports/local', {recursive: true});
 await fs.writeFile('reports/local/perf.json', JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify({passed: report.passed, roam: report.roam, water: report.ejection?.water?.minFps, fire: report.ejection?.fire?.minFps, gates: report.gates, reason: report.reason}));
}
if (!report.passed) process.exit(1);
console.log('EYS_PERF_PASS');
