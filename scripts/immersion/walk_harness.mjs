// Shared keyboard-walk harness for the immersion verification scripts: BFS path over
// the navigation data plus a digital-twin key driver. No teleport/debug entries.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {moveCircle} = await import('../../src/map-walk-simulation.js');

const KEY_DIRS = {KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0]};
const speed = 2.35, frameDt = 0.05;

export function createWalker(nav) {
 function lineOfSight(a, b, radius = 0.26) {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let i = 0; i <= steps; i++) {
   const t = i / steps;
   if (nav.collision([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], radius)) return false;
  }
  return true;
 }
 function findPath(from, to, step = 0.22) {
  const key = p => `${Math.round(p[0] / step)},${Math.round(p[1] / step)}`;
  const open = new Map([[key(from), {p: from, g: 0, f: 0, parent: null}]]);
  const closed = new Set();
  let best = null, bestDist = Infinity;
  while (open.size) {
   let ck = null, cn = null;
   for (const [k, n] of open) if (!cn || n.f < cn.f) { cn = n; ck = k; }
   open.delete(ck); closed.add(ck);
   const d = Math.hypot(to[0] - cn.p[0], to[1] - cn.p[1]);
   if (d < bestDist) { bestDist = d; best = cn; }
   if (d < 0.4) { best = cn; break; }
   for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    const np = [cn.p[0] + dx * step, cn.p[1] + dz * step], k = key(np);
    if (closed.has(k) || nav.collision(np, 0.26)) continue;
    const g = cn.g + Math.hypot(dx, dz), nx = open.get(k);
    if (!nx || g < nx.g) open.set(k, {p: np, g, f: g + Math.hypot(to[0] - np[0], to[1] - np[1]), parent: cn});
   }
   if (open.size > 60000) break;
  }
  const raw = [];
  for (let n = best; n; n = n.parent) raw.unshift(n.p);
  if (raw.length < 2) return null;
  const smoothed = [raw[0]];
  let anchor = 0;
  for (let i = 2; i < raw.length; i++) {
   if (!lineOfSight(raw[anchor], raw[i])) { smoothed.push(raw[i - 1]); anchor = i - 1; }
  }
  smoothed.push(raw[raw.length - 1]);
  return smoothed;
 }
 const arcLen = route => {
  let s = 0;
  for (let i = 1; i < route.length; i++) s += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
  return s;
 };
 const arcAt = (route, p) => {
  let bd = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < route.length - 1; i++) {
   const ax = route[i][0], az = route[i][1], bx = route[i + 1][0], bz = route[i + 1][1];
   const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz || 1e-9;
   const t = Math.max(0, Math.min(1, ((p[0] - ax) * abx + (p[1] - az) * abz) / l2));
   const d = Math.hypot(p[0] - (ax + abx * t), p[1] - (az + abz * t));
   if (d < bd) { bd = d; bi = i; bt = t; }
  }
  let s = 0;
  for (let i = 0; i < bi; i++) s += Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
  return s + bt * Math.hypot(route[bi + 1][0] - route[bi][0], route[bi + 1][1] - route[bi][1]);
 };
 function arcOfPoint(route, p) { return arcAt(route, p); }
 const stepTwin = (p, key) => {
  const [dx, dz] = KEY_DIRS[key];
  return moveCircle(nav, p, [dx * speed * frameDt, dz * speed * frameDt]).position;
 };

 async function walkToBell(page, spawn) {
  const target = [9.12, -7.56];
  let route = findPath(spawn, [8.7, -4.6]);
  if (Array.isArray(route)) route.push([8.75, -5.1], [8.95, -5.9], [9.1, -6.5], [9.2, -6.95], target);
  let wp = 1, twin = [...spawn];
  for (let round = 0; round < 900; round++) {
   twin = [...(await page.evaluate(() => window.eys.state().walk.position))];
   if (Math.hypot(twin[0] - target[0], twin[1] - target[1]) < 0.8) return true;
   while (wp < route.length - 1 && Math.hypot(twin[0] - route[wp][0], twin[1] - route[wp][1]) < 0.5) wp++;
   const goal = route[Math.min(wp, route.length - 1)];
   const want = Math.abs(goal[0] - twin[0]) > Math.abs(goal[1] - twin[1])
    ? (goal[0] > twin[0] ? 'KeyD' : 'KeyA') : (goal[1] > twin[1] ? 'KeyS' : 'KeyW');
   let plan = null, bestArc = arcAt(route, twin);
   if (arcOfPoint(route, stepTwin(twin, want)) > bestArc + 1e-4) plan = [want];
   else {
    const search = (p, seq, depth) => {
     if (depth === 0) return;
     for (const key of Object.keys(KEY_DIRS)) {
      const np = stepTwin(p, key);
      const a = arcOfPoint(route, np);
      if (a > bestArc + 1e-4) { bestArc = a; plan = [...seq, key]; }
      search(np, [...seq, key], depth - 1);
     }
    };
    search(twin, [], 6);
   }
   if (!plan) wp = Math.max(1, wp - 2);
   const keys = plan && plan.length ? plan.slice(0, 4) : [want];
   for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD'])
    keys.includes(key) ? await page.keyboard.down(key) : await page.keyboard.up(key);
   await page.waitForTimeout(Math.max(60, keys.length * 45));
   for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await page.keyboard.up(key);
  }
  return false;
 }

 return {findPath, walkToBell, arcAt};
}
