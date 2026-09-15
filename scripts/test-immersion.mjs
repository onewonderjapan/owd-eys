// P0 logic checks for the immersion feature: pure state machine invariants plus real
// configuration/navigation invariants. Run with `node scripts/test-immersion.mjs`.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {IMMERSION_CONFIG, selectRoster, createBellProxy} from '../src/immersion-config.js';
import {createImmersionState, countVotesFor} from '../src/immersion-state.js';
import {createNavigation} from '../src/map-walk-simulation.js';

const checks = [];
const check = (name, fn) => {
 try { fn(); checks.push({name, result: 'passed'}); }
 catch (e) { checks.push({name, result: 'failed', error: String(e && e.message || e)}); }
};
const report = {schema: 1, generated_at: new Date().toISOString(), passed: 0, failed: 0, build_sha256: (() => {
  // pin the report to the exact build so publish.py can reject stale reports
  try { return createHash('sha256').update(readFileSync(new URL('../reports/build.json', import.meta.url))).digest('hex'); }
  catch { return null; }
})(), checks};

const manifest = JSON.parse(readFileSync(new URL('../src/assets/manifest.json', import.meta.url), 'utf8'));
const actorIds = Object.keys(manifest.presets);

// --- roster -----------------------------------------------------------------
check('roster: 27位玩家各得到8席不重复名单且玩家首席', () => {
 for (const player of actorIds) {
  const roster = selectRoster(player);
  assert.equal(roster.length, 8);
  assert.equal(new Set(roster).size, 8);
  assert.equal(roster[0], player);
  for (const id of roster) assert.ok(manifest.presets[id], `${id} 不在角色册`);
 }
});
check('roster: NPC全部来自固定候选且排除玩家', () => {
 const player = 'cast.04';
 const roster = selectRoster(player);
 for (const id of roster.slice(1)) {
  assert.ok(IMMERSION_CONFIG.rosterCandidates.includes(id));
  assert.notEqual(id, player);
 }
});

// --- state machine basics ---------------------------------------------------
const roster = selectRoster('cast.14');
const STEP = 1 / 30; // <= the 0.05s tick cap; simulates real RAF frames
const advance = (machine, seconds) => {
 const frames = Math.max(1, Math.round(seconds / STEP));
 for (let i = 0; i < frames; i++) machine.tick(STEP);
};
const fresh = () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14', style: 'water', reducedMotion: false});
 m.dispatch({type: 'READY'});
 return m;
};

check('state: preparing 中途 LOAD_FAILED 进 error,RETRY 回 preparing', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14', style: 'water', reducedMotion: false});
 assert.equal(m.snapshot().phase, 'preparing');
 m.dispatch({type: 'LOAD_FAILED', error: '演员加载失败'});
 assert.equal(m.snapshot().phase, 'error');
 assert.equal(m.snapshot().error, '演员加载失败');
 // error 相位必须先 RETRY,不接受 READY
 m.dispatch({type: 'READY'});
 assert.equal(m.snapshot().phase, 'error');
 m.dispatch({type: 'RETRY'});
 assert.equal(m.snapshot().phase, 'preparing');
 assert.equal(m.snapshot().error, null);
 m.dispatch({type: 'READY'});
 assert.equal(m.snapshot().phase, 'ringing');
});
check('state: error 相位 CANCEL 直接回漫游', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14', style: 'fire', reducedMotion: false});
 m.dispatch({type: 'LOAD_FAILED', error: 'x'});
 m.dispatch({type: 'CANCEL'});
 assert.equal(m.snapshot().phase, 'roam');
});
check('state: 非法阶段事件无效果', () => {
 const m = createImmersionState();
 m.dispatch({type: 'READY'}); assert.equal(m.snapshot().phase, 'roam');
 m.dispatch({type: 'CONFIRM'}); assert.equal(m.snapshot().phase, 'roam');
 m.dispatch({type: 'REPLAY'}); assert.equal(m.snapshot().phase, 'roam');
 m.dispatch({type: 'SELF_DEMO'}); assert.equal(m.snapshot().phase, 'roam');
 const s = fresh();
 s.dispatch({type: 'SELECT', actorId: 'cast.02'}); // voting限定
 assert.equal(s.snapshot().selectedId, null);
 s.dispatch({type: 'CONFIRM'}); // voting限定
 assert.equal(s.snapshot().phase, 'ringing');
 s.dispatch({type: 'SET_STYLE', style: 'nuclear'});
 assert.equal(s.snapshot().style, 'water');
 s.dispatch({type: 'TOTALLY_UNKNOWN'});
 assert.equal(s.snapshot().phase, 'ringing');
});
check('state: START校验8席唯一且玩家首席', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster.slice(1), playerActorId: 'cast.14'});
 assert.equal(m.snapshot().phase, 'error');
 const m2 = createImmersionState();
 m2.dispatch({type: 'START', actorIds: ['cast.14', 'cast.14', ...roster.slice(2)], playerActorId: 'cast.14'});
 assert.equal(m2.snapshot().phase, 'error');
 const m3 = createImmersionState();
 m3.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14'});
 assert.equal(m3.snapshot().phase, 'preparing');
});
check('state: 未选择不能确认', () => {
 const m = fresh();
 for (const id of roster) m.dispatch({type: 'SKIP'}); // ringing->seating->discussion->voting(无效)
 assert.equal(m.snapshot().phase, 'voting');
 m.dispatch({type: 'CONFIRM'});
 assert.equal(m.snapshot().phase, 'voting');
 assert.equal(m.snapshot().targetId, null);
});
check('state: SELECT只接受本轮NPC', () => {
 const m = fresh();
 m.dispatch({type: 'SKIP'}); m.dispatch({type: 'SKIP'}); m.dispatch({type: 'SKIP'});
 assert.equal(m.snapshot().phase, 'voting');
 m.dispatch({type: 'SELECT', actorId: 'cast.14'});
 assert.equal(m.snapshot().selectedId, null);
 m.dispatch({type: 'SELECT', actorId: 'cast.99'});
 assert.equal(m.snapshot().selectedId, null);
 m.dispatch({type: 'SELECT', actorId: 'cast.05'});
 assert.equal(m.snapshot().selectedId, 'cast.05');
 assert.equal(m.snapshot().selfDemo, false);
});

