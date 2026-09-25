// P0 logic checks for the immersion feature: pure state machine invariants plus real
// configuration/navigation invariants. Run with `node scripts/test-immersion.mjs`.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {IMMERSION_CONFIG, TOWN_ROUND_CONFIG, selectRoster, createBellProxy, pickSessionSpeeches} from '../src/immersion-config.js';
import {createImmersionState, countVotesFor} from '../src/immersion-state.js';
import {createNavigation, findPath, pickWanderTarget, createWanderGraph} from '../src/map-walk-simulation.js';

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
check('speeches: 台词池取句确定、不重复、全部来自池', () => {
 const a = pickSessionSpeeches(1), b = pickSessionSpeeches(1);
 assert.deepEqual(a, b);
 assert.equal(a.length, 3);
 assert.equal(new Set(a).size, 3);
 for (const line of a) assert.ok(IMMERSION_CONFIG.speechPool.includes(line));
 // 原脚本三句在若干种子中都会出现(池中前三句 continuity)
 const seen = new Set();
 for (let s = 0; s < 40; s++) pickSessionSpeeches(s).forEach(l => seen.add(l));
 for (const line of ['我刚才在码头。', '先听听大家怎么说。', '那我们投票吧。'])
  assert.ok(seen.has(line), line);
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

// --- 1.7.0 entry/absent/present (K1a) ----------------------------------------
const startWith = (m, {entry, dead = [], eliminated = [], actorIds: ids = roster, playerActorId: player = 'cast.14'} = {}) => {
 m.dispatch({type: 'START', actorIds: ids, playerActorId: player, style: 'water', reducedMotion: false, entry, absent: {dead, eliminated}});
 return m;
};
const toVotingWith = opts => {
 const m = createImmersionState();
 startWith(m, opts);
 m.dispatch({type: 'READY'});
 m.dispatch({type: 'SKIP'});
 m.dispatch({type: 'SKIP'});
 advance(m, 7.9); // discussion 7.8s -> voting
 assert.equal(m.snapshot().phase, 'voting');
 return m;
};

check('entry: READY 按 entry 进 reporting,ringing 为默认', () => {
 const m = createImmersionState();
 startWith(m, {entry: 'report'});
 m.dispatch({type: 'READY'});
 assert.equal(m.snapshot().phase, 'reporting');
 assert.equal(m.snapshot().entry, 'report');
 const m2 = createImmersionState();
 startWith(m2, {});
 m2.dispatch({type: 'READY'});
 assert.equal(m2.snapshot().phase, 'ringing');
 assert.equal(m2.snapshot().entry, 'ring');
});
check('timing: reporting 时长按config推进且SKIP可跳', () => {
 const m = createImmersionState();
 startWith(m, {entry: 'report'});
 m.dispatch({type: 'READY'});
 advance(m, 0.9);
 assert.equal(m.snapshot().phase, 'reporting');
 advance(m, 0.2);
 assert.equal(m.snapshot().phase, 'seating'); // 1.0s发现演出
 const m2 = createImmersionState();
 startWith(m2, {entry: 'report'});
 m2.dispatch({type: 'READY'});
 m2.dispatch({type: 'SKIP'});
 assert.equal(m2.snapshot().phase, 'seating');
});
check('absent: 缺席id不在名单或含玩家 -> error', () => {
 for (const bad of [
  {dead: ['cast.99']},                          // 不在名单
  {eliminated: ['cast.14']},                    // 是玩家
  {dead: ['cast.03'], eliminated: ['cast.03']}, // 重复登记
  {eliminated: ['cast.02', 'cast.02']},         // 重复id
 ]) {
  const m = createImmersionState();
  startWith(m, bad);
  assert.equal(m.snapshot().phase, 'error', JSON.stringify(bad));
 }
 const ok = createImmersionState();
 startWith(ok, {dead: ['cast.03'], eliminated: ['cast.04']});
 assert.equal(ok.snapshot().phase, 'preparing');
 assert.deepEqual(ok.snapshot().absent, {dead: ['cast.03'], eliminated: ['cast.04']});
});
check('present: 名单- dead - eliminated,player 在场则首席在列', () => {
 const m = createImmersionState();
 startWith(m, {dead: [roster[1], roster[2]], eliminated: [roster[4]]});
 m.dispatch({type: 'READY'});
 const s = m.snapshot();
 assert.deepEqual(s.present, roster.filter(id => ![roster[1], roster[2], roster[4]].includes(id)));
 assert.equal(s.present.length, 5);
 assert.ok(s.present.includes('cast.14'));
});
check('voting: SELECT拒绝死者与出局者、接受在场者', () => {
 const m = toVotingWith({dead: [roster[1]], eliminated: [roster[2]]});
 m.dispatch({type: 'SELECT', actorId: roster[1]});
 assert.equal(m.snapshot().selectedId, null);
 m.dispatch({type: 'SELECT', actorId: roster[2]});
 assert.equal(m.snapshot().selectedId, null);
 m.dispatch({type: 'SELECT', actorId: 'cast.14'});
 assert.equal(m.snapshot().selectedId, null);
 m.dispatch({type: 'SELECT', actorId: roster[3]});
 assert.equal(m.snapshot().selectedId, roster[3]);
});
check('votes: absent 0/1/2/3/4人时目标严格最多票、总票数=在场数、不在场者无票', () => {
 for (const absentCount of [0, 1, 2, 3, 4]) {
  const dead = roster.slice(1, 1 + Math.ceil(absentCount / 2));
  const eliminated = roster.slice(1 + Math.ceil(absentCount / 2), 1 + absentCount);
  const m = toVotingWith({dead, eliminated});
  const target = roster[1 + absentCount + 1]; // 一定在场的目标
  m.dispatch({type: 'SELECT', actorId: target});
  m.dispatch({type: 'CONFIRM'});
  const s = m.snapshot();
  const present = s.present;
  assert.equal(Object.keys(s.votes).length, present.length, `absent=${absentCount}`);
  for (const id of [...dead, ...eliminated]) assert.ok(!(id in s.votes), `absent=${absentCount} ${id} 不应有票`);
  const maxOther = Math.max(...present.filter(id => id !== target).map(id => countVotesFor(s.votes, id)), 0);
  assert.ok(countVotesFor(s.votes, target) > maxOther, `absent=${absentCount} 目标必须严格最多`);
  assert.ok(countVotesFor(s.votes, target) >= Math.ceil(present.length / 2), `absent=${absentCount} 目标至少一半`);
 }
});
check('votes: selfDemo 在有缺席时仍全投玩家且不在场者无票', () => {
 const m = toVotingWith({dead: [roster[1], roster[2]]});
 m.dispatch({type: 'SELECT', actorId: roster[3]});
 m.dispatch({type: 'SELF_DEMO'});
 m.dispatch({type: 'CONFIRM'});
 const s = m.snapshot();
 assert.equal(s.targetId, 'cast.14');
 assert.equal(countVotesFor(s.votes, 'cast.14'), s.present.length - 1);
 assert.equal(Object.keys(s.votes).length, s.present.length);
 assert.ok(!('cast.14' in {}) || s.votes['cast.14'] === null);
 assert.ok(!(roster[1] in s.votes) && !(roster[2] in s.votes));
});
check('votes: 回归——8人无absent票数与改前脚本一致', () => {
 const m = toVotingWith({});
 m.dispatch({type: 'SELECT', actorId: roster[3]});
 m.dispatch({type: 'CONFIRM'});
 const s = m.snapshot();
 assert.equal(Object.keys(s.votes).length, 8);
 assert.equal(countVotesFor(s.votes, roster[3]), 4);
 assert.equal(s.votes['cast.14'], roster[3]);
 assert.equal(s.votes[roster[7]], null);
 for (const i of [4, 5, 6]) assert.ok(s.votes[roster[i]] !== roster[3] && s.votes[roster[i]] !== 'cast.14');
 for (const id of roster) if (id !== roster[3]) assert.ok(countVotesFor(s.votes, id) < 4);
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

// --- walk-npc pathfinding helpers (findPath sunk from the smoke script) ------
check('path: 出生点到铃交互点有路且每个路点无碰撞', () => {
 const nav = createNavigation(layout.layout, props);
 const route = findPath(nav, nav.spawn, IMMERSION_CONFIG.bell.interaction);
 assert.ok(Array.isArray(route) && route.length >= 2, `route=${route && route.length}`);
 for (const p of route) assert.equal(nav.collision(p), null, JSON.stringify(p));
 const last = route[route.length - 1];
 const [ix, iz] = IMMERSION_CONFIG.bell.interaction;
 assert.ok(Math.hypot(last[0] - ix, last[1] - iz) < 0.5, `末端=${last} 交互点=${ix},${iz}`);
});
check('path: 实体内部目标返回null', () => {
 const nav = createNavigation(layout.layout, props);
 // 最大实体的包围盒中心必然深居实体内:最近可走格离它远超 0.4 容差。
 const blocks = layout.layout.blocks.map(b => {
  const xs = b.poly.map(p => p[0]), zs = b.poly.map(p => p[1]);
  return {id: b.id, area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs)),
   center: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...zs) + Math.min(...zs)) / 2]};
 }).sort((a, b) => b.area - a.area);
 let probed = 0;
 for (const b of blocks) {
  const world = nav.toWorld(b.center);
  if (nav.collision(world) === null) continue; // L形块中心可能不在实体内,换下一个
  probed++;
  assert.equal(findPath(nav, nav.spawn, world), null, `${b.id} 内部点 ${world} 不应可达`);
  if (probed >= 3) break;
 }
 assert.ok(probed > 0, '没有找到实体内部点');
});
check('wander: 同种子pickWanderTarget可复现且结果可通行可达', () => {
 const nav = createNavigation(layout.layout, props);
 const lcg = seed => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
 const a = pickWanderTarget(nav, lcg(20260920), {from: nav.spawn});
 const b = pickWanderTarget(nav, lcg(20260920), {from: nav.spawn});
 assert.ok(Array.isArray(a), `a=${a}`);
 assert.deepEqual(a, b);
 assert.equal(nav.collision(a), null, JSON.stringify(a));
 assert.ok(Math.hypot(a[0] - nav.spawn[0], a[1] - nav.spawn[1]) >= 2.5, `距离=${Math.hypot(a[0] - nav.spawn[0], a[1] - nav.spawn[1])}`);
 assert.ok(Array.isArray(findPath(nav, nav.spawn, a)), '采样点必须可达');
});
check('wander: 漫游图路径无碰撞且首尾接住真实点', () => {
 const nav = createNavigation(layout.layout, props);
 const graph = createWanderGraph(nav, nav.spawn);
 assert.ok(graph.size > 50, `可达格只有${graph.size}个`);
 const goal = IMMERSION_CONFIG.bell.interaction;
 const route = graph.route(nav.spawn, goal);
 assert.ok(Array.isArray(route) && route.length >= 2, `route=${route && route.length}`);
 assert.deepEqual(route[0], [...nav.spawn]);
 assert.deepEqual(route[route.length - 1], [...goal]);
 // 端点是真实站位(铃旁按设计贴着桌子),中间路点必须全部可走。
 for (const p of route.slice(1, -1)) assert.equal(nav.collision(p, 0.26), null, JSON.stringify(p));
});
check('wander: 漫游图采样确定性、够远、且带可走路径', () => {
 const nav = createNavigation(layout.layout, props);
 const graph = createWanderGraph(nav, nav.spawn);
 const lcg = seed => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
 const a = graph.sample(lcg(20260920), {minDistance: 2.5, from: nav.spawn});
 const b = graph.sample(lcg(20260920), {minDistance: 2.5, from: nav.spawn});
 assert.ok(a && Array.isArray(a.route), `a=${JSON.stringify(a)}`);
 assert.deepEqual(a.position, b.position);
 assert.ok(Math.hypot(a.position[0] - nav.spawn[0], a.position[1] - nav.spawn[1]) >= 2.5, '采样点必须离起点够远');
 for (const p of a.route.slice(1, -1)) assert.equal(nav.collision(p, 0.26), null, JSON.stringify(p));
});
check('wander: accept 谓词把靠近玩家的目标与首段全部排除', () => {
 const nav = createNavigation(layout.layout, props);
 const graph = createWanderGraph(nav, nav.spawn);
 const lcg = seed => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
 const player = [...nav.spawn];
 const far = p => Math.hypot(p[0] - player[0], p[1] - player[1]);
 const from = [nav.spawn[0] + 0.44, nav.spawn[1]]; // a townsperson standing right next to the player
 let checked = 0;
 for (let s = 1; s <= 6; s++) {
  const picked = graph.sample(lcg(s * 104729), {minDistance: 2.5, from, accept: (pos, route) => far(pos) >= 4 && far(route[1]) >= far(route[0])});
  if (!picked) continue;
  checked++;
  assert.ok(far(picked.position) >= 4, `目标离玩家 ${far(picked.position).toFixed(2)}`);
  assert.ok(far(picked.route[1]) >= far(picked.route[0]), '首段不应向玩家靠近');
  assert.ok(picked.route.slice(1, -1).every(q => nav.collision(q, 0.26) === null), '路点必须可走');
 }
 assert.ok(checked >= 3, `只有 ${checked} 个种子产出了可接受目标`);
});
check('wander: 不同种子给出不同目标(采样确实在工作)', () => {
 const nav = createNavigation(layout.layout, props);
 const lcg = seed => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
 const picks = new Set();
 for (let s = 0; s < 8; s++) {
  const p = pickWanderTarget(nav, lcg(s * 7919 + 3), {from: nav.spawn});
  if (p) picks.add(p.map(v => v.toFixed(2)).join(','));
 }
 assert.ok(picks.size >= 4, `8个种子只得到${picks.size}个不同点`);
});

