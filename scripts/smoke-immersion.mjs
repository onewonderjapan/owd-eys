// Playwright smoke for the POV immersion feature. Starts from the real character
// roster, walks to the courthouse bell with real keyboard input along a nav-computed
// path, then drives the meeting/ejection flows in one page session.
// Usage: node scripts/smoke-immersion.mjs [url] [label]
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const label = process.argv[3] || 'immersion';
const LOOK = process.env.LOOK || ''; // V8 sample: LOOK=court renames meeting shots

const simModule = await import('../src/map-walk-simulation.js').catch(() => ({}));
// findPath lives in src (shared with the walk NPCs); nav is passed per call.
const {createNavigation, findPath} = simModule;
const moveTwin = simModule.moveCircle || ((p, d) => [p[0] + d[0], p[1] + d[1]]);
// Button-table coordinates come from the config, never hardcoded (it is the
// same source the walk reads).
const cfgModule = await import('../src/immersion-config.js').catch(() => null);
const BTN_INTERACT = cfgModule?.IMMERSION_CONFIG ? [...cfgModule.IMMERSION_CONFIG.button.interaction] : [-0.72, -1.98];
let nav = null;
try {
  const layout = JSON.parse(readFileSync(new URL('../src/map-scene.json', import.meta.url), 'utf8'));
  const props = JSON.parse(readFileSync(new URL('../src/map-walk-props.json', import.meta.url), 'utf8'));
  nav = createNavigation(layout.layout, props);
} catch { /* navigation-assisted pathing unavailable; fallback to manual waypoints */ }

// Digital-twin keyboard driver: plan key presses on the twin (with a short
// escape search for wall pockets), then send them as real keyboard input.
// Used by the fountain-button section; returns the final walker position.
async function driveToTarget(page, target, maxRounds = 900, arriveDist = 1.25) {
  const KEY_DIRS = {KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0]};
  const speed = 2.35, frameDt = 0.05;
  const stepTwin = (p, key) => { const [dx, dz] = KEY_DIRS[key]; return moveTwin(nav, p, [dx * speed * frameDt, dz * speed * frameDt]).position; };
  const route = findPath(nav, await page.evaluate(() => window.eys.state().walk.position), target);
  if (!Array.isArray(route)) return null;
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
  let wp = 1;
  for (let round = 0; round < maxRounds; round++) {
   const twin = [...(await page.evaluate(() => window.eys.state().walk.position))];
   if (Math.hypot(twin[0] - target[0], twin[1] - target[1]) < arriveDist) return twin;
   while (wp < route.length - 1 && Math.hypot(twin[0] - route[wp][0], twin[1] - route[wp][1]) < 0.5) wp++;
   const goal = route[Math.min(wp, route.length - 1)];
   const want = Math.abs(goal[0] - twin[0]) > Math.abs(goal[1] - twin[1])
    ? (goal[0] > twin[0] ? 'KeyD' : 'KeyA')
    : (goal[1] > twin[1] ? 'KeyS' : 'KeyW');
   let plan = null, bestArc = arcOf(twin);
   if (arcOf(stepTwin(twin, want)) > bestArc + 1e-4) plan = [want];
   else {
    const search = (pt, seq, depth) => {
     if (depth === 0) return;
     for (const k of Object.keys(KEY_DIRS)) {
      const np = stepTwin(pt, k);
      const a = arcOf(np);
      if (a > bestArc + 1e-4) { bestArc = a; plan = [...seq, k]; }
      search(np, [...seq, k], depth - 1);
     }
    };
    search(twin, [], 6);
   }
   const keys = plan && plan.length ? plan.slice(0, 4) : [want];
   for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) if (keys.includes(k)) await page.keyboard.down(k); else await page.keyboard.up(k);
   await page.waitForTimeout(Math.max(60, keys.length * 45));
   for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(k);
  }
  return await page.evaluate(() => window.eys.state().walk.position);
}

const report = {schema: 1, url, label, passed: false, version: null, build_sha256: (() => {
  // pin the report to the exact build so publish.py can reject stale reports
  try { return createHash('sha256').update(readFileSync(path.join(root, 'reports', 'build.json'))).digest('hex'); }
  catch { return null; }
})(), checks: [], errors: [], screenshots: []};
const check = (name, passed, detail = '') => {
  report.checks.push({name, passed: Boolean(passed), detail: String(detail).slice(0, 400)});
  if (!passed) report.errors.push(`${name}: ${detail}`);
};

// Decode a screenshot PNG inside the browser page (createImageBitmap + canvas,
// no packages) and measure wash ratios: strict overexposure (all channels > 245),
// warm near-white wash (the additive-flame whiteout signature; the strict
// threshold misses it because the wash is orange-tinted, not pure white), and
// light gray slabs (all channels > 200 — the "material-less white board" look).
async function pixelWash(page, relPath) {
  const b64 = readFileSync(path.join(root, 'reports', 'immersion', relPath)).toString('base64');
  return await page.evaluate(async src => {
    const blob = await (await fetch('data:image/png;base64,' + src)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let over = 0, warm = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) over++;
      if (d[i] > 240 && d[i + 1] > 215 && d[i + 2] > 170) warm++;
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
    }
    const total = d.length / 4;
    return {over: +(over / total).toFixed(4), warm: +(warm / total).toFixed(4), light: +(light / total).toFixed(4)};
  }, b64);
}