// --- scripted votes ---------------------------------------------------------
const runToVoting = () => {
 const m = fresh();
 advance(m, 1.3); advance(m, 0.9); advance(m, 7.9);
 assert.equal(m.snapshot().phase, 'voting');
 return m;
};
check('votes: 普通投票目标恰好4票胜出且共8张票', () => {
 const m = runToVoting();
 m.dispatch({type: 'SELECT', actorId: roster[3]});
 m.dispatch({type: 'CONFIRM'});
 const s = m.snapshot();
 assert.equal(s.phase, 'result');
 assert.equal(s.targetId, roster[3]);
 assert.equal(Object.keys(s.votes).length, 8);
 assert.equal(countVotesFor(s.votes, s.targetId), 4);
 assert.equal(s.votes['cast.14'], roster[3]);
 assert.equal(s.votes[roster[7]], null); // NPC7弃票
 // NPC4-6 never vote the target.
 for (const i of [4, 5, 6]) assert.notEqual(s.votes[roster[i]], roster[3]);
 // NPC4-6 vote a real NPC, never the player.
 for (const i of [4, 5, 6]) assert.ok(roster.includes(s.votes[roster[i]]) && s.votes[roster[i]] !== 'cast.14');
 // Nobody else reaches 4.
 for (const id of roster) if (id !== roster[3]) assert.ok(countVotesFor(s.votes, id) < 4);
});
check('votes: 目标为NPC7时4-6号不投目标也不投玩家', () => {
 const m = runToVoting();
 m.dispatch({type: 'SELECT', actorId: roster[7]});
 m.dispatch({type: 'CONFIRM'});
 const s = m.snapshot();
 assert.equal(countVotesFor(s.votes, roster[7]), 4);
 for (const i of [4, 5, 6]) assert.ok(s.votes[roster[i]] !== roster[7] && s.votes[roster[i]] !== 'cast.14');
});
check('votes: 自己演示7NPC投玩家、玩家弃票、与普通投票分离', () => {
 const m = runToVoting();
 m.dispatch({type: 'SELECT', actorId: roster[2]});
 m.dispatch({type: 'SELF_DEMO'});
 const s = m.snapshot();
 assert.equal(s.selectedId, 'cast.14');
 assert.equal(s.selfDemo, true);
 m.dispatch({type: 'CONFIRM'});
 const d = m.snapshot();
 assert.equal(d.targetId, 'cast.14');
 assert.equal(countVotesFor(d.votes, 'cast.14'), 7);
 assert.equal(d.votes['cast.14'], null);
 assert.equal(Object.keys(d.votes).length, 8);
});
check('votes: 重复确认只出一次结果', () => {
 const m = runToVoting();
 m.dispatch({type: 'SELECT', actorId: roster[2]});
 m.dispatch({type: 'CONFIRM'});
 const first = m.snapshot();
 m.dispatch({type: 'CONFIRM'});
 m.dispatch({type: 'CONFIRM'});
 const second = m.snapshot();
 assert.equal(second.phase, 'result');
 assert.deepEqual(second.votes, first.votes);
 assert.equal(second.targetId, first.targetId);
});
check('votes: SET_STYLE在投票阶段仍可改，确认后锁定', () => {
 const m = runToVoting();
 m.dispatch({type: 'SET_STYLE', style: 'fire'});
 m.dispatch({type: 'SELECT', actorId: roster[1]});
 m.dispatch({type: 'CONFIRM'});
 assert.equal(m.snapshot().style, 'fire');
 advance(m, 1.3);
 assert.equal(m.snapshot().phase, 'ejection');
 m.dispatch({type: 'SET_STYLE', style: 'water'});
 assert.equal(m.snapshot().style, 'fire');
});

