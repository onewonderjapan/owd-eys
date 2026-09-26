// One-off K2b probe (diagnostic, not a gate): ?round=force-kill -> wait for the
// corpse -> route to 1.2m south of it, final approach walking north -> KeyV
// (first person faces the last heading, i.e. the corpse) -> corpse-probe-close.png.
// Overview -> corpse-probe-top.png. Prints corpse shape diagnostics (exposed
// fraction, pool radius, hidden feet — measured at corpse time).
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const sim = await import('../../src/map-walk-simulation.js');
const layout = JSON.parse(readFileSync(new URL('../../src/map-scene.json', import.meta.url)));
const props = JSON.parse(readFileSync(new URL('../../src/map-walk-props.json', import.meta.url)));
const nav = sim.createNavigation(layout.layout, props);
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader']});
const KEY_DIRS = {KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0]};
const SPEED = 2.35, FRAME = 0.05;
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 960}});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e).slice(0, 200)));
  page.on('console', m => { if (/corpse-debug/.test(m.text())) console.log('CONSOLE', m.text()); });
  await page.goto(url + '?round=force-kill', {waitUntil: 'networkidle'});
  await page.click('#character-grid button:nth-child(3)');
  await page.click('#walk-enter');
  await page.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
  const corpseOk = await page.waitForFunction(() => window.eys?.state?.().walk?.npcs?.round?.corpses?.length === 1, null, {timeout: 10000}).then(() => true).catch(() => false);
  const diag = await page.evaluate(() => {
    const n = window.eys.state().walk.npcs;
    return {round: n && n.round, shapes: (n && n.corpseShapes) || []};
  });
  console.log('corpse appeared:', corpseOk);
  console.log('round:', JSON.stringify(diag.round));
  console.log('corpse shape (measured at corpse time):', JSON.stringify(diag.shapes));
  const corpse = diag.round.corpses[0].position;
  const stand = [corpse[0], corpse[1] + 1.2]; // 1.2m south of the leg
  const route = sim.findPath(nav, await page.evaluate(() => window.eys.state().walk.position), stand);
  console.log('route:', Array.isArray(route) ? route.length + ' waypoints' : 'none');
  const tap = async key => { await page.keyboard.down(key); await page.waitForTimeout(55); await page.keyboard.up(key); await page.waitForTimeout(25); };
  if (Array.isArray(route)) {
    let wp = 1;
    for (let i = 0; i < 1400; i++) {
      const p = await page.evaluate(() => window.eys.state().walk.position);
      if (i % 100 === 0) console.log('tap', i, 'at', p.map(v => +v.toFixed(2)).join(','), 'wp', wp);
      const goal = route[Math.min(wp, route.length - 1)];
      if (Math.hypot(p[0] - goal[0], p[1] - goal[1]) < 0.45 && wp < route.length - 1) { wp++; continue; }
      if (Math.hypot(p[0] - stand[0], p[1] - stand[1]) < 1.15) break;
      const dx = goal[0] - p[0], dz = goal[1] - p[1];
      if (Math.abs(dx) > Math.abs(dz)) await tap(dx > 0 ? 'KeyD' : 'KeyA'); else await tap(dz > 0 ? 'KeyS' : 'KeyW');
    }
    // Final approach: pure KeyW (north) so the last heading points at the leg.
    for (let i = 0; i < 60; i++) {
      const p = await page.evaluate(() => window.eys.state().walk.position);
      const dz = corpse[1] - p[1];
      if (Math.hypot(corpse[0] - p[0], dz) <= 1.25 && dz > 0) break;
      if (dz <= 0) break; // overshot: keep heading anyway
      await tap('KeyW');
    }
  }
  const dist = await page.evaluate(cp => Math.hypot(cp[0] - window.eys.state().walk.position[0], cp[1] - window.eys.state().walk.position[1]), corpse);
  console.log('final dist to leg:', dist.toFixed(2));
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyV'); // first person: camera faces the last heading (the leg)
  await page.waitForTimeout(600);
  await page.screenshot({path: path.join(root, 'reports', 'immersion', 'corpse-probe-close.png'), type: 'png'});
  await page.keyboard.press('KeyV'); // overview
  await page.waitForTimeout(600);
  await page.screenshot({path: path.join(root, 'reports', 'immersion', 'corpse-probe-top.png'), type: 'png'});
  const finalState = await page.evaluate(() => {
    const n = window.eys.state().walk.npcs;
    return {corpses: n && n.round && n.round.corpses, actors: n && n.npcs.map(m => m.actor), reportable: window.eys.state().walk.reportable};
  });
  console.log('final:', JSON.stringify(finalState));
  console.log('errors:', errors.slice(0, 3));
  await browser.close();
} catch (e) { console.log('fatal', String(e && e.message || e)); await browser.close(); process.exit(1); }
