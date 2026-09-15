// Playwright smoke for the POV immersion feature. Starts from the real character
// roster, walks to the courthouse bell with real keyboard input along a nav-computed
// path, then drives the meeting/ejection flows in one page session.
// Usage: node scripts/smoke-immersion.mjs [url] [label]
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const label = process.argv[3] || 'immersion';

const simModule = await import('../../src/map-walk-simulation.js').catch(() => ({}));
const {createNavigation} = simModule;
const moveTwin = simModule.moveCircle || ((p, d) => [p[0] + d[0], p[1] + d[1]]);
let nav = null;
try {
  const layout = JSON.parse(readFileSync(new URL('../../src/map-scene.json', import.meta.url), 'utf8'));
  const props = JSON.parse(readFileSync(new URL('../../src/map-walk-props.json', import.meta.url), 'utf8'));
  nav = createNavigation(layout.layout, props);
} catch { /* navigation-assisted pathing unavailable; fallback to manual waypoints */ }

function lineOfSight(a, b, radius = 0.3) {
  if (!nav) return false;
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (nav.collision([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], radius)) return false;
  }
  return true;
}

function findPath(from, to, step = 0.22) {
  if (!nav) return null;
  const key = p => `${Math.round(p[0] / step)},${Math.round(p[1] / step)}`;
  const start = [...from], goal = [...to];
  const open = new Map([[key(start), {p: start, g: 0, f: Math.hypot(goal[0] - start[0], goal[1] - start[1]), parent: null}]]);
  const closed = new Set();
  let best = null, bestDist = Infinity;
  while (open.size) {
    let currentKey = null, currentNode = null;
    for (const [k, node] of open) if (!currentNode || node.f < currentNode.f) { currentNode = node; currentKey = k; }
    open.delete(currentKey);
    closed.add(currentKey);
    const d = Math.hypot(goal[0] - currentNode.p[0], goal[1] - currentNode.p[1]);
    if (d < bestDist) { bestDist = d; best = currentNode; }
    if (d < 0.4) { best = currentNode; break; }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const np = [currentNode.p[0] + dx * step, currentNode.p[1] + dz * step];
      const k = key(np);
      if (closed.has(k) || nav.collision(np, 0.26)) continue;
      const g = currentNode.g + Math.hypot(dx, dz);
      const next = open.get(k);
      if (!next || g < next.g)
        open.set(k, {p: np, g, f: g + Math.hypot(goal[0] - np[0], goal[1] - np[1]), parent: currentNode});
    }
    if (open.size > 60000) break;
  }
  const raw = [];
  for (let node = best; node; node = node.parent) raw.unshift(node.p);
  if (raw.length < 2) return null;
  // String-pull: keep only turns, ensuring generous clearance for the walker radius.
  const smoothed = [raw[0]];
  let anchor = 0;
  for (let i = 2; i < raw.length; i++) {
    if (!lineOfSight(raw[anchor], raw[i])) {
      smoothed.push(raw[i - 1]);
      anchor = i - 1;
    }
  }
  smoothed.push(raw[raw.length - 1]);
  return smoothed;
}

const report = {capturedAt: new Date().toISOString(), actor: 'cast.14', samples: [], schema: 1, url, label, passed: false, version: null, checks: [], errors: [], screenshots: []};
const check = (name, passed, detail = '') => {
  report.checks.push({name, passed: Boolean(passed), detail: String(detail).slice(0, 400)});
  if (!passed) report.errors.push(`${name}: ${detail}`);
};