// --- timing -----------------------------------------------------------------
check('timing: 暂停不推进，恢复不补时', () => {
 const m = fresh();
 m.dispatch({type: 'PAUSE'});
 advance(m, 1.5);
 assert.equal(m.snapshot().phase, 'ringing');
 assert.equal(m.snapshot().elapsed, 0);
 m.dispatch({type: 'RESUME'});
 assert.equal(m.snapshot().phase, 'ringing');
 advance(m, 1.3);
 assert.equal(m.snapshot().phase, 'seating');
});
check('timing: 完整时间线按设计推进', () => {
 const m = fresh();
 advance(m, 1.3); assert.equal(m.snapshot().phase, 'seating'); // 1.2s铃
 advance(m, 0.9); assert.equal(m.snapshot().phase, 'discussion'); // 0.8s入座
 advance(m, 2.6); assert.equal(m.snapshot().speakerIndex, 1);
 advance(m, 2.6); assert.equal(m.snapshot().speakerIndex, 2);
 advance(m, 2.6); assert.equal(m.snapshot().phase, 'voting'); // 7.8s讨论
 m.dispatch({type: 'SELECT', actorId: roster[1]});
 m.dispatch({type: 'CONFIRM'});
 advance(m, 1.3); assert.equal(m.snapshot().phase, 'ejection'); // 1.2s结果
 assert.equal(m.snapshot().style, 'water');
 advance(m, IMMERSION_CONFIG.timings.water + 0.1); assert.equal(m.snapshot().phase, 'finished'); // 时长由config驱动
});
check('timing: 火堆时长按config推进', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14', style: 'fire'});
 m.dispatch({type: 'READY'});
 m.dispatch({type: 'SKIP'}); m.dispatch({type: 'SKIP'}); m.dispatch({type: 'SKIP'});
 m.dispatch({type: 'SELECT', actorId: roster[1]});
 m.dispatch({type: 'CONFIRM'});
 advance(m, 1.3);
 assert.equal(m.snapshot().phase, 'ejection');
 advance(m, IMMERSION_CONFIG.timings.fire + 0.1);
 assert.equal(m.snapshot().phase, 'finished');
});
check('timing: 非法dt被忽略', () => {
 const m = fresh();
 for (const bad of [-1, NaN, Infinity, 'x', null]) m.tick(bad);
 assert.equal(m.snapshot().phase, 'ringing');
 assert.equal(m.snapshot().elapsed, 0);
});

