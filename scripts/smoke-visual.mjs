// Visual sanity gate (V6 2026-09-24): "门全绿不等于画面对". Captures the cheap
// views itself (overview, first person, dusk on/off) and audits the session
// screenshots that smoke-immersion.mjs and the STYLE runs just produced against
// the SAME build — every consumed report's build_sha256 must match the current
// build, otherwise the gate fails as "stale".
// Per frame it measures: luminance variance, largest quantized color block
// (32-level RGB buckets), overexposure (all channels >245) and all-black
// (all channels <12). Thresholds are relative; variance is gated against the
// per-view baseline in reports/local/visual-baseline.json (>=50% of baseline).
// Zero packages: PNGs are decoded in the browser page via createImageBitmap.
// Usage: node scripts/smoke-visual.mjs [url]  (run AFTER smoke-immersion + STYLE runs)
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8870/';

const buildDigest = createHash('sha256').update(readFileSync(path.join(root, 'reports', 'build.json'))).digest('hex');
const baselinePath = path.join(root, 'docs', 'immersion', 'visual-baseline.json');
const baselines = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};

const STYLES = ['water', 'fire', 'bridge', 'flush', 'quicksand', 'space', 'chandelier', 'boulder'];
const views = []; // {view, image: relative path under reports/, b64}
for (const f of ['meeting-pov', 'voting', 'vote-result', 'water-self', 'water-self-look-down', 'water-npc', 'fire-self', 'fire-self-lit', 'fire-npc', 'ring-pov'])
  views.push({view: f, image: `immersion/${f}.png`});
for (const s of STYLES) views.push({view: `style-${s}-3`, image: `immersion/style-${s}-3.png`});

const report = {schema: 1, url, build_sha256: buildDigest, passed: false, views: [], errors: []};

function verifyReport(relPath) {
  const p = path.join(root, 'reports', relPath);
  if (!existsSync(p)) throw new Error(`Missing reports/${relPath}; run scripts/smoke-immersion.mjs (and STYLE=<style> runs) on this build first.`);
  const r = JSON.parse(readFileSync(p, 'utf8'));
  if (r.build_sha256 !== buildDigest) throw new Error(`reports/${relPath} is stale (build hash mismatch); re-run the smokes on the current build.`);
  if (!r.passed) throw new Error(`reports/${relPath} did not pass; the visual gate audits green runs only.`);
}