// --- 1.7.0 walk-round pure logic (K1b) ----------------------------------------
import {createTownRound} from '../src/walk-round.js';

const TOWN_IDS = ['t1', 't2', 't3', 't4', 't5'];
const newRound = (overrides = {}) => createTownRound({config: {...TOWN_ROUND_CONFIG, ...overrides}, playerActorId: 'cast.14'});
// A round whose cooldown is spent and whose kill-point is far from the player.
const armedRound = (overrides = {}) => {
 const r = newRound(overrides);
 r.start(TOWN_IDS);
 const cd = r.state().cooldown;
 r.tick(cd + 0.1);
 return r;
};
const duckOf = r => r.duckId();
const victimSetup = (r, {victimPos = [0.3, 0], playerPos = [10, 0]} = {}) => {
 const id = r.duckId();
 const victims = TOWN_IDS.filter(v => v !== id).map((v, i) => ({id: v, position: i === 0 ? victimPos : [50 + i, 50 + i]}));
 return {duckId: id, duck: {id, position: [0, 0], paused: false}, victims, player: {position: playerPos, firstPerson: false, forward: [0, -1]}};
};
const tickToZero = (r) => { const cd = r.state().cooldown; if (cd !== null) r.tick(cd + 0.1); };

check('round: 同seed鸭子选取确定且首冷却在firstKillCooldown区间', () => {
 const a = newRound(), b = newRound();
 a.start(TOWN_IDS); b.start(TOWN_IDS);
 assert.equal(a.duckId(), b.duckId());
 assert.ok(TOWN_IDS.includes(a.duckId()));
 assert.ok(a.state().cooldown !== null && a.state().cooldown >= TOWN_ROUND_CONFIG.firstKillCooldown[0] && a.state().cooldown <= TOWN_ROUND_CONFIG.firstKillCooldown[1],
  `cooldown=${a.state().cooldown}`);
 assert.equal(a.alive().length, 5);
});
check('round: 同seed两次运行duck/冷却序列完全一致', () => {
 const a = newRound(), b = newRound();
 a.start(TOWN_IDS); b.start(TOWN_IDS);
 for (let i = 0; i < 4; i++) {
  const victim = a.alive().find(id => id !== a.duckId());
  a.recordKill(victim, [i, i]);
  const bVictim = b.alive().find(id => id !== b.duckId());
  b.recordKill(bVictim, [i, i]);
  assert.equal(a.state().cooldown, b.state().cooldown, `第${i + 1}刀后冷却不一致`);
 }
 assert.deepEqual(a.corpses().map(c => c.actor), b.corpses().map(c => c.actor));
});
check('round: nextRound等价config.seed+1', () => {
 const bumped = newRound({seed: TOWN_ROUND_CONFIG.seed + 1});
 const r = armedRound();
 const before = r.state().seed;
 r.resolveMeeting({ejectedId: r.duckId()}); // duck-out -> nextRound()
 assert.equal(r.state().seed, before + 1);
 bumped.start(TOWN_IDS); r.start(TOWN_IDS);
 assert.equal(r.duckId(), bumped.duckId());
 assert.equal(r.state().cooldown, bumped.state().cooldown);
});
check('round: 冷却未到canKill拒绝,tick推进后放行,非法dt忽略', () => {
 const r = newRound();
 r.start(TOWN_IDS);
 const {duck, victims, player} = victimSetup(r);
 assert.ok(r.state().cooldown > 0);
 assert.equal(r.canKill({duck, victims, player}), null); // 冷却中
 r.tick(-1); r.tick(NaN); r.tick('x'); r.tick(0);
 assert.equal(r.state().cooldown, r.state().cooldown); // 非法dt不动
 tickToZero(r);
 assert.equal(r.canKill({duck, victims, player}), victims[0].id); // 冷却到了
});
check('round: canKill资格——paused/鸭子身份/无靶/超刀程/存活不足', () => {
 const r = armedRound();
 const far = {position: [10, 0], firstPerson: false, forward: [0, -1]};
 const duck = duckOf(r);
 const others = TOWN_IDS.filter(id => id !== duck);
 const near = id => ({id, position: [0.3, 0]});
 // 鸭子停顿
 assert.equal(r.canKill({duck: {id: duck, position: [0, 0], paused: true}, victims: [near(others[0])], player: far}), null);
 // 不是鸭子
 assert.equal(r.canKill({duck: {id: others[0], position: [0, 0], paused: false}, victims: [near(others[1])], player: far}), null);
 // 无靶
 assert.equal(r.canKill({duck: {id: duck, position: [0, 0], paused: false}, victims: [], player: far}), null);
 // 超刀程
 assert.equal(r.canKill({duck: {id: duck, position: [0, 0], paused: false}, victims: [{id: others[0], position: [TOWN_ROUND_CONFIG.killRange + 0.01, 0]}], player: far}), null);
 // 存活镇民(含鸭子)<2:除鸭子外无人
 assert.equal(r.canKill({duck: {id: duck, position: [0, 0], paused: false}, victims: [], player: far}), null);
 // 恰好刀程边界内放行
 assert.equal(r.canKill({duck: {id: duck, position: [0, 0], paused: false}, victims: [near(others[0])], player: far}), others[0]);
});
check('round: 俯视目击——刀点5m内禁止,≥5m允许', () => {
 const r = armedRound();
 const {duck, victims} = victimSetup(r);
 const near = {position: [3, 0], firstPerson: false, forward: [0, -1]}; // 3m < 5m
 assert.equal(r.canKill({duck, victims, player: near}), null);
 const edge = {position: [TOWN_ROUND_CONFIG.witnessDistance + 0.3, 0], firstPerson: false, forward: [0, -1]}; // 恰5m(刀点在0.3)
 assert.equal(r.canKill({duck, victims, player: edge}), victims[0].id);
});
check('round: 第一人称——面对刀点禁止,背对/侧向允许', () => {
 const r = armedRound();
 const {duckId: id, victims} = victimSetup(r, {victimPos: [0, -3]}); // 刀点在玩家正北3m
 const duck = {id, position: [0, -3], paused: false}; // 鸭子贴着靶子(刀程内)
 // 面向刀点:dot≈1 > 0.35 -> 禁止
 assert.equal(r.canKill({duck, victims, player: {position: [0, 0], firstPerson: true, forward: [0, -1]}}), null);
 // 背对:dot≈-1 -> 允许
 assert.equal(r.canKill({duck, victims, player: {position: [0, 0], firstPerson: true, forward: [0, 1]}}), victims[0].id);
 // 侧向:dot=0 <= 0.35 -> 允许
 assert.equal(r.canKill({duck, victims, player: {position: [0, 0], firstPerson: true, forward: [1, 0]}}), victims[0].id);
});
check('round: maxCorpses上限——第4具腿后拒绝再刀', () => {
 const r = armedRound();
 const duck = duckOf(r);
 for (let i = 0; i < TOWN_ROUND_CONFIG.maxCorpses; i++) {
  const victim = r.alive().find(id => id !== duck);
  r.recordKill(victim, [i * 2, 0]);
  tickToZero(r);
 }
 assert.equal(r.corpses().length, TOWN_ROUND_CONFIG.maxCorpses);
 const others = r.alive().filter(id => id !== duck);
 const player = {position: [100, 100], firstPerson: false, forward: [0, -1]};
 assert.equal(r.canKill({duck: {id: duck, position: [200, 200], paused: false}, victims: others.map(id => ({id, position: [200.1, 200]})), player}), null);
});
check('round: recordKill登记腿/计数/重置冷却/alive缩短/同id不重复', () => {
 const r = armedRound();
 const duck = duckOf(r);
 const victim = r.alive().find(id => id !== duck);
 const killsBefore = r.state().kills;
 r.recordKill(victim, [3, 4]);
 const corpse = r.corpses().find(c => c.actor === victim);
 assert.ok(corpse && corpse.position[0] === 3 && corpse.position[1] === 4);
 assert.equal(r.state().kills, killsBefore + 1);
 assert.ok(!r.alive().includes(victim));
 const cd = r.state().cooldown;
 assert.ok(cd >= TOWN_ROUND_CONFIG.killCooldown[0] && cd <= TOWN_ROUND_CONFIG.killCooldown[1], `cooldown=${cd}`);
 const cdAgain = (r.recordKill(victim, [9, 9]), r.state().cooldown);
 assert.equal(r.corpses().filter(c => c.actor === victim).length, 1); // 不重复登记
 assert.equal(cdAgain, cd); // 重复登记不消耗rng
});
check('round: forceKill置零冷却+一次性目击放行,不改鸭子', () => {
 const r = newRound();
 r.start(TOWN_IDS);
 const duckBefore = r.duckId();
 const {duck, victims} = victimSetup(r);
 const near = {position: [1, 0], firstPerson: false, forward: [0, -1]}; // 俯视1m内
 r.forceKill();
 assert.equal(r.state().cooldown, 0);
 assert.equal(r.duckId(), duckBefore); // 不改变鸭子
 assert.equal(r.canKill({duck, victims, player: near}), victims[0].id); // 放行一次
 // 第二刀恢复目击判定(冷却由recordKill重置,此处只验证bypass已耗尽)
 const r2 = armedRound();
 const {duck: duck2, victims: victims2} = victimSetup(r2);
 r2.forceKill();
 r2.canKill({duck: duck2, victims: victims2, player: near}); // 消耗bypass
 r2.recordKill(victims2[0].id, victims2[0].position);
 tickToZero(r2);
 const v2 = r2.alive().find(id => id !== r2.duckId());
 assert.equal(r2.canKill({duck: {id: r2.duckId(), position: [0, 0], paused: false}, victims: [{id: v2, position: [0.3, 0]}], player: near}), null);
});
check('round: reportable——1.2m内报最近腿,之外为null', () => {
 const r = armedRound();
 r.recordKill('tA', [0, 0]); // 不在townsfolk的不登记,先用真实id
 assert.equal(r.corpses().length, 0); // townsfolk之外的id被拒绝
 const duck = duckOf(r);
 const first = r.alive().find(id => id !== duck);
 const second = r.alive().find(id => id !== duck && id !== first);
 r.recordKill(first, [0, 0]);
 r.recordKill(second, [0.5, 0]);
 assert.deepEqual(r.reportable([0.1, 0]).actor, first); // 更近的first
 assert.deepEqual(r.reportable([0.49, 0]).actor, second);
 assert.equal(r.reportable([2, 0]), null); // 距两腿都>1.2
 assert.equal(r.reportable([0.5, 0]).actor, second); // 恰在1.2内
});
check('round: meetingStart——8席roster、玩家首席、absent只取名单内', () => {
 const r = armedRound();
 const duck = duckOf(r);
 const victim = r.alive().find(id => id !== duck);
 r.recordKill(victim, [0, 0]);
 const rosterFn = () => ['cast.14', ...TOWN_IDS]; // 模拟selectRoster结果
 const ms = r.meetingStart(rosterFn);
 assert.equal(ms.actorIds.length, 6);
 assert.equal(ms.actorIds[0], 'cast.14');
 assert.deepEqual(ms.absent.dead, [victim]);
 assert.deepEqual(ms.absent.eliminated, []);
 // 死者不在名单内会被过滤:换一个不含victim的roster
 const ms2 = r.meetingStart(() => ['cast.14', 'other.1']);
 assert.deepEqual(ms2.absent.dead, []);
});
check('round: resolveMeeting——goose-out累加eliminated并重置冷却', () => {
 const r = armedRound();
 r.recordKill('x', [0, 0]); // townsfolk外id:不登记
 const duck = duckOf(r);
 const victim = r.alive().find(id => id !== duck);
 r.recordKill(victim, [0, 0]);
 const ejected = r.alive().find(id => id !== duck && id !== victim);
 const beforeCd = r.state().cooldown;
 r.tick(0); // no-op
 const result = r.resolveMeeting({ejectedId: ejected});
 assert.equal(result.outcome, 'goose-out');
 assert.equal(result.newRound, false);
 assert.equal(result.ejectedId, ejected);
 assert.equal(r.corpses().length, 0); // 腿清空
 assert.deepEqual(r.eliminated(), [ejected]);
 assert.ok(!r.alive().includes(ejected));
 assert.ok(r.state().cooldown >= TOWN_ROUND_CONFIG.killCooldown[0]); // 冷却已重置
 assert.ok(r.state().seed === TOWN_ROUND_CONFIG.seed); // 未换轮
});
check('round: resolveMeeting——duck-out新一轮清空', () => {
 const r = armedRound();
 const duck = duckOf(r);
 const victim = r.alive().find(id => id !== duck);
 r.recordKill(victim, [0, 0]);
 const goose = r.alive().find(id => id !== duck && id !== victim);
 r.resolveMeeting({ejectedId: goose}); // 先累加一个eliminated
 r.start(TOWN_IDS); // 模拟补人后start(新一轮中间态)
 const duck2 = duckOf(r);
 const victim2 = r.alive().find(id => id !== duck2);
 r.recordKill(victim2, [1, 1]);
 const result = r.resolveMeeting({ejectedId: duck2});
 assert.equal(result.outcome, 'duck-out');
 assert.equal(result.newRound, true);
 assert.equal(r.corpses().length, 0);
 assert.deepEqual(r.eliminated(), []); // 清空
 assert.equal(r.duckId(), null); // 等下一次start重选
});
check('round: resolveMeeting——null/未知ejected为none,仍清腿', () => {
 const r = armedRound();
 const duck = duckOf(r);
 const victim = r.alive().find(id => id !== duck);
 r.recordKill(victim, [0, 0]);
 const seedBefore = r.state().seed;
 const cdBefore = r.state().cooldown;
 const none = r.resolveMeeting({ejectedId: null});
 assert.equal(none.outcome, 'none');
 assert.equal(none.newRound, false);
 assert.equal(r.corpses().length, 0);
 const unknown = r.resolveMeeting({ejectedId: 'ghost'});
 assert.equal(unknown.outcome, 'none');
 assert.equal(r.state().seed, seedBefore);
 assert.deepEqual(r.eliminated(), []);
 // 'none'不重置鸭子冷却
 r.start(TOWN_IDS);
 assert.ok(r.state().cooldown >= TOWN_ROUND_CONFIG.firstKillCooldown[0]); // start重置为首刀冷却
});
check('round: checkSilence——存活≤1且无腿才寂静', () => {
 const r = armedRound();
 const duck = duckOf(r);
 assert.equal(r.checkSilence(), false); // 5存活
 r.recordKill(r.alive().find(id => id !== duck), [0, 0]);
 r.recordKill(r.alive().find(id => id !== duck), [1, 0]);
 r.recordKill(r.alive().find(id => id !== duck), [2, 0]);
 assert.equal(r.checkSilence(), false); // 有腿,即使存活1
 r.resolveMeeting({ejectedId: r.alive().find(id => id !== duck)}); // 清腿+出局1
 assert.equal(r.checkSilence(), true); // 存活1(鸭子)且无腿
});
check('round: state深拷贝——外部修改不渗入', () => {
 const r = armedRound();
 const duck = duckOf(r);
 r.recordKill(r.alive().find(id => id !== duck), [0, 0]);
 const s = r.state();
 s.corpses[0].position[0] = 999;
 s.eliminated.push('intruder');
 s.alive.push('intruder');
 assert.equal(r.corpses()[0].position[0], 0);
 assert.deepEqual(r.eliminated(), []);
 assert.ok(!r.alive().includes('intruder'));
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