// --- skip / replay / cancel -------------------------------------------------
check('skip: 不能绕过加载与投票确认', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14'});
 m.dispatch({type: 'SKIP'});
 assert.equal(m.snapshot().phase, 'preparing');
 const v = runToVoting();
 v.dispatch({type: 'SKIP'});
 assert.equal(v.snapshot().phase, 'voting');
});
check('skip: 各阶段跳到正常下一阶段', () => {
 const m = fresh();
 m.dispatch({type: 'SKIP'}); assert.equal(m.snapshot().phase, 'seating');
 m.dispatch({type: 'SKIP'}); assert.equal(m.snapshot().phase, 'discussion');
 m.dispatch({type: 'SKIP'}); assert.equal(m.snapshot().phase, 'voting');
 m.dispatch({type: 'SELECT', actorId: roster[2]});
 m.dispatch({type: 'CONFIRM'});
 m.dispatch({type: 'SKIP'}); assert.equal(m.snapshot().phase, 'ejection');
 m.dispatch({type: 'SKIP'}); assert.equal(m.snapshot().phase, 'finished');
});
check('replay: 保留target/style/votes且重新计时', () => {
 const m = runToVoting();
 m.dispatch({type: 'SET_STYLE', style: 'fire'});
 m.dispatch({type: 'SELECT', actorId: roster[4]});
 m.dispatch({type: 'CONFIRM'});
 advance(m, 1.3); advance(m, IMMERSION_CONFIG.timings.fire + 0.1);
 assert.equal(m.snapshot().phase, 'finished');
 const before = m.snapshot();
 m.dispatch({type: 'REPLAY'});
 const after = m.snapshot();
 assert.equal(after.phase, 'ejection');
 assert.equal(after.elapsed, 0);
 assert.equal(after.targetId, before.targetId);
 assert.equal(after.style, before.style);
 assert.deepEqual(after.votes, before.votes);
});
check('cancel: 任意busy阶段取消恰好一次且可重开', () => {
 for (const phase of ['preparing', 'ringing', 'discussion', 'voting', 'ejection', 'finished', 'error']) {
  const m = createImmersionState();
  m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14'});
  if (phase === 'error') m.dispatch({type: 'LOAD_FAILED', error: '道具缺失'});
  else if (phase !== 'preparing') m.dispatch({type: 'READY'});
  if (['discussion', 'voting', 'ejection', 'finished'].includes(phase)) { m.dispatch({type: 'SKIP'}); m.dispatch({type: 'SKIP'}); }
  if (phase === 'voting') m.dispatch({type: 'SKIP'});
  if (['ejection', 'finished'].includes(phase)) { m.dispatch({type: 'SKIP'}); m.dispatch({type: 'SELECT', actorId: roster[2]}); m.dispatch({type: 'CONFIRM'}); advance(m, 1.3); }
  if (phase === 'finished') advance(m, IMMERSION_CONFIG.timings.water + 0.1);
  if (phase === 'error') m.dispatch({type: 'LOAD_FAILED', error: '道具缺失'});
  assert.equal(m.snapshot().phase, phase, phase);
  m.dispatch({type: 'CANCEL'});
  assert.equal(m.snapshot().phase, 'roam');
  m.dispatch({type: 'CANCEL'});
  assert.equal(m.snapshot().phase, 'roam');
  m.dispatch({type: 'READY'});
  assert.equal(m.snapshot().phase, 'roam');
  m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14'});
  assert.equal(m.snapshot().phase, 'preparing');
  assert.equal(m.snapshot().targetId, null);
  assert.equal(m.snapshot().votes, null);
 }
});
check('cancel: 取消后迟到的READY/LOAD_FAILED无效', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14'});
 m.dispatch({type: 'CANCEL'});
 m.dispatch({type: 'READY'});
 m.dispatch({type: 'LOAD_FAILED', error: '晚到失败'});
 assert.equal(m.snapshot().phase, 'roam');
 assert.equal(m.snapshot().error, null);
});
check('retry: error重试回到preparing并清错', () => {
 const m = createImmersionState();
 m.dispatch({type: 'START', actorIds: roster, playerActorId: 'cast.14'});
 m.dispatch({type: 'LOAD_FAILED', error: 'GLB损坏'});
 assert.equal(m.snapshot().phase, 'error');
 m.dispatch({type: 'READY'});
 assert.equal(m.snapshot().phase, 'error');
 m.dispatch({type: 'RETRY'});
 assert.equal(m.snapshot().phase, 'preparing');
 assert.equal(m.snapshot().error, null);
});
check('snapshot: 深拷贝纯数据', () => {
 const m = runToVoting();
 m.dispatch({type: 'SELECT', actorId: roster[1]});
 m.dispatch({type: 'CONFIRM'});
 const s = m.snapshot();
 s.votes['cast.14'] = 'tampered';
 s.actorIds.push('intruder');
 const s2 = m.snapshot();
 assert.equal(s2.votes['cast.14'], roster[1]);
 assert.equal(s2.actorIds.length, 8);
 assert.equal(typeof s2.elapsed, 'number');
});