const analyzeInPage = async src => {
  const blob = await (await fetch('data:image/png;base64,' + src)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const total = cv.width * cv.height;
  const buckets = new Map();
  let over = 0, black = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gr = d[i + 1], b = d[i + 2];
    if (r > 245 && gr > 245 && b > 245) over++;
    if (r < 12 && gr < 12 && b < 12) black++;
    const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    sum += lum; sum2 += lum * lum;
    const key = ((r >> 5) << 10) | ((gr >> 5) << 5) | (b >> 5);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let maxBlock = 0;
  for (const c of buckets.values()) if (c > maxBlock) maxBlock = c;
  const mean = sum / total;
  return {variance: +(sum2 / total - mean * mean).toFixed(1), maxBlock: +(maxBlock / total).toFixed(4),
    over: +(over / total).toFixed(4), black: +(black / total).toFixed(4)};
};

const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader']});
try {
  verifyReport('immersion/immersion.json');
  for (const s of STYLES) verifyReport(`style-${s}/immersion.json`);

  const page = await browser.newPage({viewport: {width: 1440, height: 960}});
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => window.eys?.state?.().ready, null, {timeout: 20000});
  await page.click('#walk-enter');
  await page.waitForFunction(() => window.eys?.state?.().walk?.active, null, {timeout: 60000});
  await page.waitForTimeout(2500);
  await page.setViewportSize({width: 1440, height: 960});
  await page.waitForTimeout(600);

  const capture = async view => {
    const buf = await page.screenshot({type: 'png'});
    writeFileSync(path.join(root, 'reports', 'local', `visual-${view}.png`), buf);
    views.unshift({view, image: `local/visual-${view}.png`});
  };
  await capture('overview');
  await page.evaluate(() => document.querySelector('#walk-view-toggle')?.click());
  await page.waitForTimeout(600);
  await capture('first-person');
  await page.evaluate(() => document.querySelector('#walk-view-toggle')?.click());
  await page.waitForTimeout(600);
  await page.click('#walk-dusk');
  await page.waitForTimeout(700);
  await capture('dusk-on');
  await page.click('#walk-dusk');
  await page.waitForTimeout(700);
  await capture('dusk-off');

  for (const v of views) {
    const p = path.join(root, 'reports', v.image);
    if (!existsSync(p)) { report.errors.push(`missing screenshot ${v.image}`); continue; }
    const metrics = await page.evaluate(analyzeInPage, readFileSync(p).toString('base64'));
    // Baselines are per view {variance, maxBlock}. (The first version stored only
    // variance and multiplied THAT by 1.25 for the colour-block limit, so every
    // view silently got the 0.97 cap.) Older numeric entries mean {variance}.
    const raw = baselines[v.view];
    const base = typeof raw === 'number' ? {variance: raw} : (raw || {});
    const varianceCheck = typeof base.variance === 'number' && base.variance > 0 ? (metrics.variance >= base.variance * 0.5 ? 'pass' : 'fail') : 'baseline-established';
    // maxBlock is a REGRESSION check against this view's own baseline (+25%,
    // floor 0.70, cap 0.97): four ejection stages are dark-void scenes today
    // (space/chandelier/boulder/quicksand measure 0.73-0.91), so an absolute 70%
    // would fail frames R1 never touched; R2 lifts those baselines.
    // What this gate can NOT see: a near-camera occluder with normal colour
    // statistics. The 1.5.0 first-person bug (own head filling the view)
    // measures maxBlock 0.23 / variance 1791 -- indistinguishable from a healthy
    // frame. That class is caught by smoke-first-person's after-frames check.
    const maxBlockLimit = typeof base.maxBlock === 'number' ? Math.max(0.70, Math.min(base.maxBlock * 1.25, 0.97)) : 0.70;
    const checks = {
      maxBlock: metrics.maxBlock < maxBlockLimit ? 'pass' : 'fail',
      overexposed: metrics.over < 0.25 ? 'pass' : 'fail',
      allBlack: metrics.black < 0.60 ? 'pass' : 'fail',
      variance: varianceCheck,
    };
    // Only fill in missing fields; existing baselines are never overwritten by a run.
    const nextBase = {...base};
    if (typeof nextBase.variance !== 'number') nextBase.variance = metrics.variance;
    if (typeof nextBase.maxBlock !== 'number') nextBase.maxBlock = metrics.maxBlock;
    baselines[v.view] = nextBase;
    const failed = Object.values(checks).some(c => c === 'fail');
    if (failed) report.errors.push(`${v.view}: ${JSON.stringify(metrics)}`);
    report.views.push({view: v.view, image: `reports/${v.image}`, metrics, checks, maxBlockLimit: +maxBlockLimit.toFixed(3), baseline: base.variance != null ? base : null});
  }

  writeFileSync(baselinePath, JSON.stringify(baselines, null, 2) + '\n');
  report.passed = report.errors.length === 0;
} catch (fatal) {
  report.errors.push('fatal: ' + String(fatal && fatal.message || fatal));
} finally {
  try { await browser.close(); } catch { /* already closed */ }
}

mkdirSync(path.join(root, 'reports', 'local'), {recursive: true});
writeFileSync(path.join(root, 'reports', 'local', 'visual.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`visual gate: ${report.passed ? 'PASS' : 'FAIL'} — ${report.views.length} frames`);
for (const e of report.errors) console.log('  ' + e);
process.exit(report.passed ? 0 : 1);
