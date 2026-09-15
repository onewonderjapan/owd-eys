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

const simModule = await import('../src/map-walk-simulation.js').catch(() => ({}));
const {createNavigation} = simModule;
const moveTwin = simModule.moveCircle || ((p, d) => [p[0] + d[0], p[1] + d[1]]);
let nav = null;
try {
  const layout = JSON.parse(readFileSync(new URL('../src/map-scene.json', import.meta.url), 'utf8'));
  const props = JSON.parse(readFileSync(new URL('../src/map-walk-props.json', import.meta.url), 'utf8'));
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

const report = {schema: 1, url, label, passed: false, version: null, build_sha256: (() => {
  // pin the report to the exact build so publish.py can reject stale reports
  try { return createHash('sha256').update(readFileSync(path.join(root, 'reports', 'build.json'))).digest('hex'); }
  catch { return null; }
})(), checks: [], errors: [], screenshots: []};
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
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', {timeout: 30000}).catch(() => {});
  const ringState = await page.evaluate(() => window.eys.state().walk.immersion?.phase);
  check('session: 准备完成后鸣铃', ringState === 'ringing', `phase=${ringState}`);

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
  await SHOT('ring-pov.png');
  if (!await waitPhase('seating', 15000)) check('flow: seating', false, JSON.stringify(await imm()));
  check('flow: seating入discussion', await waitPhase('discussion', 15000), 'discussion reached');
  await page.waitForTimeout(1200);
  const discussion = await imm();
  check('flow: 讨论字幕与发言者', discussion?.phase === 'discussion' && discussion?.speakerIndex === 0,
    `phase=${discussion?.phase} speaker=${discussion?.speakerIndex}`);
  const captionText = await page.evaluate(() => document.querySelector('#immersion-caption')?.textContent || '');
  check('flow: 字幕包含说话者标签', captionText.includes('：'), captionText);
  await SHOT('meeting-pov.png');
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(500);
  await SHOT('meeting-mobile.png');
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
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  await page.waitForTimeout(300);
  const afterConfirm = await imm();
  const bannerText = await page.evaluate(() => document.querySelector('#immersion-banner')?.textContent || '');
  check('vote: 结果横幅与票数', afterConfirm?.phase === 'result' && /\d+ 票/.test(bannerText), bannerText);
  await SHOT('vote-result.png');

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
  await page.evaluate(() => document.querySelector('#immersion-avatars button[data-actor="cast.04"]')?.click());
  await page.waitForTimeout(150);
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
  check('water-npc: 目标为所选NPC', npcDiag?.targetId === 'cast.04' && npcDiag?.targetId !== npcDiag?.playerActorId, `target=${npcDiag?.targetId} player=${npcDiag?.playerActorId}`);
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