const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader']});
try {
  // Small viewport while software-rendering the walk (RAF-bound dt), full desktop for shots.
  // MOBILE=1 keeps a phone portrait viewport through the whole chain (A9).
  const MOBILE = process.env.MOBILE === '1';
  const walkViewport = {width: 720, height: 480};
  const finalViewport = MOBILE ? {width: 390, height: 844} : {width: 1280, height: 800};
  const shotPrefix = MOBILE ? 'mobile-' : '';
  const page = await browser.newPage({viewport: walkViewport});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push((e && e.stack) ? e.stack.slice(0, 800) : String(e)));
  const actorParam = 'cast.14';
  await page.goto(url + (actorParam ? `?actor=${actorParam}` : ''), {waitUntil: 'networkidle'});
  if (!actorParam) await page.click('#character-grid button:nth-child(3)');
  await page.click('#walk-enter');
  await page.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
  await page.waitForTimeout(2500);
  const walkState = await page.evaluate(() => window.eys.state().walk);
  check('walk: 漫游激活', Boolean(walkState?.active), JSON.stringify(walkState?.position));
  check('props: 道具库就绪', walkState?.props?.ready === true, JSON.stringify(walkState?.props));

  const target = [9.12, -7.56];
  const spawn = walkState.position;
  // BFS to the chapel square, then a hand-laid tail through the courthouse door's
  // wide-clearance channel (the doorway slants, so keep >=0.4 from both jambs).
  const route = findPath(spawn, [8.7, -4.6]);
  if (Array.isArray(route)) route.push([8.75, -5.1], [8.95, -5.9], [9.1, -6.5], [9.2, -6.95], target);
  check('nav: 计算出可通行路径', Array.isArray(route) && route.length > 2, route ? `${route.length} waypoints` : 'no path');

  // Drive with real keyboard input toward successive waypoints.
  let arrived = false;
  if (route && moveTwin) {
    // Dominant-axis only: deterministic polyline tracking, no diagonal corner cutting.
    const keysFor = (dx, dz) => {
      if (Math.abs(dx) < 0.06 && Math.abs(dz) < 0.06) return [];
      if (Math.abs(dx) > Math.abs(dz)) return [dx > 0 ? 'KeyD' : 'KeyA'];
      return [dz > 0 ? 'KeyS' : 'KeyW'];
    };
    // Digital-twin driver: mirror the browser walker with the same moveCircle code,
    // pick key presses in the twin (including 3-step unstick sequences), then send
    // them as real keyboard input and resync to the browser position each round.
    const KEY_DIRS = {KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0]};
    let wp = 1, twin = [...spawn];
    const speed = 2.35, frameDt = 0.05;
    const arcOf = p => {
      let arc = 0, bd = Infinity, bi = 0, bt = 0;
      for (let s = 0; s < route.length - 1; s++) {
        const ax = route[s][0], az = route[s][1], bx = route[s + 1][0], bz = route[s + 1][1];
        const abx = bx - ax, abz = bz - az, len2 = abx * abx + abz * abz || 1e-9;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * abx + (p[1] - az) * abz) / len2));
        const d = Math.hypot(p[0] - (ax + abx * t), p[1] - (az + abz * t));
        if (d < bd) { bd = d; bi = s; bt = t; }
      }
      for (let s = 0; s < bi; s++) arc += Math.hypot(route[s + 1][0] - route[s][0], route[s + 1][1] - route[s][1]);
      return arc + bt * Math.hypot(route[bi + 1][0] - route[bi][0], route[bi + 1][1] - route[bi][1]);
    };
    const stepTwin = (p, key) => {
      const [dx, dz] = KEY_DIRS[key];
      return moveTwin(nav, p, [dx * speed * frameDt, dz * speed * frameDt]).position;
    };
    for (let round = 0; round < 900; round++) {
      twin = [...(await page.evaluate(() => window.eys.state().walk.position))];
      const dist = Math.hypot(twin[0] - target[0], twin[1] - target[1]);
      if (dist < 0.8) { arrived = true; break; }
      while (wp < route.length - 1 && Math.hypot(twin[0] - route[wp][0], twin[1] - route[wp][1]) < 0.5) wp++;
      const goal = route[Math.min(wp, route.length - 1)];
      const want = Math.abs(goal[0] - twin[0]) > Math.abs(goal[1] - twin[1])
        ? (goal[0] > twin[0] ? 'KeyD' : 'KeyA')
        : (goal[1] > twin[1] ? 'KeyS' : 'KeyW');
      // Fast path: the direct key already advances along the route.
      let plan = null, bestArc = arcOf(twin);
      if (arcOf(stepTwin(twin, want)) > bestArc + 1e-4) plan = [want];
      else {
        // Search up to 6 key presses ahead for an escape sequence (wall pockets).
        const search = (p, seq, depth) => {
          if (depth === 0) return;
          for (const key of Object.keys(KEY_DIRS)) {
            const np = stepTwin(p, key);
            const a = arcOf(np);
            if (a > bestArc + 1e-4) { bestArc = a; plan = [...seq, key]; }
            search(np, [...seq, key], depth - 1);
          }
        };
        search(twin, [], 6);
      }
      const keys = plan && plan.length ? plan.slice(0, 4) : [want];
      for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD'])
        if (keys.includes(key)) await page.keyboard.down(key); else await page.keyboard.up(key);
      await page.waitForTimeout(Math.max(60, keys.length * 45));
      for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(key);
    }
    for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(key);
    await page.setViewportSize(finalViewport);
    await page.waitForTimeout(600);
  }

  console.log('At bell', await page.evaluate(() => window.eys.state().walk.position));
  const imm = () => page.evaluate(() => window.eys.state().walk.immersion);
  const waitPhase = ph => page.waitForFunction(p => window.eys.state().walk.immersion.phase === p, ph, {timeout: 40000});
  const outDir = path.join(root, '.design', 'self-ejection-pov');
  const saveShot = async name => {
    const before = await imm();
    await page.screenshot({path: path.join(outDir, 'screenshots', name + '.png')});
    const after = await imm();
    report.samples.push({name, viewport: page.viewportSize(), before, after});
    console.log(name, before.phase, before.elapsed.toFixed(3), '->', after.elapsed.toFixed(3));
    writeFileSync(path.join(outDir, 'capture.json'), JSON.stringify(report, null, 2) + '\n');
  };
  const reachVoting = async () => {
    await page.keyboard.press('KeyE');
    await waitPhase('ringing');
    await waitPhase('discussion');
    await page.locator('#immersion-skip').click();
    await waitPhase('voting');
  };
  const runSelf = async (style, name, marks, down = false) => {
    await reachVoting();
    await page.locator('#immersion-self-demo').click();
    await page.locator('#immersion-style-' + style).click();
    await page.locator('#immersion-confirm').click();
    await waitPhase('ejection');
    for (const mark of marks) {
      await page.waitForFunction(t => {
        const s = window.eys.state().walk.immersion;
        return s.phase === 'ejection' && s.elapsed >= t;
      }, mark, {timeout: 40000});
      if (down && mark >= 2.5) {
        const v = page.viewportSize();
        await page.mouse.move(v.width / 2, v.height * .25);
        await page.mouse.down();
        await page.mouse.move(v.width / 2, v.height * .25 + 385, {steps: 4});
        await page.mouse.up();
      }
      await saveShot(name + '-' + mark.toFixed(1).replace('.', '_'));
    }
    await waitPhase('finished');
    await page.locator('#immersion-return').click();
    await waitPhase('roam');
  };
  await runSelf('water', 'desktop-water-forward', [.4, 1.1, 1.8, 2.5, 3.5, 5.0]);
  await runSelf('water', 'desktop-water-down', [3.8], true);
  await runSelf('fire', 'desktop-fire-forward', [.5, 1.5, 2.1, 2.4, 3.5]);
  await page.setViewportSize({width: 768, height: 1024});
  await runSelf('water', 'tablet-water-down', [3.8], true);
  await runSelf('fire', 'tablet-fire-forward', [3.0]);
  await page.setViewportSize({width: 375, height: 812});
  await runSelf('water', 'phone-water-down', [3.8], true);
  await runSelf('fire', 'phone-fire-forward', [3.0]);
  report.errors.push(...pageErrors);
  report.passed = !report.errors.length;
} catch (fatal) {
  report.errors.push(String(fatal.stack || fatal));
  console.error(fatal);
} finally {
  await browser.close();
  writeFileSync(path.join(root, '.design', 'self-ejection-pov', 'capture.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log('Captured', report.samples.length, 'frames; errors:', report.errors);
