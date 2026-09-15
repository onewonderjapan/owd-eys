// Frame-rate probe for the ejection procession beats. Real entry -> keyboard walk to
// the bell -> self-demo ejection -> sample RAF fps inside each beat window.
// Usage: node scripts/immersion/perf_probe.mjs [url] [fire|water] [actor]
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWalker} from './walk_harness.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const branch = process.argv[3] || 'fire';
const actor = process.argv[4] || 'cast.14';

const {createNavigation} = await import('../../src/map-walk-simulation.js');
const layout = JSON.parse(readFileSync(new URL('../../src/map-scene.json', import.meta.url), 'utf8'));
const props = JSON.parse(readFileSync(new URL('../../src/map-walk-props.json', import.meta.url), 'utf8'));
const nav = createNavigation(layout.layout, props);
const {walkToBell} = createWalker(nav);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: {width: 1280, height: 800}, hasTouch: true,
  deviceScaleFactor: Number(process.env.DSF || 1.35), // emulate Windows-scaled displays
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

await page.goto(`${url}?actor=${actor}`, {waitUntil: 'networkidle'});
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return {renderer: 'no-webgl'};
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    dpr: devicePixelRatio,
  };
});
console.log('gpu:', JSON.stringify(gpu));
await page.click('#walk-enter');
await page.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
await page.waitForTimeout(1500);

// Roam sampling: this is the "as soon as you enter the game" walking state.
await page.evaluate(() => {
  window.__fps = {frames: 0, worst: 0, deltas: [], last: performance.now()};
  const loop = () => {
    const t = performance.now(), d = t - window.__fps.last;
    window.__fps.last = t; window.__fps.frames += 1;
    if (d > window.__fps.worst) window.__fps.worst = d;
    if (window.__fps.deltas.length < 8000) window.__fps.deltas.push(d);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
{
  const s = await page.evaluate(async span => {
    const f0 = window.__fps.frames, d0 = window.__fps.deltas.length, t0 = performance.now();
    await new Promise(res => setTimeout(res, span));
    const deltas = window.__fps.deltas.slice(d0).sort((a, b) => a - b);
    const p = q => deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))] : 0;
    return {
      fps: (window.__fps.frames - f0) / ((performance.now() - t0) / 1000),
      p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), worst: +Math.max(...deltas, 0).toFixed(1),
      draws: window.eys.rendererInfo().calls, tris: window.eys.rendererInfo().triangles, pr: window.eys.rendererInfo().pixelRatio,
    };
  }, 2000);
  console.log(`roam: ${s.fps.toFixed(1)} fps | frame ${s.p50}/${s.p95}/${s.worst} ms | draws=${s.draws} tris=${s.tris} pr=${s.pr}`);
}
const spawn = await page.evaluate(() => window.eys.state().walk.position);
const arrived = await walkToBell(page, spawn);
console.log('walk arrived:', arrived);

await page.keyboard.press('KeyE');
await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'voting', {timeout: 60000}).catch(() => {});
await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
await page.evaluate(b => document.querySelector(`#immersion-style-${b}`)?.click(), branch);
await page.waitForFunction(() => !document.querySelector('#immersion-confirm')?.disabled, {timeout: 5000}).catch(() => {});
await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
const inEjection = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ejection', {timeout: 15000}).then(() => true).catch(() => false);
console.log('in ejection:', inEjection);

await page.evaluate(() => {
  window.__fps = {frames: 0, worst: 0, deltas: [], last: performance.now()};
  const loop = () => {
    const t = performance.now(), d = t - window.__fps.last;
    window.__fps.last = t; window.__fps.frames += 1;
    if (d > window.__fps.worst) window.__fps.worst = d;
    if (window.__fps.deltas.length < 8000) window.__fps.deltas.push(d);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const beats = branch === 'water'
  ? [['walk', 0.3, 900], ['lift', 1.9, 700], ['carry', 3.2, 800], ['pause', 4.55, 400], ['drop', 5.15, 450], ['sink', 6.3, 1000], ['sink-late', 8.0, 800]]
  : [['walk', 0.3, 700], ['lift', 1.7, 700], ['carry', 3.0, 500], ['toss', 4.0, 500], ['settle', 5.2, 800]];
for (const [label, mark, span] of beats) {
  await page.waitForFunction(m => window.eys?.state?.().walk?.immersion?.elapsed >= m, mark, {timeout: 30000}).catch(() => {});
  const s = await page.evaluate(async span => {
    const f0 = window.__fps.frames, d0 = window.__fps.deltas.length, t0 = performance.now();
    await new Promise(res => setTimeout(res, span));
    const deltas = window.__fps.deltas.slice(d0).sort((a, b) => a - b);
    const p = q => deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))] : 0;
    return {
      fps: (window.__fps.frames - f0) / ((performance.now() - t0) / 1000),
      p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), worst: +Math.max(...deltas, 0).toFixed(1),
      draws: window.eys.rendererInfo().calls, tris: window.eys.rendererInfo().triangles, pr: window.eys.rendererInfo().pixelRatio,
    };
  }, span);
  console.log(`${label}: ${s.fps.toFixed(1)} fps | frame ${s.p50}/${s.p95}/${s.worst} ms | draws=${s.draws} tris=${s.tris} pr=${s.pr}`);
}
console.log('pageErrors:', errors.length, errors.slice(0, 3));
await browser.close();