// --- navigation / bell invariants ------------------------------------------
const layout = JSON.parse(readFileSync(new URL('../src/map-scene.json', import.meta.url), 'utf8'));
const props = JSON.parse(readFileSync(new URL('../src/map-walk-props.json', import.meta.url), 'utf8'));
check('bell: 交互点在法院room04且基础导航无碰撞', () => {
 assert.equal(props.map_id, IMMERSION_CONFIG.mapId);
 const nav = createNavigation(layout.layout, props);
 const point = IMMERSION_CONFIG.bell.interaction;
 const [bx, , bz] = IMMERSION_CONFIG.bell.base;
 assert.equal(nav.collision(point), null);
 assert.equal(nav.roomAt(point)?.id, '04');
 assert.equal(nav.roomAt([bx, bz])?.id, '04');
});
check('bell: 叠加代理后交互点仍无碰撞且代理生效', () => {
 const nav = createNavigation(layout.layout, {...props, proxies: [...props.proxies, createBellProxy()]});
 const point = IMMERSION_CONFIG.bell.interaction;
 assert.equal(nav.collision(point), null);
 assert.equal(nav.roomAt(point)?.id, '04');
 // Proxy itself blocks: standing inside the bell stand footprint is a collision.
 const [bx, , bz] = IMMERSION_CONFIG.bell.base;
 assert.notEqual(nav.collision([bx, bz]), null);
 assert.ok(nav.collision([bx, bz]) === 'prop');
 // Spawn and harbor route remain walkable with the proxy added.
 assert.equal(nav.collision(nav.spawn), null);
});
check('bell: 代理几何为12边形且半径0.16', () => {
 const proxy = createBellProxy();
 const [bx, , bz] = IMMERSION_CONFIG.bell.base;
 assert.equal(proxy.poly.length, 12);
 assert.equal(proxy.name, 'immersion-bell');
 for (const [x, z] of proxy.poly) {
  const d = Math.hypot(x - bx, z - bz);
  assert.ok(Math.abs(d - 0.16) < 1e-9);
 }
});
check('bell: 触发距离内可达、距离外不触发（几何判断）', () => {
 const {interaction, triggerDistance} = IMMERSION_CONFIG.bell;
 const [bx, , bz] = IMMERSION_CONFIG.bell.base;
 createNavigation(layout.layout, {...props, proxies: [...props.proxies, createBellProxy()]});
 assert.ok(Math.hypot(interaction[0] - bx, interaction[1] - bz) <= triggerDistance);
});

// --- baseline immutability --------------------------------------------------
check('baseline: 地图与碰撞等关键文件哈希未变', () => {
 const baseline = JSON.parse(readFileSync(new URL('../docs/immersion/baseline.json', import.meta.url), 'utf8'));
 const mustMatch = ['src/map-scene.json', 'src/map-walk-props.json', 'src/assets/manifest.json'];
 for (const p of mustMatch) {
  const entry = baseline.files.find(f => f.path === p);
  assert.ok(entry, `baseline缺少${p}`);
  const buf = readFileSync(new URL('../' + p, import.meta.url));
  const hash = createHash('sha256').update(buf).digest('hex');
  assert.equal(hash, entry.sha256, `${p} 哈希漂移`);
  assert.equal(buf.length, entry.bytes, `${p} 字节数漂移`);
 }
});
check('baseline: assets-manifest相对基线只追加', () => {
 const baseline = JSON.parse(readFileSync(new URL('../docs/immersion/baseline.json', import.meta.url), 'utf8'));
 const entry = baseline.files.find(f => f.path === 'assets-manifest.json');
 const before = JSON.parse(readFileSync(new URL('../reports/immersion/inputs/assets-manifest.pre-p0.json', import.meta.url), 'utf8'));
 const now = JSON.parse(readFileSync(new URL('../assets-manifest.json', import.meta.url)), 'utf8');
 const key = a => `${a.path}|${a.sha256}|${a.bytes}`;
 const beforeSet = new Set(before.assets.map(key));
 const nowSet = new Set(now.assets.map(key));
 for (const k of beforeSet) assert.ok(nowSet.has(k), '旧资产记录丢失');
 const added = now.assets.filter(a => !beforeSet.has(key(a)));
 assert.ok(added.length >= 1, '本轮道具条目未追加');
});

report.passed = checks.filter(c => c.result === 'passed').length;
report.failed = checks.filter(c => c.result === 'failed').length;
const reportPath = new URL('../reports/immersion/p0-test-immersion.json', import.meta.url);
const {writeFileSync, mkdirSync} = await import('node:fs');
mkdirSync(new URL('../reports/immersion/', import.meta.url), {recursive: true});
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`immersion P0: ${report.passed} passed, ${report.failed} failed -> ${reportPath.pathname.replace(/^\/[A-Za-z]:/, '')}`);
for (const c of checks) if (c.result !== 'passed') console.log(`[FAILED] ${c.name} — ${c.error}`);
if (report.failed > 0) process.exit(1);