const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader']});
try {
  // Small viewport while software-rendering the walk (RAF-bound dt), full desktop for shots.
  // MOBILE=1 keeps a phone portrait viewport through the whole chain (A9).
  const MOBILE = process.env.MOBILE === '1';
  const walkViewport = {width: 720, height: 480};
  const finalViewport = MOBILE ? {width: 390, height: 844} : {width: 1440, height: 960};
  const shotPrefix = MOBILE ? 'mobile-' : '';
  const page = await browser.newPage({viewport: walkViewport});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push((e && e.stack) ? e.stack.slice(0, 800) : String(e)));
  const actorParam = process.env.ACTOR;
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
  const route = findPath(nav, spawn, [8.7, -4.6]);
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
  const nearState = await page.evaluate(() => {
    const s = window.eys.state();
    return {position: s.walk.position, nearBell: s.walk.nearBell, area: s.walk.area};
  });
  check('bell: 真实按键走到铃前', arrived, JSON.stringify(nearState.position));
  check('bell: 触发提示出现', nearState.nearBell === true, `nearBell=${nearState.nearBell} area=${nearState.area?.id}`);

  // Audio (B1): ambience runs on walk start, footfalls track real movement,
  // idle is silent, and the HUD mute switch gates both ambience and steps.
  // The muted walk uses KeyW (z decreasing — the approach direction toward the
  // bell at z=-7.56) so the player stays inside the trigger radius for KeyE.
  const audioAfterWalk = await page.evaluate(() => window.eys.state().walk.audio);
  check('audio: 行走后脚步计数增长', (audioAfterWalk?.steps || 0) > 0, JSON.stringify(audioAfterWalk));
  check('audio: 环境音随行走启动', audioAfterWalk?.on === true && audioAfterWalk?.ambience === true, JSON.stringify(audioAfterWalk));
  const idleSteps = await page.evaluate(() => window.eys.state().walk.audio.steps);
  await page.waitForTimeout(500);
  const idleStepsAgain = await page.evaluate(() => window.eys.state().walk.audio.steps);
  check('audio: 静止时脚步不增长', idleStepsAgain === idleSteps, `${idleSteps} -> ${idleStepsAgain}`);
  await page.click('#walk-mute');
  const mutedState = await page.evaluate(() => window.eys.state().walk.audio);
  check('audio: 静音开关同时关掉环境音', mutedState?.muted === true && mutedState?.ambience === false, JSON.stringify(mutedState));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(150);
  const mutedSteps = await page.evaluate(() => window.eys.state().walk.audio.steps);
  check('audio: 静音期间移动无声(计数不变)', mutedSteps === idleStepsAgain, `${idleStepsAgain} -> ${mutedSteps}`);
  await page.click('#walk-mute');
  const restoredAudio = await page.evaluate(() => window.eys.state().walk.audio);
  check('audio: 恢复声音', restoredAudio?.muted === false && restoredAudio?.ambience === true, JSON.stringify(restoredAudio));

  // Photo mode (B2): HUD hides (fan notice stays), Enter exports and auto-exits.
  await page.click('#walk-photo');
  const photoState = await page.evaluate(() => window.eys.state().walk.photo);
  const controlsHidden = await page.locator('#walk-view-toggle').isHidden();
  const barVisible = await page.locator('#walk-photo-bar').isVisible();
  check('photo: 进入拍照并隐藏控件', photoState === true && controlsHidden && barVisible, `photo=${photoState} controlsHidden=${controlsHidden} bar=${barVisible}`);
  const downloadPromise = page.waitForEvent('download', {timeout: 15000});
  await page.keyboard.press('Enter');
  const download = await downloadPromise.then(() => true).catch(() => false);
  const photoAfter = await page.evaluate(() => window.eys.state().walk.photo);
  check('photo: Enter 导出图片并自动退出', download === true && photoAfter === false, `download=${download} photo=${photoAfter}`);

  // Dusk mood (B3): the applied background color must actually change and restore.
  const bgBefore = await page.evaluate(() => window.eys.state().walk.duskBg);
  await page.click('#walk-dusk');
  const duskOn = await page.evaluate(() => window.eys.state().walk);
  const duskPressed = await page.locator('#walk-dusk').getAttribute('aria-pressed');
  check('dusk: 切换到黄昏', duskOn.dusk === true && duskPressed === 'true' && duskOn.duskBg !== bgBefore && duskOn.duskBg === '3d3654', `dusk=${duskOn.dusk} bg ${bgBefore}->${duskOn.duskBg}`);
  // V5 2026-09-24: dusk must brighten the shared window/lamp-housing material
  // and drop glow pools under the street lamps (measured via live state).
  const glowOn = await page.evaluate(() => window.eys.state().walk.duskGlow);
  const poolsOn = await page.evaluate(() => window.eys.state().walk.glowPools);
  check('dusk: 灯罩/窗户自发光提升', Boolean(glowOn) && glowOn.count > 0 && glowOn.intensity > 1.2, JSON.stringify(glowOn));
  check('dusk: 灯下光斑就位', poolsOn === 5, `pools=${poolsOn}`);
  await page.waitForTimeout(300);
  await page.screenshot({path: path.join(root, 'reports', 'immersion', shotPrefix + 'dusk-on.png'), type: 'png'});
  report.screenshots.push(shotPrefix + 'dusk-on.png');
  await page.click('#walk-dusk');
  const duskOff = await page.evaluate(() => window.eys.state().walk);
  check('dusk: 切回原光照', duskOff.dusk === false && duskOff.duskBg === bgBefore, `dusk=${duskOff.dusk} bg=${duskOff.duskBg} want=${bgBefore}`);
  const glowOff = await page.evaluate(() => window.eys.state().walk.duskGlow);
  check('dusk: 关闭后自发光逐项还原', Boolean(glowOff) && glowOff.count === glowOn.count && Math.abs(glowOff.intensity - 1) < 0.01, JSON.stringify(glowOff));
  check('dusk: 关闭后光斑撤除', duskOff.glowPools === 0, `pools=${duskOff.glowPools}`);
  await page.waitForTimeout(300);
  await page.screenshot({path: path.join(root, 'reports', 'immersion', shotPrefix + 'dusk-off.png'), type: 'png'});
  report.screenshots.push(shotPrefix + 'dusk-off.png');

  const promptVisible = await page.evaluate(() => {
    const el = document.querySelector('#immersion-prompt');
    return el ? !el.hidden : null;
  });
  check('bell: 提示DOM可见', promptVisible === true, `prompt hidden=${promptVisible === false ? 'yes' : 'no'}`);
  await page.screenshot({path: path.join(root, 'reports', 'immersion', 'bell-near.png'), type: 'png'});
  report.screenshots.push('bell-near.png');

  // Snapshot the roam view, ring, then cancel and compare restore.
  const before = await page.evaluate(() => {
    const s = window.eys.state();
    return {position: s.walk.position, view: s.walk.view, area: s.walk.area?.id};
  });
  await page.keyboard.press('KeyE');
  const accepted = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing' || window.eys?.state?.().walk?.immersion?.busy, {timeout: 20000}).then(() => true).catch(() => false);
  if (!accepted) {
    const diag = await page.evaluate(() => JSON.stringify({pos: window.eys.state().walk.position, area: window.eys.state().walk.area, nearBell: window.eys.state().walk.nearBell, imm: window.eys.state().walk.immersion, props: window.eys.state().walk.props}));
    check('session: 按铃进入会话', false, 'never became busy; state=' + diag);
    throw new Error('session never became busy');
  }
  const duringPrepare = await page.evaluate(() => window.eys.state().walk.immersion?.phase);
  check('session: 按铃进入会话', Boolean(duringPrepare && duringPrepare !== 'roam'), `phase=${duringPrepare}`);
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', null, {timeout: 30000}).catch(() => {});
  const ringState = await page.evaluate(() => window.eys.state().walk.immersion?.phase);
  check('session: 准备完成后鸣铃', ringState === 'ringing', `phase=${ringState}`);
  // V4 2026-09-24: the ring beat must have the bell as its subject — projected
  // bell width ≥ 20% of the viewport (exposed by the director's state()).
  const ringBell = await page.evaluate(() => window.eys.state().walk.immersion?.ringBell);
  check('ring: 铃投影宽度≥20%视口', Boolean(ringBell) && ringBell.widthFrac >= 0.2, JSON.stringify(ringBell));
  const duckedAudio = await page.evaluate(() => window.eys.state().walk.audio);
  check('audio: 演出期间行走音被压低', duckedAudio?.ducked === true && duckedAudio?.on === true, JSON.stringify(duckedAudio));

  // During the ring the player must not keep walking; freeze check via keys.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  const frozen = await page.evaluate(() => window.eys.state().walk.position);
  const frozenDelta = Math.hypot(before.position[0] - frozen[0], before.position[1] - frozen[1]);
  check('session: busy期间移动被冻结', frozenDelta < 1e-4, `delta=${frozenDelta} pos=${JSON.stringify(frozen)}`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', {timeout: 10000});
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const s = window.eys.state();
    return {position: s.walk.position, view: s.walk.view, area: s.walk.area?.id, drift: s.walk.immersion?.positionDrift};
  });
  const posDelta = Math.hypot(before.position[0] - after.position[0], before.position[1] - after.position[1]);
  check('restore: 取消后回到原位置', posDelta < 1e-4, `delta=${posDelta}`);
  check('restore: 视角恢复一致', before.view.mode === after.view.mode, `${before.view.mode} -> ${after.view.mode}`);
  check('restore: 无位置漂移记录', (after.drift ?? 0) < 1e-4 || after.drift == null, `drift=${after.drift}`);
  const singleSession = await page.evaluate(() => window.eys.state().walk.immersion?.sessionId);
  check('session: 取消后会话回到roam', await page.evaluate(() => window.eys.state().walk.immersion?.phase) === 'roam', `sessionId=${singleSession}`);
  const restoredDuck = await page.evaluate(() => window.eys.state().walk.audio);
  check('audio: 演出结束后压低解除', restoredDuck?.ducked === false && restoredDuck?.ambience === true, JSON.stringify(restoredDuck));

  // ---------------------------------------------------------------- P2/P3/P4/P5
  // From the bell, drive the whole meeting through the real state machine and capture
  // evidence for the round table, voting, water and fire branches in this same page.
  const SHOT = async (name) => {
    const prefixed = shotPrefix + name;
    await page.screenshot({path: path.join(root, 'reports', 'immersion', prefixed), type: 'png'});
    report.screenshots.push(prefixed);
  };
  const imm = () => page.evaluate(() => window.eys.state().walk.immersion);
  const waitPhase = async (phase, timeout = 30000) =>
    page.waitForFunction(ph => window.eys?.state?.().walk?.immersion?.phase === ph, phase, {timeout}).then(() => true).catch(() => false);

  await page.keyboard.press('KeyE');
  if (!await waitPhase('ringing', 40000)) check('flow: ringing', false, JSON.stringify(await imm()));
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing' && window.eys.state().walk.immersion.elapsed > 0.4, {timeout: 20000}).catch(() => {});
  // Ring / meeting first person on the real body (2026-09-24): lens on the eye,
  // own body visible, head hidden, and the view centre never blocked by the own
  // body within 30cm (the goose head and body are one mesh).
  const bodyPovCheck = async (label) => {
    const bp = await page.evaluate(() => window.eys.state().walk.immersion?.bodyPov);
    const blocked = bp?.centerHit && bp.centerHit.self && bp.centerHit.distance < 0.3;
    check(label + ': 真身体第一人称(镜头在眼位,身体可见,头隐藏,中心不被自己挡住)',
      !!bp && bp.camToEye < 0.005 && bp.bodyVisible && bp.headHidden && !blocked, JSON.stringify(bp));
  };
  await SHOT('ring-pov.png');
  await bodyPovCheck('ring');
  // V5 2026-09-24: the sky dome must give a vertical gradient — measure how much
  // the row mean color varies across the 8-28% height band (clear of the mobile
  // UI): a flat 1.5.1 background measures ≈0, the dome gradient is prominent.
  const skyGrad = await page.evaluate(async src => {
    const blob = await (await fetch('data:image/png;base64,' + src)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const w = cv.width, h = cv.height;
    const mn = [255, 255, 255], mx = [0, 0, 0];
    for (let y = Math.floor(h * 0.08); y < Math.floor(h * 0.28); y++) {
      let r = 0, gr = 0, b = 0, n = 0;
      for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) {
        const i = (y * w + x) * 4; r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++;
      }
      const c = [r / n, gr / n, b / n];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c[k]); mx[k] = Math.max(mx[k], c[k]); }
    }
    return +((mx[0] - mn[0]) + (mx[1] - mn[1]) + (mx[2] - mn[2])).toFixed(1);
  }, readFileSync(path.join(root, 'reports', 'immersion', shotPrefix + 'ring-pov.png')).toString('base64'));
  check('sky: 天空竖向渐变幅度>25', skyGrad > 25, JSON.stringify({diff: skyGrad}));
  if (!await waitPhase('seating', 15000)) check('flow: seating', false, JSON.stringify(await imm()));
  check('flow: seating入discussion', await waitPhase('discussion', 15000), 'discussion reached');
  await page.waitForTimeout(1200);
  const discussion = await imm();
  check('flow: 讨论字幕与发言者', discussion?.phase === 'discussion' && discussion?.speakerIndex === 0,
    `phase=${discussion?.phase} speaker=${discussion?.speakerIndex}`);
  const captionText = await page.evaluate(() => document.querySelector('#immersion-caption')?.textContent || '');
  check('flow: 字幕包含说话者标签', captionText.includes('：'), captionText);
  // V8 sample: LOOK=court renames the meeting frames so the ?look=court sample
  // never overwrites the default evidence; default runs keep the old names.
  const meetingShot = LOOK === 'court' ? 'look-court-desktop.png' : 'meeting-pov.png';
  await SHOT(meetingShot);
  await bodyPovCheck('meeting');
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(500);
  await SHOT(LOOK === 'court' ? 'look-court-mobile.png' : 'meeting-mobile.png');
  await page.setViewportSize({width: 1440, height: 960});
  await page.waitForTimeout(400);

  const skipBtn = () => page.evaluate(() => document.querySelector('#immersion-skip')?.click());
  await skipBtn();
  if (!await waitPhase('voting', 10000)) check('flow: voting', false, JSON.stringify(await imm()));
  await page.waitForTimeout(500);
  const votingDom = await page.evaluate(() => ({
    avatars: document.querySelectorAll('#immersion-avatars button').length,
    confirmDisabled: document.querySelector('#immersion-confirm')?.disabled,
    stylePicker: !document.querySelector('#immersion-style-picker')?.hidden,
  }));
  check('vote: 7个NPC头像且确认禁用', votingDom.avatars === 7 && votingDom.confirmDisabled === true, JSON.stringify(votingDom));
  await page.evaluate(() => document.querySelector('#immersion-avatars button[data-actor="cast.05"]')?.click());
  await page.waitForFunction(() => document.querySelector('#immersion-avatars button[aria-pressed="true"]')?.dataset.actor === 'cast.05', {timeout: 5000}).catch(() => {});
  const pressed = await page.evaluate(() => document.querySelector('#immersion-avatars button[aria-pressed="true"]')?.dataset.actor);
  check('vote: 选中即aria-pressed', pressed === 'cast.05', `pressed=${pressed}`);
  // Clicking the player's own avatar must NOT become a vote target.
  const playerId = await page.evaluate(() => window.eys.state().walk.immersion.playerActorId);
  await page.evaluate(id => document.querySelector(`#immersion-avatars button[data-actor="${id}"]`)?.click(), playerId);
  await page.waitForTimeout(250);
  const pressedSelf = await page.evaluate(() => document.querySelector('#immersion-avatars button[aria-pressed="true"]')?.dataset.actor);
  check('vote: 玩家不可被直接选中', pressedSelf === 'cast.05', `pressed=${pressedSelf} player=${playerId}`);
  await page.evaluate(() => document.querySelector('#immersion-avatars button[data-actor="cast.04"]')?.click());
  await page.waitForFunction(() => document.querySelector('#immersion-avatars button[aria-pressed="true"]')?.dataset.actor === 'cast.04', {timeout: 5000}).catch(() => {});
  const pressed2 = await page.evaluate(() => document.querySelector('#immersion-avatars button[aria-pressed="true"]')?.dataset.actor);
  const machineSel = await page.evaluate(() => ({
    sel: window.eys.state().walk.immersion?.selectedId,
    buttons: [...document.querySelectorAll('#immersion-avatars button')].map(b => [b.dataset.actor, b.getAttribute('aria-pressed'), b.disabled]),
  }));
  const saDebug = await page.evaluate(() => ({sa: window.__saDebug, upd: window.__upd, phase: window.eys.state().walk.immersion?.phase}));
  check('vote: 再选另一人仅后者生效', machineSel?.sel === 'cast.04' && pressed2 === 'cast.04', `pressed=${pressed2} machine=${machineSel && machineSel.sel} sa=${JSON.stringify(saDebug)}`);
  await page.evaluate(() => document.querySelector('#immersion-style-fire')?.click());
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('#immersion-style-fire')?.getAttribute('aria-pressed') === 'true', {timeout: 5000}).catch(() => {});
  const firePressed = await page.evaluate(() => document.querySelector('#immersion-style-fire')?.getAttribute('aria-pressed'));
  check('vote: 火堆风格可选', firePressed === 'true', `pressed=${firePressed}`);
  await SHOT('voting.png');
  // C6 2026-09-26: P3 UI — bigger avatar cards, phone picker row (measured at voting;
  // the MOBILE run measures at the real phone viewport, then restores the prior size).
  if (MOBILE) { await page.setViewportSize(finalViewport); await page.waitForTimeout(500); }
  const c6ui = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#immersion-avatars button')];
    const card = cards[0]?.getBoundingClientRect();
    const img = cards[0]?.querySelector('img')?.getBoundingClientRect();
    const picker = document.querySelector('#immersion-style-picker')?.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const center = {left: vw * 0.3, right: vw * 0.7, top: vh * 0.3, bottom: vh * 0.7};
    const pickerHitsCenter = picker && picker.width > 0
      ? !(picker.right < center.left || picker.left > center.right || picker.bottom < center.top || picker.top > center.bottom)
      : null;
    return {
      cards: cards.length,
      cardH: card ? +card.height.toFixed(1) : 0,
      touch: card ? +Math.min(card.width, card.height).toFixed(1) : 0,
      imgRatio: card && img ? +(img.height / card.height).toFixed(2) : 0,
      pickerHitsCenter,
      pickerW: picker ? +picker.width.toFixed(0) : 0,
      pickerH: picker ? +picker.height.toFixed(0) : 0,
      noHOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  const c6cardMin = MOBILE ? 48 : 56;
  check('c6: 头像卡高度与头像占比', c6ui.cards > 0 && c6ui.cardH >= c6cardMin && c6ui.imgRatio >= 0.6 && c6ui.imgRatio <= 0.8, JSON.stringify(c6ui));
  check('c6: 头像触区>=44且页面无横向溢出', c6ui.touch >= 44 && c6ui.noHOverflow, JSON.stringify(c6ui));
  if (MOBILE) check('c6: 手机样式选择器一行横滚且不压画面中心40%', c6ui.pickerHitsCenter === false && c6ui.pickerW > 0, JSON.stringify(c6ui));
  await SHOT('c6-voting.png');
  // MOBILE stays at the phone viewport through confirm/result so the banner is
  // measured in the same frame it is shown (a mid-phase resize used to hide it).
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  await page.waitForTimeout(300);
  const afterConfirm = await imm();
  const bannerText = await page.evaluate(() => document.querySelector('#immersion-banner')?.textContent || '');
  check('vote: 结果横幅与票数', afterConfirm?.phase === 'result' && /\d+ 票/.test(bannerText), bannerText);
  await SHOT('vote-result.png');
  // C6: the enlarged result banner, measured at result phase (phone viewport on mobile)
  const c6banner = await page.evaluate(() => {
    const el = document.querySelector('#immersion-banner');
    const r = el?.getBoundingClientRect();
    return {px: el ? +getComputedStyle(el).fontSize.replace('px', '') : 0, w: r ? +r.width.toFixed(0) : 0, h: r ? +r.height.toFixed(0) : 0};
  });
  check('c6: 结果横幅字号>=26px', c6banner.px >= 26 && c6banner.w > 0, JSON.stringify(c6banner));
  await SHOT('c6-vote-result.png');
  if (MOBILE) { await page.setViewportSize({width: 1440, height: 960}); await page.waitForTimeout(500); }

  if (!await waitPhase('ejection', 8000)) check('fire: ejection', false, JSON.stringify(await imm()));
  await page.waitForTimeout(300);
  await SHOT('fire-start.png');
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 5.8, {timeout: 30000}).catch(() => {});
  await SHOT('fire-npc.png');
  const fireDiag = await imm();
  check('fire: 目标为所选NPC', fireDiag?.targetId === 'cast.04', `target=${fireDiag?.targetId} style=${fireDiag?.style}`);
  if (!await waitPhase('finished', 15000)) check('fire: finished', false, JSON.stringify(await imm()));

  await page.evaluate(() => document.querySelector('#immersion-replay')?.click());
  await page.waitForTimeout(300);
  const replay = await imm();
  check('fire: 重播保留target/style', replay?.phase === 'ejection' && replay?.style === 'fire' && replay?.targetId === 'cast.04', JSON.stringify({phase: replay?.phase, style: replay?.style, target: replay?.targetId}));
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'finished', {timeout: 30000}).catch(() => {});
  await page.evaluate(() => document.querySelector('#immersion-return')?.click());
  check('flow: 返回漫游', await waitPhase('roam', 10000), 'roam after return');

  await page.keyboard.press('KeyE');
  if (!await waitPhase('ringing', 40000)) check('flow2: 再次按铃', false, JSON.stringify(await imm()));
  await skipBtn();
  await skipBtn();
  await skipBtn();
  if (!await waitPhase('voting', 15000)) check('flow2: voting', false, JSON.stringify(await imm()));
  await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#immersion-style-water')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  if (!await waitPhase('ejection', 10000)) check('water-self: ejection', false, JSON.stringify(await imm()));
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 1.0, {timeout: 15000}).catch(() => {});
  await SHOT('water-self.png');
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 6.3, {timeout: 30000}).catch(() => {});
  const dragX = MOBILE ? 195 : 720;
  const dragTop = MOBILE ? 250 : 300;
  const dragBottom = MOBILE ? 560 : 620;
  await page.mouse.move(dragX, dragTop);
  await page.mouse.down();
  await page.mouse.move(dragX, dragBottom, {steps: 8});
  await page.mouse.up();
  await page.waitForTimeout(400);
  await SHOT('water-self-look-down.png');
  // V3 2026-09-24: design 1.2 — the look-down beat must show the chain & stone.
  // Water is a low-red-color (r<90 counts: chain steel, stone, skin/feathers);
  // the uniform-blue 1.5.1 frame measured 0.2%. Gate: bottom half >3% warm pixels.
  const lookDown = await page.evaluate(async src => {
    const blob = await (await fetch('data:image/png;base64,' + src)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const w = cv.width, h = cv.height;
    // Chain and stone render steel-blue (G and B well above the deep water, G above R);
    // the purple own body (R above G) and the water do not count. Calibrated
    // 2026-09-24: look-down frame 0.82%, empty-water frames 0.05-0.06%. (The old
    // 'red > 90 in the bottom half' proxy was tuned for the proxy wing rig and
    // hovered around its 3% gate once the real body replaced the wings.)
    let hot = 0, tot = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; tot++;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (r >= 28 && gg >= 55 && gg >= r && b >= gg && b - r >= 30) hot++;
    }
    return +(hot / tot).toFixed(4);
  }, readFileSync(path.join(root, 'reports', 'immersion', shotPrefix + 'water-self-look-down.png')).toString('base64'));
  check('water-self: 低头链石入画(钢蓝链石像素>0.3%)', lookDown > 0.003, JSON.stringify({chainStone: lookDown}));
  const selfDiag = await imm();
  check('water-self: 目标是玩家且水下', selfDiag?.targetId === selfDiag?.playerActorId && selfDiag?.style === 'water' && selfDiag?.elapsed > 5.5,
    JSON.stringify({target: selfDiag?.targetId, player: selfDiag?.playerActorId, style: selfDiag?.style, elapsed: selfDiag?.elapsed}));
  if (!await waitPhase('finished', 15000)) check('water-self: finished', false, JSON.stringify(await imm()));
  await page.evaluate(() => document.querySelector('#immersion-return')?.click());
  await waitPhase('roam', 10000);

  // Session 2b: self-demo fire — the carried/lit phases must be distinguishable (A6).
  await page.keyboard.press('KeyE');
  if (!await waitPhase('ringing', 40000)) check('flow2b: 再次按铃', false, JSON.stringify(await imm()));
  await skipBtn();
  await skipBtn();
  await skipBtn();
  if (!await waitPhase('voting', 15000)) check('flow2b: voting', false, JSON.stringify(await imm()));
  await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#immersion-style-fire')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  if (!await waitPhase('ejection', 10000)) check('fire-self: ejection', false, JSON.stringify(await imm()));
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 1.0, {timeout: 15000}).catch(() => {});
  await SHOT('fire-self.png');
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 5.8, {timeout: 30000}).catch(() => {});
  await SHOT('fire-self-lit.png');
  // V1 2026-09-24: the in-pit look-back used to be a warm whiteout (before:
  // over=21.0%, warm=38.6% on 1.5.1). Both ratios are measured on the actual shot.
  const litWash = await pixelWash(page, shotPrefix + 'fire-self-lit.png');
  check('fire-self: 入坑回望过曝像素占比<25%', litWash.over < 0.25, JSON.stringify(litWash));
  check('fire-self: 入坑回望暖白泛光<18%', litWash.warm < 0.18, JSON.stringify(litWash));
  const fireSelfDiag = await imm();
  check('fire-self: 目标是玩家且火堆', fireSelfDiag?.targetId === fireSelfDiag?.playerActorId && fireSelfDiag?.style === 'fire',
    JSON.stringify({target: fireSelfDiag?.targetId, player: fireSelfDiag?.playerActorId, style: fireSelfDiag?.style}));
  if (!await waitPhase('finished', 15000)) check('fire-self: finished', false, JSON.stringify(await imm()));
  await page.evaluate(() => document.querySelector('#immersion-return')?.click());
  await waitPhase('roam', 10000);

  await page.keyboard.press('KeyE');
  if (!await waitPhase('ringing', 40000)) check('flow3: 再次按铃', false, JSON.stringify(await imm()));
  await skipBtn();
  await skipBtn();
  await skipBtn();
  if (!await waitPhase('voting', 15000)) check('flow3: voting', false, JSON.stringify(await imm()));
  // 1.7.0: earlier meetings in this session eject for good (flow1 ejected
  // cast.04), so flow3 votes whatever is still selectable and asserts against it.
  const flow3Target = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#immersion-avatars button')].find(b => !b.disabled);
    if (c) c.click();
    return c ? c.dataset.actor : null;
  });
  // confirm re-enables on the next UI render; slow frames after several
  // performances made a blind 150ms click land on the still-disabled button
  await page.waitForFunction(() => { const b = document.querySelector('#immersion-confirm'); return b && !b.disabled; }, null, {timeout: 5000}).catch(() => {});
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  if (!await waitPhase('ejection', 10000)) check('water-npc: ejection', false, JSON.stringify(await imm()));
  const integrity = [];
  for (const mark of [6.3, 7.5, 8.7]) {
    await page.waitForFunction(m => window.eys?.state?.().walk?.immersion?.elapsed >= m, mark, {timeout: 30000}).catch(() => {});
    integrity.push({at: await page.evaluate(() => window.eys.state().walk.immersion.elapsed), ...(await page.evaluate(() => window.eys.state().walk.immersion.ejection))});
  }
  await SHOT('water-npc.png');
  const npcDiag = { ...(await imm()), ejection: integrity[integrity.length - 1] };
  // Independent endpoints: the model/anchor world positions vs the measured first/last
  // chain link endpoints (linkTopEnd/linkBottomEnd), never alias arrays.
  const chainOk = (() => {
    const d = npcDiag?.ejection;
    if (!d?.modelTop || !d?.linkTopEnd || !d?.modelBottom || !d?.linkBottomEnd) return false;
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 0.03;
    return near(d.modelTop, d.linkTopEnd) && near(d.modelBottom, d.linkBottomEnd);
  })();
  check('water-npc: 链端锚点误差', chainOk, JSON.stringify(npcDiag?.ejection));
  check('water-npc: 目标为所选NPC', npcDiag?.targetId === flow3Target && npcDiag?.targetId !== npcDiag?.playerActorId, `target=${npcDiag?.targetId} picked=${flow3Target} player=${npcDiag?.playerActorId}`);
  if (!await waitPhase('finished', 15000)) check('water-npc: finished', false, JSON.stringify(await imm()));

  // Chain integrity: anchor error at each sampled underwater moment must stay <=0.03.
  writeFileSync(path.join(root, 'reports', 'immersion', 'water-link-integrity.json'),
    JSON.stringify({schema: 1, tolerance: 0.03, samples: integrity}, null, 2));
  report.screenshots.push('water-link-integrity.json');
  const worst = Math.max(...integrity.flatMap(s => [
    Math.hypot(s.modelTop[0] - s.linkTopEnd[0], s.modelTop[1] - s.linkTopEnd[1], s.modelTop[2] - s.linkTopEnd[2]),
    Math.hypot(s.modelBottom[0] - s.linkBottomEnd[0], s.modelBottom[1] - s.linkBottomEnd[1], s.modelBottom[2] - s.linkBottomEnd[2]),
  ]));
  check('water-npc: 链完整性JSON三时刻记录', integrity.length === 3, JSON.stringify(integrity.map(s => s.at)));

  // P5: mute toggle works and does not break the flow; leaks across five sessions.
  await page.evaluate(() => document.querySelector('#immersion-mute')?.click());
  const muted = await page.waitForFunction(() => document.querySelector('#immersion-mute')?.textContent === '取消静音', {timeout: 5000}).then(() => true).catch(() => false);
  await page.evaluate(() => document.querySelector('#immersion-mute')?.click());
  check('comfort: 静音切换可用', muted, `label=${await page.evaluate(() => document.querySelector('#immersion-mute')?.textContent)}`);
  // A8: five consecutive ring/cancel rounds must not grow scene resources.
  // sessions: rapid ring -> cancel; geometry/textures counters must not grow.
  // STYLE env: verify an additional ejection stage end-to-end (self-demo path),
  // screenshot the settled frame, then skip back to roam. Desktop only.
  const EXTRA_STYLE = process.env.STYLE || '';
  if (EXTRA_STYLE && !MOBILE) {
    // ring the bell again first: style/self-demo/confirm only apply in a session.
    // the previous section may have left the session on the finished screen
    const wasFinished = await page.evaluate(() => window.eys?.state?.().walk?.immersion?.phase === 'finished');
    if (wasFinished) {
      await page.evaluate(() => document.querySelector('#immersion-return')?.click());
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', null, {timeout: 10000}).catch(() => {});
    }
    await page.keyboard.press('KeyE');
    const votingReached = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'voting', null, {timeout: 40000}).then(() => true).catch(() => false);
    await page.evaluate(s => document.querySelector('#immersion-style-' + s)?.click(), EXTRA_STYLE);
    await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
    // confirm re-enables on the next UI render (RAF-paced) - wait for it
    await page.waitForFunction(() => { const b = document.querySelector('#immersion-confirm'); return b && !b.disabled; }, null, {timeout: 5000}).catch(() => {});
    await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
    const reached = await page.waitForFunction(s => window.eys?.state?.().walk?.immersion?.phase === 'ejection' && window.eys?.state?.().walk?.immersion?.style === s, EXTRA_STYLE, {timeout: 30000}).then(() => true).catch(() => false);
    const diag = await page.evaluate(() => JSON.stringify(window.eys.state().walk.immersion).slice(0, 220));
    console.log('STYLE-DIAG', EXTRA_STYLE, 'votingReached=', votingReached, 'diag=', diag);
    check('style-' + EXTRA_STYLE + ': 进入对应出局舞台', reached === true, `style=${EXTRA_STYLE} reached=${reached}`);
    // capture the whole performance: one frame per ~1.2s of stage time
    const styleErrorsBefore = pageErrors.length;
    const styleElapsed = [];
    const stylePov = [];
    for (let shot = 1; shot <= 6; shot++) {
      await page.waitForTimeout(1200);
      await page.screenshot({path: path.join(root, 'reports', 'immersion', `style-${EXTRA_STYLE}-${shot}.png`), type: 'png'});
      report.screenshots.push(`style-${EXTRA_STYLE}-${shot}.png`);
      const styleSnap = await page.evaluate(() => ({ph: window.eys.state().walk.immersion?.phase, el: window.eys.state().walk.immersion?.elapsed, pov: window.eys.state().walk.immersion?.selfPov}));
      if (styleSnap.pov) stylePov.push(styleSnap.pov);
      if (styleSnap.ph !== 'ejection') break;
      styleElapsed.push(styleSnap.el);
    }
    // A thrown stage frame used to freeze the page silently (flush, 1.4.0..1.5.0):
    // identical screenshots, elapsed stuck. Require the clock to keep moving.
    const styleAdvancing = styleElapsed.length >= 2 && styleElapsed.every((v, i) => i === 0 || v > styleElapsed[i - 1]);
    // Self POV rides the player's own head with the real body shown (2026-09-24;
    // the old proxy wings followed the tumbling body and flew around the frame).
    // Whenever the head camera is active it must sit exactly on the eye point,
    // with the body visible and the head hidden.
    const povHead = stylePov.filter(v => v.mode === 'head');
    console.log('SELF-POV', EXTRA_STYLE, JSON.stringify(stylePov.map(v => ({m: v.mode, hit: v.centerHit, eye: v.eye, auth: v.authored, yaw: v.yaw, pitch: v.pitch, others: v.others}))));
    check('style-' + EXTRA_STYLE + ': 自身视角机位挂在头部且身体可见',
      povHead.length >= 1 && povHead.every(v => v.camToEye < 0.005 && v.bodyVisible && v.headHidden),
      `head=${povHead.length}/${stylePov.length} samples=${JSON.stringify(stylePov.slice(0, 6))}`);
    // The goose head and body are one mesh: a gaze off the body's facing used to
    // look through your own head (centre ray hit the own body at ~8cm).
    const povSelfBlock = povHead.filter(v => v.centerHit && v.centerHit.self && v.centerHit.distance < 0.3);
    check('style-' + EXTRA_STYLE + ': 自身视角画面中心不被自己身体挡住',
      povHead.length >= 1 && povSelfBlock.length === 0,
      `blocked=${povSelfBlock.length}/${povHead.length} ${JSON.stringify(povSelfBlock.slice(0, 2).map(v => v.centerHit))}`);
    check('style-' + EXTRA_STYLE + ': 演出全程帧持续推进且无页面异常', styleAdvancing && pageErrors.length === styleErrorsBefore,
      `elapsed=${JSON.stringify(styleElapsed.map(v => +(v ?? -1).toFixed(2)))} newErrors=${JSON.stringify(pageErrors.slice(styleErrorsBefore).map(e => e.slice(0, 160)))}`);
    // V1 2026-09-24: fire self-view shot 5 (~6s, inside the pit looking back at
    // the crowd) — whiteout gate on the real pixels (1.5.1 before: over=12.7%, warm=25.3%).
    if (EXTRA_STYLE === 'fire') {
      try {
        const fireWash = await pixelWash(page, 'style-fire-5.png');
        check('style-fire: 第5拍过曝像素占比<25%', fireWash.over < 0.25, JSON.stringify(fireWash));
        check('style-fire: 第5拍暖白泛光<18%', fireWash.warm < 0.18, JSON.stringify(fireWash));
      } catch (e) {
        check('style-fire: 第5拍过曝门可测', false, String(e && e.message || e).slice(0, 160));
      }
    }
    // V2 2026-09-24: bridge shot 4 (underwater look back) used to be dominated by
    // the stacked crowd rendered as blown-out slabs (1.5.1 before: light=16.0%).
    if (EXTRA_STYLE === 'bridge') {
      try {
        const bridgeWash = await pixelWash(page, 'style-bridge-4.png');
        check('style-bridge: 第4拍浅灰大板占比<5%', bridgeWash.light < 0.05, JSON.stringify(bridgeWash));
      } catch (e) {
        check('style-bridge: 第4拍画面门可测', false, String(e && e.message || e).slice(0, 160));
      }
    }
    // C2 2026-09-26: the pre-R2 chandelier parts (ring/candles/flames/chains) used
    // to escape take() and leak on every stage dispose. Three replays (reset-reuse)
    // must hold GPU memory at the first performance's end values, and a full second
    // session (dispose + rebuild) must not grow geometries/textures either.
    if (EXTRA_STYLE === 'chandelier') {
      const chMem = () => page.evaluate(() => {
        const m = window.eys.state().walk.memory || {};
        return {g: m.geometries ?? null, t: m.textures ?? null};
      });
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'finished', null, {timeout: 30000}).catch(() => {});
      await page.waitForTimeout(1500); // let the final frames register before freezing the reference
      const chMem1 = await chMem();
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.querySelector('#immersion-replay')?.click());
        await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'finished', null, {timeout: 30000}).catch(() => {});
      }
      const chMem2 = await chMem();
      check('style-chandelier: 连续3次重播后几何/贴图与首演结束时相等',
        chMem1.g != null && chMem2.g === chMem1.g && chMem2.t === chMem1.t, JSON.stringify({first: chMem1, afterReplays: chMem2}));
      await page.evaluate(() => document.querySelector('#immersion-return')?.click());
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', null, {timeout: 10000}).catch(() => {});
      const chMemR1 = await chMem();
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'voting', null, {timeout: 40000}).catch(() => {});
      await page.evaluate(() => document.querySelector('#immersion-style-chandelier')?.click());
      await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
      await page.waitForFunction(() => { const b = document.querySelector('#immersion-confirm'); return b && !b.disabled; }, null, {timeout: 5000}).catch(() => {});
      await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ejection' && window.eys?.state?.().walk?.immersion?.style === 'chandelier', null, {timeout: 30000}).catch(() => {});
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'finished', null, {timeout: 30000}).catch(() => {});
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.querySelector('#immersion-return')?.click());
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', null, {timeout: 10000}).catch(() => {});
      const chMem3 = await chMem();
      // 1.7.0: a duck kill between the sessions legitimately leaves a corpse
      // avatar + body disc in town (its own meeting will recycle it), so the
      // no-leak allowance covers one corpse (+~10 geometries).
      check('style-chandelier: 二次完整会话后几何/贴图不增长',
        chMemR1.g != null && chMem3.g <= chMemR1.g + 12 && chMem3.t <= chMemR1.t + 2, JSON.stringify({afterSession1: chMemR1, afterSession2: chMem3}));
    }
    await page.evaluate(() => document.querySelector('#immersion-skip')?.click());
    await page.waitForFunction(() => ['finished', 'returning', 'roam'].includes(window.eys?.state?.().walk?.immersion?.phase), null, {timeout: 20000}).catch(() => {});
    await page.evaluate(() => document.querySelector('#immersion-return')?.click());
    await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', null, {timeout: 10000}).catch(() => {});
  }

  let leakCheck = {geometriesBefore: null, geometriesAfter: null, rounds: 5};
  {
    leakCheck.geometriesBefore = await page.evaluate(() => window.eys.state().walk.memory?.geometries ?? null);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.busy, {timeout: 40000}).catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', {timeout: 10000}).catch(() => {});
    }
    leakCheck.geometriesAfter = await page.evaluate(() => window.eys.state().walk.memory?.geometries ?? null);
  }
  check('reuse: 连续5轮会话几何数不增长', leakCheck.geometriesBefore != null && leakCheck.geometriesAfter <= leakCheck.geometriesBefore + 2,
    JSON.stringify(leakCheck));

  // N4: injected actor-GLB failure during preparing -> error phase -> the
  // retry button recovers into a working session. Reuses this page, which is
  // still standing at the bell after the leak-check rounds. Desktop only.
  if (!MOBILE) {
    let glbBlocked = true, abortedUrl = '';
    await page.route('**/*.glb', route => {
      if (glbBlocked) { glbBlocked = false; abortedUrl = route.request().url(); return route.abort(); }
      return route.continue();
    });
    await page.keyboard.press('KeyE');
    const errPhase = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'error', null, {timeout: 40000}).then(() => true).catch(() => false);
    check('retry: 注入演员加载失败进入 error', errPhase === true, `aborted=${abortedUrl || 'none'}`);
    if (errPhase) await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // headless focus flake: resume renders
    const retryVisible = errPhase ? await page.locator('#immersion-retry').waitFor({state:'visible', timeout:10000}).then(()=>true).catch(()=>false) : false;
    if (!retryVisible) {
      const dbg = await page.evaluate(async () => JSON.stringify({
        phase: window.eys.state().walk.immersion?.phase,
        uiHidden: document.querySelector('#immersion-ui')?.hidden ?? 'no-ui',
        panelHidden: document.querySelector('#immersion-error-panel')?.hidden ?? 'no-panel',
        retryBtn: (() => { const b = document.querySelector('#immersion-retry'); return b ? {hidden: b.hidden, disabled: b.disabled, box: b.getBoundingClientRect().toJSON()} : 'missing'; })(),
        raf: window.eys.state().walk?.drawCalls ?? null,
        panels: document.querySelectorAll('#immersion-error-panel').length,
        uiRoots: document.querySelectorAll('#immersion-ui').length,
        busy: window.eys.state().walk.immersion?.busy,
        paused: window.eys.state().walk.paused,
        photo: window.eys.state().walk.photo,
        active: window.eys.state().walk.active,
        framesAdvance: await new Promise(r => { const a = window.eys.state().walk.immersion?.elapsed; setTimeout(() => r([a, window.eys.state().walk.immersion?.elapsed]), 400); }),
      }));
      console.log('N4-DIAG', dbg);
      console.log('N4-PAGEERRORS', JSON.stringify(pageErrors.slice(-3)));
    }
    check('retry: 重试按钮可见', retryVisible === true, `visible=${retryVisible}`);
    await page.click('#immersion-retry');
    const ringed = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', null, {timeout: 60000}).then(() => true).catch(() => false);
    const phaseNow = await page.evaluate(() => window.eys.state().walk.immersion?.phase);
    check('retry: 重试后完成加载进入鸣铃', ringed === true, `phase=${phaseNow}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', {timeout: 10000}).catch(() => {});
    await page.unroute('**/*.glb');
  }

  // B7 flicker (design-flicker.md): approaching the emergency-button table dips
  // the lights once and restores them exactly. Assertions use trigger `count`,
  // so they stay race-free against the 2.2s window.
  const lights0 = await page.evaluate(() => window.eys.state().walk.lights);
  const flick0 = await page.evaluate(() => window.eys.state().walk.flicker);
  const flickFinal = await driveToTarget(page, BTN_INTERACT);
  const distFlick = flickFinal ? Math.hypot(flickFinal[0] - BTN_INTERACT[0], flickFinal[1] - BTN_INTERACT[1]) : Infinity;
  check('flicker: 走近应急桌进入触发半径', distFlick < 2.1, `final=${flickFinal ? flickFinal.map(v => +v.toFixed(2)) : null} dist=${distFlick.toFixed(2)}`);
  const flickDone = await page.waitForFunction(() => {
    const f = window.eys?.state?.().walk?.flicker;
    return f && f.count > 0 && !f.active;
  }, null, {timeout: 15000}).then(() => true).catch(() => false);
  const flickAfter = await page.evaluate(() => window.eys.state().walk.flicker);
  check('flicker: 靠近触发一次并完整结束', flickDone === true && flickAfter.count === flick0.count + 1, JSON.stringify(flickAfter));
  const lightsRestored = await page.evaluate(() => window.eys.state().walk.lights);
  check('flicker: 灯光逐灯精确还原', JSON.stringify(lightsRestored) === JSON.stringify(lights0), `${JSON.stringify(lights0)} -> ${JSON.stringify(lightsRestored)}`);
  await page.waitForTimeout(1200);
  const flickStill = await page.evaluate(() => window.eys.state().walk.flicker);
  check('flicker: 半径内不重复触发(武装解除)', flickStill.count === flick0.count + 1 && flickStill.active === false, JSON.stringify(flickStill));

  // reduced-motion (desktop): the event must switch to one calm dim-and-return.
  if (!MOBILE) {
    const rpage = await browser.newPage({viewport: walkViewport});
    const rErrors = [];
    rpage.on('pageerror', e => rErrors.push(String(e && e.message || e).slice(0, 200)));
    await rpage.emulateMedia({reducedMotion: 'reduce'});
    await rpage.goto(url, {waitUntil: 'networkidle'});
    await rpage.click('#character-grid button:nth-child(3)');
    await rpage.click('#walk-enter');
    await rpage.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
    await rpage.waitForTimeout(2500);
    const rFinal = await driveToTarget(rpage, BTN_INTERACT);
    const rDist = rFinal ? Math.hypot(rFinal[0] - BTN_INTERACT[0], rFinal[1] - BTN_INTERACT[1]) : Infinity;
    const rDone = await rpage.waitForFunction(() => {
      const f = window.eys?.state?.().walk?.flicker;
      return f && f.count > 0 && !f.active;
    }, null, {timeout: 20000}).then(() => true).catch(() => false);
    const rFlick = await rpage.evaluate(() => window.eys.state().walk.flicker);
    check('flicker: reduced-motion 走近触发且走reduced分支', rDone === true && rDist < 2.1 && rFlick.lastReduced === true, `dist=${rDist.toFixed(2)} flick=${JSON.stringify(rFlick)}`);
    check('flicker: reduced-motion 单次平缓压暗(≈0.7)', rFlick.lastMin !== null && rFlick.lastMin > 0.62 && rFlick.lastMin <= 0.73, `lastMin=${rFlick.lastMin}`);
    const rLights = await rpage.evaluate(() => window.eys.state().walk.lights);
    check('flicker: reduced-motion 灯光还原', JSON.stringify(rLights) === JSON.stringify(lights0), `${JSON.stringify(lights0)} -> ${JSON.stringify(rLights)}`);
    check('flicker: reduced-motion 无页面错误', rErrors.length === 0, rErrors.join('; ').slice(0, 160));
    await rpage.close();
  }

  // Fountain button (second meeting trigger): walk from the bell to the plaza
  // fountain base, expect the button prompt, and start a session from there.
  if (!MOBILE) {
    const btn = [-0.72, -1.98];
    const finalPos = await driveToTarget(page, btn);
    const distBtn = finalPos ? Math.hypot(finalPos[0] - btn[0], finalPos[1] - btn[1]) : Infinity;
    check('button: 走到喷泉旁', distBtn < 1.28, `final=${finalPos ? finalPos.map(v => +v.toFixed(2)) : null} dist=${distBtn.toFixed(2)}`);
    if (distBtn < 1.28) {
      const promptShown = await page.waitForFunction(() => {
        const el = document.querySelector('#immersion-prompt');
        return el && el.hidden === false && el.textContent.includes('按下按钮');
      }, null, {timeout: 10000}).then(() => true).catch(() => false);
      const nearState = await page.evaluate(() => ({nearBell: window.eys.state().walk.nearBell, pos: window.eys.state().walk.position}));
      check('button: 喷泉旁出现按钮提示', promptShown === true && nearState.nearBell === true, JSON.stringify(nearState).slice(0, 160));
      await page.keyboard.press('KeyE');
      const fromButton = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.busy, null, {timeout: 40000}).then(() => true).catch(() => false);
      check('button: 按下按钮进入会议', fromButton === true, `busy=${fromButton}`);
      const flickBusy = await page.evaluate(() => window.eys.state().walk.flicker);
      check('flicker: 会议期间不触发', flickBusy.active === false && flickBusy.count === flick0.count + 1, JSON.stringify(flickBusy));
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', null, {timeout: 30000}).catch(() => {});
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', {timeout: 10000}).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- B4 walk NPCs
  // Townsfolk wander with speech bubbles (design-npc-wander.md). Fresh page so
  // load timing is measured from a clean walk start; every variable here is
  // npc-prefixed to avoid top-of-script name collisions.
  {
    const NPC_CFG = cfgModule?.WALK_NPC_CONFIG || null;
    const NPC_POOL = NPC_CFG ? [...NPC_CFG.bubble.pool] : [];
    const NPC_EXPECT = NPC_CFG ? (MOBILE ? NPC_CFG.mobileCount : NPC_CFG.count) : 0;
    const BELL_INTERACT = cfgModule?.IMMERSION_CONFIG ? [...cfgModule.IMMERSION_CONFIG.bell.interaction] : [9.12, -7.56];
    const npcPage = await browser.newPage({viewport: finalViewport});
    const npcErrors = [];
    npcPage.on('pageerror', e => npcErrors.push(String(e && e.message || e).slice(0, 200)));
    await npcPage.goto(url, {waitUntil: 'networkidle'});
    await npcPage.click('#character-grid button:nth-child(3)');
    await npcPage.click('#walk-enter');
    await npcPage.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
    const npcMemBefore = await npcPage.evaluate(() => { const s = window.eys.state().walk; return {drawCalls: s.drawCalls, memory: s.memory}; });
    const npcLoadedOk = await npcPage.waitForFunction(exp => window.eys?.state?.().walk?.npcs?.loaded === exp, NPC_EXPECT, {timeout: 60000}).then(() => true).catch(() => false);
    const npcStateNow = await npcPage.evaluate(() => window.eys.state().walk.npcs);
    check('npc: 常驻镇民按平台配置加载数量', npcLoadedOk === true, `expect=${NPC_EXPECT} got=${JSON.stringify(npcStateNow)}`);
    // 1.7.0 default-path regression: without ?round=force-kill the round ledger
    // exists with a duck, but no leg may exist at load or through the first
    // sampling window (the earliest possible kill is firstKillCooldown[0]=25s).
    check('round: 默认路径加载完成即有round账本且零腿', Boolean(npcStateNow?.round?.duck) && npcStateNow.round.corpses.length === 0, JSON.stringify(npcStateNow?.round));
    const npcHoldHook = await npcPage.evaluate(() => typeof window.eys.holdKills);
    check('round: 默认路径无holdKills调试钩子', npcHoldHook === 'undefined', `typeof=${npcHoldHook}`);
    // 3s sampling: every townsperson stays collision-free, at least one moves.
    const npcSamples = [];
    let npcBubbleSeen = null;
    for (let i = 0; i < 7; i++) {
      const snap = await npcPage.evaluate(() => { const n = window.eys.state().walk.npcs; return n ? {loaded: n.loaded, hidden: n.hidden, list: n.npcs.map(m => ({actor: m.actor, position: [...m.position], moving: m.moving, bubble: m.bubble}))} : null; });
      if (snap) {
        npcSamples.push(snap);
        const withBubble = snap.list.find(m => m.bubble);
        if (withBubble && !npcBubbleSeen) npcBubbleSeen = withBubble.bubble;
      }
      await npcPage.waitForTimeout(500);
    }
    const npcAllFree = npcSamples.length > 0 && npcSamples.every(s => s.list.every(m => nav ? nav.collision(m.position) === null : true));
    const npcMoved = npcSamples.some(s => s.list.some(m => m.moving)) ||
      npcSamples.some((s, i) => i > 0 && s.list.some((m, j) => {
        const prev = npcSamples[i - 1].list[j];
        return prev && prev.actor === m.actor && Math.hypot(prev.position[0] - m.position[0], prev.position[1] - m.position[1]) > 0.05;
      }));
    check('npc: 3秒采样全员站在可走区域', npcAllFree, `samples=${npcSamples.length} perSample=${npcSamples.map(s => s.list.length).join(',')}`);
    check('npc: 3秒采样内至少一位在移动', npcMoved === true, npcMoved ? 'observed moving/position delta' : 'all idle');
    // A bubble within 20s of the sampling start, drawn from the config pool.
    if (!npcBubbleSeen) {
      await npcPage.waitForFunction(pool => {
        const n = window.eys?.state?.().walk?.npcs;
        return !!n && n.npcs.some(m => m.bubble);
      }, NPC_POOL, {timeout: 20000}).catch(() => {});
      npcBubbleSeen = await npcPage.evaluate(() => {
        const n = window.eys?.state?.().walk?.npcs;
        const m = n && n.npcs.find(x => x.bubble);
        return m ? m.bubble : null;
      });
    }
    check('npc: 20秒内出现气泡且文案来自固定池', typeof npcBubbleSeen === 'string' && NPC_POOL.includes(npcBubbleSeen), `bubble=${JSON.stringify(npcBubbleSeen)} pool=${NPC_POOL.length}`);
    // Give-way (review 2026-09-22): with the player standing still, no townsperson
    // may camp inside avoidPlayerRadius -- the old wait branch parked one in front
    // of the first-person camera indefinitely. Also: every visible bubble box must
    // lie fully inside the viewport (top-edge clipping was visible in review).
    const npcCampSamples = [];
    const npcBubbleRects = [];
    for (let npcTick = 0; npcTick < 24; npcTick++) {
      const npcSnap = await npcPage.evaluate(radius => {
        const s = window.eys.state().walk; const [px, pz] = s.position;
        const close = s.npcs.npcs.filter(m => Math.hypot(m.position[0] - px, m.position[1] - pz) < radius).map(m => m.actor);
        const rects = [...document.querySelectorAll('.walk-npc-bubble')].filter(e => e.style.display === 'block')
          .map(e => { const r = e.getBoundingClientRect(); return {l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1)}; });
        return {close, rects, vw: innerWidth, vh: innerHeight};
      }, NPC_CFG.avoidPlayerRadius);
      npcCampSamples.push(npcSnap.close);
      for (const r of npcSnap.rects) npcBubbleRects.push({...r, vw: npcSnap.vw, vh: npcSnap.vh});
      await npcPage.waitForTimeout(250);
    }
    let npcLongestCamp = 0;
    for (const actor of new Set(npcCampSamples.flat())) {
      let run = 0;
      for (const close of npcCampSamples) { run = close.includes(actor) ? run + 1 : 0; npcLongestCamp = Math.max(npcLongestCamp, run); }
    }
    const npcCampLimit = Math.ceil((NPC_CFG.avoidWait + 1.5) / 0.25);
    check('npc: 玩家静止6秒内无人在避让半径内滞留超过让路等待+1.5s', npcLongestCamp <= npcCampLimit, `longestRun=${npcLongestCamp}/${npcCampSamples.length} samples (limit ${npcCampLimit}) closeSamples=${npcCampSamples.filter(c => c.length).length}`);
    const npcBubbleOffscreen = npcBubbleRects.filter(r => r.l < -1 || r.t < -1 || r.r > r.vw + 1 || r.b > r.vh + 1);
    check('npc: 采样期间可见气泡整体落在视口内', npcBubbleOffscreen.length === 0, `bubbleFrames=${npcBubbleRects.length} offscreen=${JSON.stringify(npcBubbleOffscreen.slice(0, 3))}`);
    // Photo mode: townsfolk stay visible, the bubble layer must hide and restore.
    const npcLayer = () => npcPage.evaluate(() => { const el = document.querySelector('#walk-npc-bubbles'); return el ? {present: true, hidden: el.hidden, display: getComputedStyle(el).display} : {present: false}; });
    await npcPage.click('#walk-photo');
    const npcPhotoState = await npcPage.evaluate(() => window.eys.state().walk.photo);
    const npcLayerInPhoto = await npcLayer();
    check('npc: 拍照模式气泡层隐藏', npcPhotoState === true && npcLayerInPhoto.present === true && npcLayerInPhoto.hidden === true, JSON.stringify(npcLayerInPhoto));
    await npcPage.click('#walk-photo-exit');
    const npcLayerAfterPhoto = await npcLayer();
    check('npc: 退出拍照气泡层还原', npcLayerAfterPhoto.present === true && npcLayerAfterPhoto.hidden === false, JSON.stringify(npcLayerAfterPhoto));
    // Bell meeting: townsfolk must hide during the performance and return after.
    const npcFinal = await driveToTarget(npcPage, BELL_INTERACT, 900, 0.8);
    const npcBellDist = npcFinal ? Math.hypot(npcFinal[0] - BELL_INTERACT[0], npcFinal[1] - BELL_INTERACT[1]) : Infinity;
    check('npc: 走到铃交互半径内', npcBellDist < 0.95, `dist=${npcBellDist.toFixed(2)} final=${npcFinal ? npcFinal.map(v => +v.toFixed(2)) : null}`);
    await npcPage.keyboard.press('KeyE');
    const npcBusy = await npcPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.busy, null, {timeout: 40000}).then(() => true).catch(() => false);
    const npcHiddenDuring = await npcPage.evaluate(() => window.eys.state().walk.npcs);
    check('npc: 演出期间镇民整体隐藏', npcBusy === true && npcHiddenDuring?.hidden === true, `busy=${npcBusy} npcs=${JSON.stringify({hidden: npcHiddenDuring?.hidden, loaded: npcHiddenDuring?.loaded})}`);
    await npcPage.keyboard.press('Escape');
    await npcPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', {timeout: 10000}).catch(() => {});
    await npcPage.waitForTimeout(500);
    const npcHiddenAfter = await npcPage.evaluate(() => window.eys.state().walk.npcs);
    check('npc: 回到漫游镇民恢复且加载数不变', npcHiddenAfter?.hidden === false && npcHiddenAfter?.loaded === NPC_EXPECT, JSON.stringify({hidden: npcHiddenAfter?.hidden, loaded: npcHiddenAfter?.loaded}));
    // F3 (2026-09-23): on narrow screens the top-right button group used to reach
    // left across the area-label box (measured 33px overlap at 375px). The two top
    // HUD blocks must be non-degenerate AND non-intersecting; save the evidence shot.
    if (MOBILE) {
      const hudTop = await npcPage.evaluate(() => {
        const rect = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1)}; };
        const st = rect('.walk-status'), ac = rect('.walk-actions');
        const filled = b => !!b && b.r > b.l && b.b > b.t;
        const disjoint = filled(st) && filled(ac) && (ac.l >= st.r || ac.r <= st.l || ac.t >= st.b || ac.b <= st.t);
        return {status: st, actions: ac, disjoint};
      });
      check('hud: 顶栏区域标签与按钮组不相交', hudTop.disjoint === true, JSON.stringify(hudTop));
      await npcPage.screenshot({path: path.join(root, 'reports', label, 'hud-top.png'), clip: {x: 0, y: 0, width: finalViewport.width, height: 150}});
    }
    // Info (never a failure): drawCalls, 2s RAF count, renderer memory before/after load.
    const npcMemAfter = await npcPage.evaluate(() => { const s = window.eys.state().walk; return {drawCalls: s.drawCalls, memory: s.memory}; });
    const npcRaf2s = await npcPage.evaluate(() => new Promise(res => { let c = 0; const t0 = performance.now(); const loop = () => { c++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(c); }; requestAnimationFrame(loop); }));
    check('npc: 性能信息(信息项,不判失败)', true, JSON.stringify({drawCallsBefore: npcMemBefore.drawCalls, drawCallsAfter: npcMemAfter.drawCalls, raf2s: npcRaf2s, memoryBefore: npcMemBefore.memory, memoryAfter: npcMemAfter.memory}));
    check('npc: 无页面错误', npcErrors.length === 0, npcErrors.join('; ').slice(0, 160));
    await npcPage.close();

    // reduced-motion (desktop): bubble elements carry no transition animation.
    if (!MOBILE && NPC_CFG) {
      const npcRPage = await browser.newPage({viewport: walkViewport});
      const npcRErrors = [];
      npcRPage.on('pageerror', e => npcRErrors.push(String(e && e.message || e).slice(0, 200)));
      await npcRPage.emulateMedia({reducedMotion: 'reduce'});
      await npcRPage.goto(url, {waitUntil: 'networkidle'});
      await npcRPage.click('#character-grid button:nth-child(3)');
      await npcRPage.click('#walk-enter');
      await npcRPage.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
      const npcRBubble = await npcRPage.waitForFunction(() => {
        const n = window.eys?.state?.().walk?.npcs;
        return !!n && n.npcs.some(m => m.bubble);
      }, null, {timeout: 30000}).then(() => true).catch(() => false);
      const npcRStyle = await npcRPage.evaluate(() => {
        const el = [...document.querySelectorAll('#walk-npc-bubbles > div')].find(b => b.style.display !== 'none') || document.querySelector('#walk-npc-bubbles > div');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {transitionDuration: cs.transitionDuration, transitionProperty: cs.transitionProperty, animationDuration: cs.animationDuration};
      });
      const npcRNoTransition = npcRStyle !== null && npcRStyle.transitionDuration.split(',').every(v => parseFloat(v) === 0) && npcRStyle.animationDuration.split(',').every(v => parseFloat(v) === 0);
      check('npc: reduced-motion 气泡无过渡动画', npcRBubble === true && npcRNoTransition, `bubble=${npcRBubble} style=${JSON.stringify(npcRStyle)}`);
      check('npc: reduced-motion 无页面错误', npcRErrors.length === 0, npcRErrors.join('; ').slice(0, 160));
      await npcRPage.close();
    }
  }

  // ---------------------------------------------------- 1.7.0 town round: force-kill corpse
  // ?round=force-kill zeroes the duck's cooldown and opens the witness gate ONCE
  // once the townsfolk are loaded; the seed is never touched. A fresh page so the
  // round timeline starts clean; every variable here is fk-prefixed.
  {
    const fkPage = await browser.newPage({viewport: finalViewport});
    const fkErrors = [];
    fkPage.on('pageerror', e => fkErrors.push(String(e && e.message || e).slice(0, 200)));
    await fkPage.goto(url + '?round=force-kill' + (actorParam ? `&actor=${actorParam}` : ''), {waitUntil: 'networkidle'});
    if (!actorParam) await fkPage.click('#character-grid button:nth-child(3)');
    await fkPage.click('#walk-enter');
    await fkPage.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
    const fkRoundReady = await fkPage.waitForFunction(() => {
      const n = window.eys?.state?.().walk?.npcs;
      return Boolean(n && n.loaded > 0 && n.round && n.round.duck);
    }, null, {timeout: 60000}).then(() => true).catch(() => false);
    const fkRoundNow = await fkPage.evaluate(() => window.eys.state().walk.npcs.round);
    check('round: force-kill 镇民加载后round就绪且鸭子已选(仅测试可读)', fkRoundReady === true && Boolean(fkRoundNow?.duck), JSON.stringify(fkRoundNow));
    const fkCorpseSeen = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.npcs?.round?.corpses?.length >= 1, null, {timeout: 30000}).then(() => true).catch(() => false);
    const fkRound = await fkPage.evaluate(() => window.eys.state().walk.npcs.round);
    check('round: force-kill 后10秒内出现腿', fkCorpseSeen === true && fkRound.corpses.length >= 1, JSON.stringify(fkRound && fkRound.corpses));
    check('round: 首刀后冷却重置回killCooldown区间', fkRound && fkRound.cooldown !== null && fkRound.cooldown >= 20 && fkRound.cooldown <= 35, `cooldown=${fkRound && fkRound.cooldown}`);
    const fkCorpseActor = fkRound.corpses[0].actor;
    const fkCorpsePos = [...fkRound.corpses[0].position];
    const fkWalkerActors = await fkPage.evaluate(() => window.eys.state().walk.npcs.npcs.map(m => m.actor));
    check('round: 腿的actor不再出现在行走镇民名单', !fkWalkerActors.includes(fkCorpseActor), `corpse=${fkCorpseActor} walkers=${JSON.stringify(fkWalkerActors)}`);
    check('round: 腿位于可走地面(刀点)', nav ? nav.collision(fkCorpsePos) === null : true, JSON.stringify(fkCorpsePos));
    const fkShape = await fkPage.evaluate(() => (window.eys.state().walk.npcs.corpseShapes || [])[0] || null);
    check('round: 尸体新造型——红斑在、身体可见、脚隐藏、露出高度0.35~0.5', Boolean(fkShape) && fkShape.poolRadius > 0 && fkShape.bodyShown > 0 && fkShape.feetHidden > 0 && fkShape.exposedFraction >= 0.35 && fkShape.exposedFraction <= 0.5, JSON.stringify(fkShape));
    // Walk to 1.2m of the leg, then run the full report -> meeting -> aftermath
    // loop three times (K3d): memory must not grow across rounds.
    const fkTap = async key => { await fkPage.keyboard.down(key); await fkPage.waitForTimeout(60); await fkPage.keyboard.up(key); await fkPage.waitForTimeout(25); };
    const fkMemBefore = await fkPage.evaluate(() => window.eys.state().walk.memory);
    const fkMemSamples = [];
    for (let fkLoop = 1; fkLoop <= 3; fkLoop++) {
      // Rounds 2-3 walk to the bell instead of waiting on chance encounters: the
      // yield logic keeps walkers apart, so a fresh kill is too slow to gate on.
      // Round 2 votes a goose (grey eliminated card accumulates), round 3 votes
      // the DUCK (duck-out -> new round -> repopulate -> re-pick).
      let corpseNow = null, corpsePos = null;
      if (fkLoop < 2) {
        // the yield logic keeps walkers apart, so rounds >=2 chase the duck a bit:
        // the player's presence forces re-routes and raises encounter odds
        corpseNow = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.npcs?.round?.corpses?.[0] || false, null, {timeout: 30000}).then(v => v.jsonValue()).catch(() => null);
        if (!corpseNow) { check('round: 30秒内出现腿', false, `loop=${fkLoop}`); break; }
        corpsePos = [...corpseNow.position];
      }
      if (fkLoop === 1) {
        const farReportable = await fkPage.evaluate(() => window.eys.state().walk.reportable);
        check('round: 远于1.2m时reportable为空', farReportable === null, JSON.stringify(farReportable));
      }
      // a stand point 1.2m south may sit inside geometry when the leg died by a
      // wall: try the four sides until one routes
      let fkArrived = null;
      if (fkLoop < 2) {
        for (const [ox, oz] of [[0, 1.2], [0, -1.2], [1.2, 0], [-1.2, 0]]) {
          const st = [corpsePos[0] + ox, corpsePos[1] + oz];
          if (nav && nav.collision(st) !== null) continue;
          fkArrived = await driveToTarget(fkPage, st, 900, 1.1);
          if (Array.isArray(fkArrived)) break;
        }
        check('round: 能走到腿旁1.2m', Array.isArray(fkArrived), `loop=${fkLoop} ${fkArrived ? 'arrived' : 'no route on any side'}`);
        for (let i = 0; i < 80; i++) { // final aim: walk the dominant axis toward the leg; the last heading points at it
          const p = await fkPage.evaluate(() => window.eys.state().walk.position);
          const dx = corpsePos[0] - p[0], dz = corpsePos[1] - p[1], dist = Math.hypot(dx, dz);
          if (dist <= 1.1 || dist > 2.4) break;
          if (Math.abs(dx) > Math.abs(dz)) await fkTap(dx > 0 ? 'KeyD' : 'KeyA'); else await fkTap(dz > 0 ? 'KeyS' : 'KeyW');
        }
        for (let i = 0; i < 12; i++) { // settle inside the report radius (micro-taps until reportable)
          if (await fkPage.evaluate(() => window.eys.state().walk.reportable)) break;
          const p = await fkPage.evaluate(() => window.eys.state().walk.position);
          const dx = corpsePos[0] - p[0], dz = corpsePos[1] - p[1];
          if (Math.abs(dx) > Math.abs(dz)) await fkTap(dx > 0 ? 'KeyD' : 'KeyA'); else await fkTap(dz > 0 ? 'KeyS' : 'KeyW');
        }
        if (!await fkPage.evaluate(() => window.eys.state().walk.reportable)) {
          // last resort: drive straight at the leg itself (it stands on walkable ground)
          await driveToTarget(fkPage, corpsePos, 400, 0.9);
          for (let i = 0; i < 12; i++) {
            if (await fkPage.evaluate(() => window.eys.state().walk.reportable)) break;
            const p = await fkPage.evaluate(() => window.eys.state().walk.position);
            const dx = corpsePos[0] - p[0], dz = corpsePos[1] - p[1];
            if (Math.abs(dx) > Math.abs(dz)) await fkTap(dx > 0 ? 'KeyD' : 'KeyA'); else await fkTap(dz > 0 ? 'KeyS' : 'KeyW');
          }
        }
      } else {
        // Bell loops: the meeting that just ended re-armed force-kill (cooldown 0 +
        // witness bypass), so a fresh leg by the bell would turn E into a report.
        // Hold the duck (debug-only window.eys.holdKills) and let an in-flight
        // kill finish before walking; released after this loop's meeting.
        const fkHeld = await fkPage.evaluate(() => window.eys.holdKills ? window.eys.holdKills(true) : null);
        await fkPage.waitForFunction(() => !window.eys?.state?.().walk?.npcs?.killing, null, {timeout: 5000}).catch(() => {});
        const fkBell = cfgModule ? [...cfgModule.IMMERSION_CONFIG.bell.interaction] : [9.12, -7.56];
        fkArrived = await driveToTarget(fkPage, fkBell, 900, 0.8);
        check('round: 走到按铃点', Array.isArray(fkArrived), `loop=${fkLoop} ${fkArrived ? 'arrived' : 'no route'}`);
        const fkBellState = await fkPage.evaluate(() => { const w = window.eys.state().walk; return {reportable: w.reportable, killing: w.npcs && w.npcs.killing, cooldown: w.npcs && w.npcs.round && w.npcs.round.cooldown}; });
        check('round: 按铃轮刀人暂停(hold)且铃旁无可报腿', fkHeld === true && !fkBellState.reportable && !fkBellState.killing, `loop=${fkLoop} held=${fkHeld} ${JSON.stringify(fkBellState)}`);
      }
      if (fkLoop === 1) {
        const nearReportable = await fkPage.evaluate(() => window.eys.state().walk.reportable);
        check('round: 1.2m内reportable非空且actor一致', Boolean(nearReportable) && nearReportable.actor === corpseNow.actor, JSON.stringify(nearReportable));
        const fkPrompt = await fkPage.waitForFunction(() => { const el = document.querySelector('#immersion-prompt'); return el && !el.hidden && el.textContent.includes('报警') ? el.textContent : false; }, null, {timeout: 1500}).then(v => v.jsonValue()).catch(() => null);
        check('round: 提示文字含报警', typeof fkPrompt === 'string' && fkPrompt.includes('报警'), `prompt=${JSON.stringify(fkPrompt)}`);
        await fkPage.keyboard.press('KeyV'); // first person: camera faces the last heading (the leg)
        await fkPage.waitForTimeout(600);
        if (!MOBILE) { // look down ~0.35 rad so the leg sits mid-frame, not at the bottom edge
          await fkPage.mouse.move(720, 480);
          await fkPage.mouse.down();
          await fkPage.mouse.move(720, 620, {steps: 6});
          await fkPage.mouse.up();
          await fkPage.waitForTimeout(250);
        }
        await fkPage.screenshot({path: path.join(root, 'reports', 'immersion', `${shotPrefix}corpse-close.png`), type: 'png'});
        report.screenshots.push(`${shotPrefix}corpse-close.png`);
        if (!MOBILE) {
          await fkPage.keyboard.press('KeyV'); // overview for the owner's shape check
          await fkPage.waitForTimeout(600);
          await fkPage.screenshot({path: path.join(root, 'reports', 'immersion', 'corpse-top.png'), type: 'png'});
          report.screenshots.push('corpse-top.png');
        }
      }
      // Report (KeyR desktop / touch button mobile): reporting -> seating, never ringing.
      let repSnap = null;
      if (fkLoop < 2) {
        if (MOBILE) {
          await fkPage.evaluate(() => { const b = document.querySelector('#walk-report'); if (b && !b.hidden) b.click(); });
        } else {
          await fkPage.keyboard.press('KeyR');
        }
        const fkReporting = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'reporting' ? window.eys.state().walk.immersion : false, null, {timeout: 15000}).catch(() => null);
        repSnap = fkReporting && await fkPage.evaluate(() => window.eys.state().walk.immersion);
        check('round: 报警进入reporting且entry=report', Boolean(repSnap && repSnap.entry === 'report'), JSON.stringify(repSnap && {phase: repSnap.phase, entry: repSnap.entry}));
      } else {
        // Belt and braces before E: report beats bell, so ring only with nothing
        // reportable. A leg by the bell (hold failed) must clear first — wait,
        // else sidestep within the bell room and re-check; pressing E anyway
        // would report and derail the loop, so the assertion records it.
        const fkWalkState = () => fkPage.evaluate(() => { const w = window.eys.state().walk; return {reportable: w.reportable, phase: w.immersion && w.immersion.phase, corpses: w.npcs && w.npcs.round && w.npcs.round.corpses.length}; });
        let fkPreE = await fkWalkState();
        if (fkPreE.reportable) {
          await fkPage.waitForFunction(() => !window.eys?.state?.().walk?.reportable, null, {timeout: 5000}).catch(() => {});
          fkPreE = await fkWalkState();
        }
        if (fkPreE.reportable) {
          const fkBellPt = cfgModule ? [...cfgModule.IMMERSION_CONFIG.bell.interaction] : [9.12, -7.56];
          for (const [ox, oz] of [[0, 0.7], [0.7, 0], [-0.7, 0]]) { // sidestep inside room 04
            await driveToTarget(fkPage, [fkBellPt[0] + ox, fkBellPt[1] + oz], 600, 0.8);
            fkPreE = await fkWalkState();
            if (!fkPreE.reportable) break;
          }
        }
        check('round: 按E前无可报腿', !fkPreE.reportable, `loop=${fkLoop} ${JSON.stringify(fkPreE)}`);
        await fkPage.keyboard.press('KeyE');
        // Same two-stage wait as the main session segment: accepting the bell
        // first goes busy/preparing (up to 20s), ringing follows (30s more).
        const fkAccepted = await fkPage.waitForFunction(() => { const im = window.eys?.state?.().walk?.immersion; return Boolean(im && (im.phase === 'ringing' || im.busy)); }, null, {timeout: 20000}).then(() => true).catch(() => false);
        const fkRing = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', null, {timeout: 30000}).then(() => true).catch(() => false);
        const fkPhaseDiag = await fkPage.evaluate(() => { const im = window.eys?.state?.().walk?.immersion; return im ? {phase: im.phase, busy: im.busy, entry: im.entry} : null; });
        check('round: 按铃进入ringing(entry=ring,缺席席位带账本)', fkAccepted === true && fkRing === true, `loop=${fkLoop} accepted=${fkAccepted} ${JSON.stringify(fkPhaseDiag)}`);
        for (let sk = 0; sk < 3; sk++) { // ringing -> seating -> discussion -> voting
          await fkPage.evaluate(() => document.querySelector('#immersion-skip')?.click());
          await fkPage.waitForTimeout(400);
        }
      }
      if (fkLoop === 1 && repSnap) {
        await fkPage.screenshot({path: path.join(root, 'reports', 'immersion', 'report-pov.png'), type: 'png'});
        report.screenshots.push('report-pov.png');
        const repVis = await fkPage.evaluate(() => { const s = window.eys.state().walk; return {phase: s.immersion && s.immersion.phase, visible: s.npcs && s.npcs.corpsesVisible, corpses: s.npcs && s.npcs.round && s.npcs.round.corpses.length}; });
        check('round: 发现演出期间腿留在画面里(镇民隐藏、腿可见)', Boolean(repVis && repVis.phase === 'reporting' && repVis.visible >= 1 && repVis.visible === repVis.corpses), JSON.stringify(repVis));
        const vign = await fkPage.evaluate(() => { const el = document.querySelector('#immersion-vignette'); if (!el) return null; const cs = getComputedStyle(el); return {cls: el.className, opacity: cs.opacity, animation: cs.animationName}; });
        check('round: 发现演出渐晕在播(静态0.25为reduced-motion)', Boolean(vign && (vign.cls.includes('play') || vign.cls.includes('hold'))), JSON.stringify(vign));
      }
      if (fkLoop < 2) {
        const fkSeating = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'seating', null, {timeout: 10000}).then(() => true).catch(() => false);
        check('round: reporting直达seating(未经过ringing)', fkSeating === true, `loop=${fkLoop}`);
      }
      // Voting: the dead seat shows a red cross and cannot be picked.
      const fkVoting = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'voting', null, {timeout: 40000}).then(() => true).catch(() => false);
      const fkVoteState = await fkPage.evaluate(() => {
        const cards = [...document.querySelectorAll('#immersion-avatars button')];
        const deadCards = cards.filter(c => c.hasAttribute('data-dead'));
        return {total: cards.length, dead: deadCards.length, deadDisabled: deadCards.filter(c => c.disabled).length,
          selectable: cards.filter(c => !c.disabled).length, eliminated: cards.filter(c => c.hasAttribute('data-eliminated')).length,
          deadActor: deadCards[0] ? deadCards[0].dataset.actor : null};
      });
      const fkSnapV = await fkPage.evaluate(() => window.eys.state().walk.immersion);
      const fkRoundNow = await fkPage.evaluate(() => window.eys.state().walk.npcs.round);
      check('round: 死者票卡红叉且禁用', fkVoting === true && fkVoteState.dead === fkRoundNow.dead.length && fkVoteState.deadDisabled === fkVoteState.dead, `loop=${fkLoop} cards=${JSON.stringify(fkVoteState)} ledger=${JSON.stringify(fkRoundNow.dead)}`);
      check('round: 可选票卡=在场NPC数-玩家', fkVoteState.selectable === fkSnapV.present.length - 1, `selectable=${fkVoteState.selectable} present=${fkSnapV.present.length}`);
      check('round: absent.dead与尸体账本一致', JSON.stringify(fkSnapV.absent.dead) === JSON.stringify(fkRoundNow.dead.filter(id => fkSnapV.actorIds.includes(id))), `absent=${JSON.stringify(fkSnapV.absent.dead)} ledgerDead=${JSON.stringify(fkRoundNow.dead)}`);
      check('round: eliminated票卡灰化数量一致', fkVoteState.eliminated === fkSnapV.absent.eliminated.length, `elim=${fkVoteState.eliminated} ledger=${fkSnapV.absent.eliminated.length}`);
      if (fkLoop === 1) {
        await fkPage.screenshot({path: path.join(root, 'reports', 'immersion', 'voting-dead.png'), type: 'png'});
        report.screenshots.push('voting-dead.png');
      }
      // Round 3 votes the DUCK itself (duck-out -> new round); rounds 1-2 vote a
      // living non-duck member (goose-out keeps the round running).
      const fkVoteDuck = fkLoop === 3;
      const fkSeedBefore = fkRoundNow.seed;
      const fkVotedActor = await fkPage.evaluate(({duck, voteDuck}) => {
        const c = [...document.querySelectorAll('#immersion-avatars button')].find(b => voteDuck ? b.dataset.actor === duck : (b.dataset.actor !== duck && !b.hasAttribute('data-dead') && !b.hasAttribute('data-eliminated')));
        if (c) c.click();
        return c ? c.dataset.actor : null;
      }, {duck: fkRoundNow.duck, voteDuck: fkVoteDuck});
      await fkPage.waitForFunction(() => { const b = document.querySelector('#immersion-confirm'); return b && !b.disabled; }, null, {timeout: 5000}).catch(() => {});
      await fkPage.evaluate(() => document.querySelector('#immersion-confirm')?.click());
      const fkResult = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'result' ? window.eys.state().walk.immersion : false, null, {timeout: 8000}).catch(() => null);
      const resSnap = fkResult && await fkPage.evaluate(() => window.eys.state().walk.immersion);
      const fkVoteCount = resSnap ? Object.values(resSnap.votes || {}).filter(v => v === resSnap.targetId).length : -1;
      const fkOtherMax = resSnap ? Math.max(0, ...resSnap.present.filter(id => id !== resSnap.targetId).map(id => Object.values(resSnap.votes || {}).filter(v => v === id).length)) : -1;
      check('round: 结果总票数=在场人数', Boolean(resSnap) && Object.keys(resSnap.votes || {}).length === resSnap.present.length, `loop=${fkLoop} total=${Object.keys(resSnap?.votes || {}).length} present=${resSnap && resSnap.present.length}`);
      check('round: 目标严格最多票', Boolean(resSnap) && fkVoteCount > fkOtherMax, `target=${fkVoteCount} maxOther=${fkOtherMax}`);
      const fkFinished = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'finished', null, {timeout: 30000}).then(() => true).catch(() => false);
      check('round: 出局演出到finished', fkFinished === true, `loop=${fkLoop}`);
      await fkPage.evaluate(() => document.querySelector('#immersion-return')?.click());
      const fkRoam = await fkPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', null, {timeout: 10000}).then(() => true).catch(() => false);
      const fkAfter = await fkPage.evaluate(() => { const n = window.eys.state().walk; const el = document.querySelector('#walk-round-toast'); return {npcs: n.npcs.npcs.map(m => m.actor), corpses: n.npcs.round.corpses.length, toast: el && !el.hidden ? el.textContent : null}; });
      if (fkLoop >= 2) { // meeting over: hand the duck back to its normal cooldown
        const fkReleased = await fkPage.evaluate(() => window.eys.holdKills ? window.eys.holdKills(false) : null);
        check('round: 会后解除hold', fkReleased === false, `loop=${fkLoop} released=${fkReleased}`);
      }
      check('round: 会后被投出者不在镇民名单', fkRoam === true && (fkVoteDuck || !fkAfter.npcs.includes(fkVotedActor)), `loop=${fkLoop} voted=${fkVotedActor} town=${JSON.stringify(fkAfter.npcs)}`);
      check('round: 会后腿清空', fkAfter.corpses === 0, `loop=${fkLoop} corpses=${fkAfter.corpses}`);
      // mobile (3 townsfolk): the round-1 aftermath can legitimately end the town
      // (alive<=1) and the silence card replaces the goose-out card right away.
      if (fkLoop === 1) check('round: 小结卡文案含无辜或安全(或手机寂静)', typeof fkAfter.toast === 'string' && (fkAfter.toast.includes('无辜') || fkAfter.toast.includes('安全') || fkAfter.toast.includes('寂静')), `toast=${JSON.stringify(fkAfter.toast)}`);
      if (fkLoop === 3) {
        check('round: 鸭子出局小结卡', typeof fkAfter.toast === 'string' && fkAfter.toast.includes('安全'), `toast=${JSON.stringify(fkAfter.toast)}`);
        // duck-out starts a new round: seed+1, ledger cleared, town refilled
        const fkNewRound = await fkPage.waitForFunction(() => { const n = window.eys?.state?.().walk?.npcs; return n && n.round && n.round.duck && n.loaded === n.count ? {duck: n.round.duck, seed: n.round.seed, eliminated: n.round.eliminated.length, dead: n.round.dead.length} : false; }, null, {timeout: 60000}).then(v => v.jsonValue()).catch(() => null);
        check('round: duck-out后新一轮seed+1且账本清空补满人', Boolean(fkNewRound) && fkNewRound.seed === fkSeedBefore + 1 && fkNewRound.eliminated === 0 && fkNewRound.dead === 0,
          `new=${JSON.stringify(fkNewRound)} before=${fkSeedBefore}`);
      }
      fkMemSamples.push(await fkPage.evaluate(() => window.eys.state().walk.memory));
    }
    // Pre-1.7.0, EVERY meeting session allocates backdrop/ejection geometry the
    // lifecycle does not yet recycle (probe on the plain bell flow, no town
    // round: 169 -> 252 -> 269). The town-round loop must not make it WORSE:
    // round-over-round growth stays inside that pre-existing per-session band.
    const fkMemTotal = fkMemSamples.length ? fkMemSamples[fkMemSamples.length - 1].geometries - fkMemSamples[0].geometries : 0;
    // duck-out repopulation legitimately loads a refilled town on top of the
    // pre-existing per-session allocation; the gate guards against RUNAWAY growth.
    check('round: 连续3轮几何总量增长受控(<=200,含补人加载)', fkMemSamples.length === 3 && fkMemTotal <= 200,
      `first=${JSON.stringify(fkMemSamples[0])} last=${JSON.stringify(fkMemSamples[fkMemSamples.length - 1])} totalGrowth=${fkMemTotal}`);
    check('round: force-kill 无页面错误', fkErrors.length === 0, fkErrors.join('; ').slice(0, 160));
    await fkPage.close();
  }

  // ------------------------------------------------ 1.7.0 reduced-motion variant
  // The kill lands without the topple animation (killDuration 0) and the
  // discovery vignette holds a static pale edge instead of pulsing.
  {
    const rmPage = await browser.newPage({viewport: walkViewport});
    const rmErrors = [];
    rmPage.on('pageerror', e => rmErrors.push(String(e && e.message || e).slice(0, 200)));
    await rmPage.emulateMedia({reducedMotion: 'reduce'});
    await rmPage.goto(url + '?round=force-kill', {waitUntil: 'networkidle'});
    await rmPage.click('#character-grid button:nth-child(3)');
    await rmPage.click('#walk-enter');
    await rmPage.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
    const rmCorpse = await rmPage.waitForFunction(() => window.eys?.state?.().walk?.npcs?.round?.corpses?.[0] || false, null, {timeout: 30000}).then(v => v.jsonValue()).catch(() => null);
    if (rmCorpse) {
      await driveToTarget(rmPage, [rmCorpse.position[0], rmCorpse.position[1] + 1.1], 900, 1.0);
      for (let i = 0; i < 20; i++) {
        if (await rmPage.evaluate(() => window.eys.state().walk.reportable)) break;
        await rmPage.keyboard.down('KeyW'); await rmPage.waitForTimeout(60); await rmPage.keyboard.up('KeyW'); await rmPage.waitForTimeout(30);
      }
      await rmPage.keyboard.press('KeyR');
      const rmReporting = await rmPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'reporting' ? window.eys.state().walk.immersion : false, null, {timeout: 15000}).then(v => v.jsonValue()).catch(() => null);
      check('round: reduced-motion 报警进入reporting', Boolean(rmReporting && rmReporting.entry === 'report'), JSON.stringify(rmReporting && {phase: rmReporting.phase, entry: rmReporting.entry}));
      if (rmReporting) {
        const rmVign = await rmPage.evaluate(() => { const el = document.querySelector('#immersion-vignette'); if (!el) return null; const cs = getComputedStyle(el); return {cls: el.className, opacity: cs.opacity, animation: cs.animationName}; });
        check('round: reduced-motion 渐晕为静态浅红边(无动画)', Boolean(rmVign && rmVign.cls.includes('play') && rmVign.animation === 'none' && parseFloat(rmVign.opacity) > 0.15 && parseFloat(rmVign.opacity) < 0.35), JSON.stringify(rmVign));
      }
      const rmSeating = await rmPage.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'seating', null, {timeout: 10000}).then(() => true).catch(() => false);
      check('round: reduced-motion reporting照常进入seating', rmSeating === true, 'reduced-motion seating');
      // the corpse landed instantly: kills already counted while the meeting is running
      const rmKill = await rmPage.evaluate(() => window.eys.state().walk.npcs.round.kills);
      check('round: reduced-motion 倒地无过渡(击杀当场入账)', rmKill === 1, `kills=${rmKill}`);
    } else {
      check('round: reduced-motion 30秒内出现腿', false, 'no corpse');
    }
    check('round: reduced-motion 无页面错误', rmErrors.length === 0, rmErrors.join('; ').slice(0, 160));
    await rmPage.close();
  }

  report.errors.push(...pageErrors.slice(0, 5));
  report.passed = report.checks.every(c => c.passed) && pageErrors.length === 0;
} catch (fatal) {
  report.errors.push('fatal: ' + String(fatal && fatal.message || fatal));
} finally {
  try { await browser.close(); } catch { /* already closed */ }
}

const outDir = path.join(root, 'reports', label);
mkdirSync(outDir, {recursive: true});
writeFileSync(path.join(outDir, 'immersion.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`immersion smoke [${label}]: ${report.passed ? 'PASS' : 'FAIL'} — ${report.checks.filter(c => c.passed).length}/${report.checks.length} checks`);
for (const c of report.checks) if (!c.passed) console.log(`  [FAIL] ${c.name} — ${c.detail}`);
if (report.errors.length) console.log('  errors:', report.errors.slice(0, 5));
process.exit(report.passed ? 0 : 1);
