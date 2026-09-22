// One-off probe (F3, 2026-09-23 night): measure .walk-status vs .walk-actions
// overlap at 375x812 and screenshot the top bar. Not part of the build.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const url = process.argv[2] || 'http://127.0.0.1:8870/';
const width = Number(process.argv[3] || 375), height = Number(process.argv[4] || 812);

const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader']});
const context = await browser.newContext(process.env.DESKTOP
 ? {viewport: {width, height}}
 : {viewport: {width, height}, hasTouch: true, isMobile: true});
const page = await context.newPage();
await page.goto(new URL('?actor=cast.10', url).href, {waitUntil: 'networkidle'});
if (process.env.DESKTOP) await page.locator('#walk-enter').click();
else await page.locator('#walk-enter').tap();
await page.waitForFunction(() => window.eys?.state?.().walk?.active, null, {timeout: 90000});
await page.waitForTimeout(1200);
const m = await page.evaluate(() => {
 const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {left: +b.left.toFixed(1), top: +b.top.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1)}; };
 const st = r('.walk-status'), ac = r('.walk-actions');
 const overlap = st && ac ? !(ac.left >= st.right || ac.right <= st.left || ac.top >= st.bottom || ac.bottom <= st.top) : null;
 const bubbles = getComputedStyle(document.querySelector('#walk-npc-bubbles')).zIndex;
 const hud = getComputedStyle(document.querySelector('#walk-hud')).zIndex;
 return {status: st, actions: ac, overlap, bubblesZ: bubbles, hudZ: hud, innerWidth};
});
console.log(JSON.stringify(m, null, 1));
await page.screenshot({path: 'reports/local/hud-375-before.png', clip: {x: 0, y: 0, width, height: 140}});
await browser.close();
