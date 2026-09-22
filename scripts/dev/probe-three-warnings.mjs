// One-off probe (F5, 2026-09-23 night): collect page console warnings containing
// 'deprecated' or 'THREE.' while exercising the site on the 0.186 worktree preview.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const url = process.argv[2] || 'http://127.0.0.1:8871/';

const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader']});
const warnings = [];
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 960}});
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', e => warnings.push('pageerror: ' + e.message));
  await page.goto(new URL('?actor=cast.10', url).href, {waitUntil: 'networkidle'});
  await page.locator('#walk-enter').click();
  await page.waitForFunction(() => window.eys?.state?.().walk?.active, null, {timeout: 90000});
  await page.waitForTimeout(4000); // roam with townsfolk
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'voting', null, {timeout: 60000}).catch(() => {});
  await page.evaluate(() => document.querySelector('#immersion-self-demo')?.click());
  await page.evaluate(() => document.querySelector('#immersion-style-water')?.click());
  await page.waitForFunction(() => !document.querySelector('#immersion-confirm')?.disabled, null, {timeout: 5000}).catch(() => {});
  await page.evaluate(() => document.querySelector('#immersion-confirm')?.click());
  await page.waitForTimeout(6000); // ejection playback
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
} finally { await browser.close(); }
const hits = warnings.filter(w => /deprecated|THREE\./i.test(w));
const report = {url, totalConsoleWarnings: warnings.length, deprecatedOrThree: hits.length, sample: hits.slice(0, 10), sampled_at: new Date().toISOString()};
await fs.writeFile('reports/local/three-0186-warnings.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({total: report.totalConsoleWarnings, hits: report.deprecatedOrThree}));
for (const w of report.sample) console.log('  -', w.slice(0, 200));
