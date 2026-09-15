// Self-POV refinement evidence runner. Real entry -> keyboard walk to the bell ->
// one self ejection per branch (water/fire) with Playwright video, keyframes,
// trajectory continuity samples and independent chain-endpoint measurements.
// Usage: node scripts/immersion/self_pov_refinement.mjs [url] [branches=water,fire] [actor=cast.14]
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWalker} from './walk_harness.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const branches = (process.argv[3] || 'water,fire').split(',');
const actor = process.argv[4] || 'cast.14';
const outDir = path.join(root, 'reports', 'immersion-self-pov-refinement');
mkdirSync(outDir, {recursive: true});
mkdirSync(path.join(outDir, 'videos'), {recursive: true});

const {createNavigation} = await import('../../src/map-walk-simulation.js');
const layout = JSON.parse(readFileSync(new URL('../../src/map-scene.json', import.meta.url), 'utf8'));
const props = JSON.parse(readFileSync(new URL('../../src/map-walk-props.json', import.meta.url), 'utf8'));
const nav = createNavigation(layout.layout, props);
const {findPath, walkToBell} = createWalker(nav);

const report = {schema: 1, actor, url, branches: {}, generated_at: new Date().toISOString()};
let failures = 0;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-unsafe-swiftshader'],
});



async function runBranch(branch) {
  const tag = branch;
  const context = await browser.newContext({
    viewport: {width: 1280, height: 800}, hasTouch: true,
    recordVideo: {dir: path.join(outDir, 'videos'), size: {width: 1280, height: 800}},
  });
  const page = await context.newPage();
  if (process.env.REDUCE_MOTION === '1') await page.emulateMedia({reducedMotion: 'reduce'});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  const result = {branch: tag, checks: [], screenshots: [], pageErrors};
  const check = (name, ok, detail = '') => {
    result.checks.push({name, ok: Boolean(ok), detail: String(detail).slice(0, 260)});
    if (!ok) failures += 1;
  };
  const shot = async name => {
    await page.screenshot({path: path.join(outDir, name), type: 'png'});
    result.screenshots.push(name);
  };
  const imm = () => page.evaluate(() => window.eys.state().walk.immersion);
  const waitPhase = (phase, timeout = 30000) =>
    page.waitForFunction(ph => window.eys?.state?.().walk?.immersion?.phase === ph, phase, {timeout}).then(() => true).catch(() => false);
  const skipBtn = () => page.evaluate(() => document.querySelector('#immersion-skip')?.click());

  try {
    await page.goto(`${url}?actor=${actor}`, {waitUntil: 'networkidle'});
    result.reducedMotion = process.env.REDUCE_MOTION === '1';
    await page.click('#walk-enter');
    await page.waitForFunction(() => window.eys?.state?.().walk?.active, {timeout: 40000});
    await page.waitForTimeout(2000);
    const spawn = await page.evaluate(() => window.eys.state().walk.position);
    const arrived = await walkToBell(page, spawn);
    check('walk: 真实键盘到铃', arrived, JSON.stringify(await page.evaluate(() => window.eys.state().walk.position)));
    if (!arrived) throw new Error('walk failed');
    await page.setViewportSize({width: 1280, height: 800});
    await page.waitForTimeout(400);

    await page.keyboard.press('KeyE');
    if (!await waitPhase('voting', 60000)) check('flow: 到达voting', false, JSON.stringify(await imm()));
    await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
    await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.selfDemo === true, {timeout: 5000}).catch(() => {});
    await page.evaluate(b => document.querySelector(`#immersion-style-${b}`)?.click(), branch);
    await page.waitForFunction((b => window.eys?.state?.().walk?.immersion?.style === b), branch, {timeout: 5000}).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('#immersion-confirm')?.disabled, {timeout: 5000}).catch(() => {});
    await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
    if (!await waitPhase('ejection', 15000)) check('flow: ejection', false, JSON.stringify(await imm()));

    // Trajectory continuity: sample body/eye around every phase boundary.
    const bounds = branch === 'water' ? [1.7, 2.9, 4.5, 5.1, 5.9] : [1.7, 2.9, 4.3, 5.3];
    const samples = [];
    for (const b of bounds) {
      await page.waitForFunction(m => window.eys?.state?.().walk?.immersion?.ejection?.trajectory && window.eys.state().walk.immersion.elapsed >= m - 0.15,
        b, {timeout: 30000}).catch(() => {});
      for (let i = 0; i < 8; i++) {
        const s = await imm();
        samples.push({t: s.elapsed, body: s.ejection?.trajectory?.body, eye: s.ejection?.trajectory?.eye});
        await page.waitForTimeout(60);
      }
    }
    let maxJump = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (!a.body || !b.body) continue;
      const dt = Math.max(0.001, b.t - a.t);
      const jump = Math.hypot(b.body[0] - a.body[0], b.body[1] - a.body[1], b.body[2] - a.body[2]) / dt;
      maxJump = Math.max(maxJump, jump);
    }
    // Smooth motion peaks near 2/s during the throw; a stage-boundary teleport
    // (the old bug) would show up as ~15/s. Bound catches jumps, not speed.
    check('trajectory: 阶段边界连续(无跳变,≤3.5/s)', maxJump > 0 && maxJump <= 3.5, `max=${maxJump.toFixed(3)} samples=${samples.length}`);

    // Replay helper: restarts the performance and resets look/effects.
    const replayTo = async () => {
      await page.evaluate(() => document.querySelector('#immersion-replay')?.click());
      await page.waitForTimeout(350);
      const s = await imm();
      check('replay: 视角复位且阶段正确', s?.phase === 'ejection' && (s?.elapsed ?? 1) < 0.6 && s?.look?.enabled === true && Math.abs(s?.look?.userYaw ?? 0) < 0.01,
        JSON.stringify({phase: s?.phase, elapsed: +(s?.elapsed ?? 0).toFixed(2), look: s?.look}));
    };

    // Keyframes on replay passes (marks sit early inside each beat so the ~0.3-0.5s
    // screenshot latency stays inside the intended phase).
    const marks = branch === 'water'
      ? [['walk', 0.9], ['lift', 2.3], ['carried', 3.6], ['edge', 4.6], ['thrown', 5.35], ['underwater', 6.7]]
      : [['walk', 0.9], ['lift', 2.3], ['carried', 3.6], ['rim', 4.5], ['drop', 4.9], ['inpit', 6.0]];
    if (!await waitPhase('finished', 20000)) check('flow: pass1 finished', false, JSON.stringify(await imm()));
    // One replay per keyframe: the replay button only exists in 'finished', and
    // screenshots under software GL are too slow for one replay to serve all marks.
    for (const [name, mark] of marks) {
      if (!await waitPhase('finished', 20000)) check(`flow: pass-${name} finished`, false, JSON.stringify(await imm()));
      await replayTo();
      await page.waitForFunction(m => window.eys?.state?.().walk?.immersion?.elapsed >= m, mark, {timeout: 30000}).catch(() => {});
      await shot(`${tag}-${name}.png`);
    }

    // Chain integrity at lift/edge-pause/underwater (independent endpoints).
    const marks2 = branch === 'water' ? [2.4, 4.8, 7.2] : [];
    const integrity = [];
    if (branch === 'water') {
      if (!await waitPhase('finished', 20000)) check('flow: pass2 finished', false, JSON.stringify(await imm()));
      await replayTo();
      for (const mark of marks2) {
        await page.waitForFunction(m => window.eys?.state?.().walk?.immersion?.elapsed >= m, mark, {timeout: 30000}).catch(() => {});
        const d = await page.evaluate(() => window.eys.state().walk.immersion.ejection);
        const errTop = d ? Math.hypot(d.modelTop[0] - d.linkTopEnd[0], d.modelTop[1] - d.linkTopEnd[1], d.modelTop[2] - d.linkTopEnd[2]) : null;
        const errBottom = d ? Math.hypot(d.modelBottom[0] - d.linkBottomEnd[0], d.modelBottom[1] - d.linkBottomEnd[1], d.modelBottom[2] - d.linkBottomEnd[2]) : null;
        integrity.push({at: await page.evaluate(() => window.eys.state().walk.immersion.elapsed), errTop, errBottom});
      }
      check('chain: 独立端点误差≤0.03(抬/抛/水下)',
        integrity.every(s => s.errTop !== null && s.errTop <= 0.03 && s.errBottom <= 0.03),
        JSON.stringify(integrity.map(s => ({at: +s.at.toFixed(2), et: +s.errTop.toFixed(4), eb: +s.errBottom.toFixed(4)}))));
      writeFileSync(path.join(outDir, `water-link-integrity-${tag}.json`), JSON.stringify(integrity, null, 2) + '\n');
    }

    if (branch === 'water') {
      if (!await waitPhase('finished', 20000)) check('flow: pass3a finished', false, JSON.stringify(await imm()));
      await replayTo();
      // Look down at the chain/stone on desktop, then tablet and phone (simulated
      // drag). Long drags: the default gaze looks back up at the shore crowd, so
      // reaching the -0.9 rad look-down check needs most of the pitch range.
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 6.8, {timeout: 30000}).catch(() => {});
      await page.mouse.move(640, 160);
      await page.mouse.down();
      await page.mouse.move(640, 780, {steps: 12});
      await page.mouse.up();
      await page.waitForTimeout(350);
      await shot('water-down-desktop.png');
      const down = await imm();
      check('water: 低头角度可达', down?.look?.pitch <= -0.9, `pitch=${down?.look?.pitch?.toFixed(3)}`);
      // Fresh pass for the narrow viewports: resizing would otherwise overrun the
      // 6s performance and capture the finished dialog instead of the sink.
      if (!await waitPhase('finished', 20000)) check('flow: pass3b finished', false, JSON.stringify(await imm()));
      await replayTo();
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 6.0, {timeout: 30000}).catch(() => {});
      await page.setViewportSize({width: 768, height: 1024});
      await page.waitForTimeout(250);
      await page.mouse.move(384, 200); await page.mouse.down(); await page.mouse.move(384, 860, {steps: 10}); await page.mouse.up();
      await page.waitForTimeout(250);
      await shot('water-down-tablet.png');
      await page.setViewportSize({width: 375, height: 812});
      await page.waitForTimeout(250);
      // Simulated touch drag (mouse pointer on a touch-capable context; no real device).
      await page.mouse.move(187, 160); await page.mouse.down(); await page.mouse.move(187, 660, {steps: 10}); await page.mouse.up();
      await page.waitForTimeout(200);
      await shot('water-down-phone.png');
      result.viewportShots = true;
      await page.setViewportSize({width: 1280, height: 800});
      await page.waitForTimeout(300);
    }
    if (branch === 'fire') {
      if (!await waitPhase('finished', 20000)) check('flow: pass3a finished', false, JSON.stringify(await imm()));
      await replayTo();
      await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.elapsed > 6.0, {timeout: 30000}).catch(() => {});
      await page.setViewportSize({width: 768, height: 1024});
      await page.waitForTimeout(350);
      await shot('fire-inpit-tablet.png');
      await page.setViewportSize({width: 375, height: 812});
      await page.waitForTimeout(350);
      await shot('fire-inpit-phone.png');
      await page.setViewportSize({width: 1280, height: 800});
      await page.waitForTimeout(300);
    }

    if (!await waitPhase('finished', 20000)) check('flow: final finished', false, JSON.stringify(await imm()));
    await page.evaluate(() => document.querySelector('#immersion-return')?.click());
    check('flow: 返回漫游', await waitPhase('roam', 10000), 'roam');

    // Cancel-restore record for this branch (already covered by regression; kept once here).
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.busy, {timeout: 40000}).catch(() => {});
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({pos: window.eys.state().walk.position, view: window.eys.state().walk.view}));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'roam', {timeout: 10000}).catch(() => {});
    const after = await page.evaluate(() => window.eys.state().walk.position);
    check('cancel: 位置恢复', Math.hypot(before.pos[0] - after[0], before.pos[1] - after[1]) < 1e-4, `${JSON.stringify(before.pos)} -> ${JSON.stringify(after)}`);
  } catch (fatal) {
    check('fatal', false, String(fatal && fatal.message || fatal).slice(0, 300));
  }
  result.passed = result.checks.every(c => c.ok);
  report.branches[branch] = result;
  const video = page.video();
  await context.close();
  if (video) {
    try { await video.saveAs(path.join(outDir, 'videos', `self-${branch}.webm`)); } catch (e) { /* closed with context */ }
  }
}

for (const branch of branches) await runBranch(branch.trim());
await browser.close();
report.failures = failures;
report.passed = failures === 0;
writeFileSync(path.join(outDir, 'refinement-run.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`self-pov refinement [${branches.join('+')}]: ${report.passed ? 'PASS' : 'FAIL'} — ${failures} failures`);
for (const b of Object.values(report.branches)) for (const c of b.checks) if (!c.ok) console.log(`  [FAIL][${b.branch}] ${c.name} — ${c.detail}`);
process.exit(report.passed ? 0 : 1);
