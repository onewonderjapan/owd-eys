# 镇民刀人 · 腿 · 拉腿开会 设计（1.7.0 / walk-round）

版本：设计 1.0（2026-09-25，Claude，W2；机主已批准 `C:/3d/eys/PLAN_NEXT_20260925.md` 第 4、6 节的推荐项）。
状态：可交 ZCode 施工（任务书 `C:/3d/eys/PLAN_FLASH_20260927.md`）。数值是设计目标，施工后以冒烟实测为准。

## 0. 官方参考与改编边界

| 已核实（多源一致） | 本次采用 | 不能据此声称 |
|---|---|---|
| 原作被刀者尸体以「鹅腿」标识留在原地；社区叫「腿」，报警叫「拉腿」 | 尸体 = 同色身体下沉、双腿带脚掌朝天竖起的卡通造型，无血 | 腿的精确角度/身体露出程度（**待机主补官方截图**，登记方式同 `water-reference.md`，图不进 `src/`） |
| 报警键 R，报警后全体直接进会议 | 键 E 与 R 都接受；报警后跳过按铃直接入座 | 原作会议前有本项目的「发现演出」 |
| 拆弹鸭炸死只剩「冒烟的脚」且不能报警 | 反证普通尸体是可报警的腿/脚造型 | 本项目实现任何炸弹机制 |
| 尸体颜色跟随受害者；部分杀手瞬移到受害者身上 | 腿的身体圆片取受害者主色；鸭子只「顺路」刀，不瞬移 | 原作刀人冷却秒数与刀程（**未核实**，本项目自定） |
| 死后为灵体，不能做任务 | 1.7.0 不刀玩家；玩家被刀与灵体视角放 1.7.1 | — |

## 1. 范围

| 纳入这一轮 | 暂不纳入 |
|---|---|
| 镇民中暗藏 **1 位鸭子**（同一颗种子 LCG 选出，玩家不知道是谁；`state()` 里可读，UI 绝不显示） | 玩家当鸭子；多鸭子；身份技能；任务与破坏 |
| 鸭子在「冷却到期 + 靶子在刀程内 + 玩家不在目击范围」时自动刀镇民，0.6 s 动作 | 刀玩家（1.7.1）；追杀（改变闲逛策略会露馅） |
| 被刀者原地变**腿**，留到下一次会议结束；同时最多 `maxCorpses` 4 具 | 尸体搬运、沉洞、剑客式站立尸体；S1 专用尸体 GLB（1.7.x/R3） |
| 玩家走近腿 → 提示「E 报警」（R 亦可）+ 触摸「报警」按钮 → 1.0 s 发现演出 → 直接 `seating` | NPC 自动发现并报警；第一轮只能拉腿等房规 |
| 会议 8 席固定：**死者椅子空着、票卡红叉不可选**；已出局者椅子空着、票卡灰化；票数只在在场者中分配 | 死者灵体旁听；桌面按人数收缩（1.7.x） |
| 会后：出局者从小镇消失；鸭子出局 →「鸭子出局，小镇安全」→ 新一轮；镇民只剩 1 位且无腿 →「小镇陷入寂静」→ 新一轮 | 原作完整胜负规则；计分、统计 |
| 镇民桌面 5 / 手机 3（各 +1），受性能门约束可回退 4/2 | 更多镇民 |
| reduced-motion：倒地无动画直接切腿；发现演出只做淡入淡出与静态浅红边 | 震屏、闪红、尖叫 |

不做联机/后端；非商用二创边界不变；官方截图不进 `src/`、资产清单与部署包；`map-scene.json`/`map-walk-props.json`/`assets-manifest.json` 一字不改；零新资产、零 npm install。

## 2. 规则与数值（正本：`immersion-config.js` 新导出 `TOWN_ROUND_CONFIG`；模块内零硬编码）

```js
export const TOWN_ROUND_CONFIG = Object.freeze({
 seed: 20260927,
 firstKillCooldown: [25, 40],   // s，进入漫游、镇民加载完成后计
 killCooldown: [20, 35],        // s，其后每刀
 killRange: 0.7,                // 鸭子与靶子水平距离
 witnessDistance: 5.0,          // 玩家离刀点 < 此值视为可能目击（俯视下直接禁止）
 witnessForwardDot: 0.35,       // 第一人称：刀点方向与视线点积 > 此值才算看见；否则允许
 killDuration: 0.6,             // 刀人动作时长（reduced-motion 为 0）
 fleeDistance: 4.0,             // 刀后鸭子选路的最小距离
 reportDistance: 1.2,           // 出「报警」提示的距离
 maxCorpses: 4,
 corpse: Object.freeze({footRise: 0.18, discRadius: 0.25, discThickness: 0.04, sink: 0.02}),
 reporting: 1.0,                // 发现演出时长（新阶段）
 summary: 3.0,                  // 会后小结卡停留
});
```

`WALK_NPC_CONFIG.count` 4 → 5，`mobileCount` 2 → 3（性能门不过则回退并在报告写明）。

- **鸭子选取**：镇民全部加载完成的那一帧，用 `seed` 派生的 LCG 在镇民中选 1 位。同一局重播可复现。
- **冷却**：只在漫游帧走（busy/paused 不调 `tick`，与镇民一致）。
- **刀人资格**（每帧判定，命中即开始动作）：鸭子不在停顿、靶子为存活镇民且距离 ≤ `killRange`；玩家与刀点距离 ≥ `witnessDistance`，**或**玩家处于第一人称且刀点方向与视线点积 < `witnessForwardDot`；存活镇民（含鸭子）≥ 2；腿数 < `maxCorpses`。不满足则什么都不做，鸭子继续闲逛。
- **刀人动作**（`killDuration`）：鸭子面向靶子小步前冲 0.15 m；靶子身体绕自身前后轴倾倒 90°（`visual.rotation.z` 0 → π/2，ease-out）；结束一帧切换成腿；鸭子随即选一条 ≥ `fleeDistance` 的路线走开。音频只一声很轻的 `kill:thud`（可静音）。
- **腿的造型**（方案 A，复用受害者已加载的 avatar，零新资产）：
  1. 隐藏 `model` 下全部网格，仅保留名字匹配 `/foot|shin|webbed[\s_]paddle|toe[\s_]seam/i` 的脚部网格（GLTFLoader 会把空格换成 `_`，正则两种都接受；不硬编码 `.080` 等导出尾号）。
  2. `model.rotation.x = π`（脚朝天），再平移使可见脚部包围盒 `max.y ≈ footRise`、`min.y ≈ -sink`（略入地）。
  3. 在 `player` 下加一块受害者主色的扁圆「身体」（半径 `discRadius`、厚 `discThickness`，颜色取模型中 `userData.recolor` 网格的材质色）；保留原阴影贴片；移除脚下金色光环 marker。
  4. 腿不再参与闲逛、避让与气泡；`disposeWalkingAvatar` 仍由镇民模块在清除时统一执行（单一所有者，不双重 dispose）。
- **报警**：玩家与任一腿水平距离 ≤ `reportDistance` 且非 busy/paused/拍照/弹窗 → HUD 提示「E 报警」（`<kbd>E</kbd>`，帮助文案写「E 或 R」），触摸端显示「报警」按钮。提示优先级：报警 > 按铃/按钮开会 > 查看位置。
- **发现演出**（新阶段 `reporting`，`TIMED_NEXT.reporting = 'seating'`，可 SKIP）：复用按铃阶段的「借玩家模型入世界场景 + 头部挂点」机制，镜头在玩家眼位、面朝腿并略俯视；画面边缘一次红色渐晕（0 → 0.6 → 0，reduced-motion 为静态 0.25 浅红边）；HUD 横幅「发现尸体！」；音频 cue `report:alarm`（短促合成警报，可静音）。结束进入 `seating`，**不经过 `ringing`**。
- **会议名单**：`START` 事件新增 `entry: 'ring' | 'report'` 与 `absent: {dead: [...], eliminated: [...]}`。名单仍 8 席、玩家首席、来源仍是 `rosterCandidates`；在场者 = 名单 − dead − eliminated。只加载在场演员；死者/出局者的椅子空着（椅子本身仍在）。`SELECT` 拒绝不在场者；`computeVotes` 只在在场者中分配：在场 n 人（玩家首席），前 `ceil(n/2)` 票投目标，最后 1 人弃票，其余投「下一位不同的在场者」——目标必为最多票。`selfDemo` 不变（在场 NPC 全投玩家）。
- **会后结算**（`finalize` 回调新增 `{ejectedId, wasDuck}`，由 `map-walk.js` 转交镇民模块）：出局者从镇民列表移除并释放；全部腿清除并释放。`wasDuck` → 小结卡「鸭子出局，小镇安全」`summary` 秒 → 新一轮（seed+1、`eliminated` 清空、补满镇民、重选鸭子）；否则 →「〈标签〉是无辜的鹅」→ 本轮继续，鸭子冷却按 `killCooldown` 重置。若玩家 CANCEL/Esc 退出会议：腿保留、无人出局。
- **寂静**：存活镇民 ≤ 1 且无腿可报 → 小结卡「小镇陷入寂静」→ 新一轮。
- **与现有系统**：腿属世界场景，会议/出局在独立 Scene，不受影响；拍照模式保留腿、不出气泡；黄昏/闪烁不感知；busy 期间镇民与腿一起 `setHidden(true)`（按铃/发现演出借用世界场景时腿仍隐藏，避免入画抢戏）；进入 walk 的 `stop()` 释放一切。

## 3. 模块与接口

| 文件 | 改动 |
|---|---|
| `src/immersion-config.js` | `TOWN_ROUND_CONFIG`；`WALK_NPC_CONFIG.count/mobileCount` 5/3；`selectRoster` 不变 |
| **新** `src/walk-round.js` | **纯逻辑，零 Three/DOM**。`createTownRound({config, playerActorId})` → `{start(townsfolkIds), tick(dt), canKill({duck, victims, player}) , recordKill(id, pos), reportable(playerPos), meetingStart(rosterFn) → {actorIds, absent}, resolveMeeting({ejectedId}) → {outcome:'duck-out'|'goose-out'|'none', newRound}, checkSilence(), duckId(), alive(), corpses(), eliminated(), state()}`。`canKill` 的 `player` 形如 `{position, firstPerson, forward:[x,z]}` |
| `src/walk-npcs.js` | 接 `round`：刀人动作、腿造型、出局移除、新一轮补人、腿 hidden 同步；`state()` 增 `round: {duck, corpses:[{actor,position}], eliminated, cooldown, kills}` |
| `src/immersion-state.js` | 阶段 `reporting`（READY 时按 `entry` 进 `ringing` 或 `reporting`；`SKIP` 可跳）；`START` 的 `entry`/`absent`；`SELECT`/`computeVotes` 排除不在场者；`snapshot()` 增 `entry`、`absent` |
| `src/immersion-director.js` | `begin({entry:'report', corpse:{actorId, position}})` 时以 `reportDistance` 代替铃/按钮距离判定；`reporting` 阶段机位（复用 ring 借体机制）、渐晕、cue；`loadSession` 只加载在场者；`finalize` 回调带 `ejectedId`/`wasDuck` |
| `src/immersion-meeting.js` | 不在场者座位不放演员，椅子保留 |
| `src/immersion-ui.js` / `immersion.css` | 票卡 `data-dead`（红叉、`disabled`）与 `data-eliminated`（灰化、`disabled`）；`reporting` 横幅「发现尸体！」；顶栏一行「本轮发现：〈标签〉」 |
| `src/map-walk.js` / `hud-fragment.html` | `reportTrigger()` 与 `meetingTrigger()` 并列；键 E/R；触摸「报警」按钮；`#walk-round-toast` 小结卡；`?round=force-kill` 调试钩子；`state().walk.reportable` |
| `src/immersion-audio.js` | cue `report:alarm`、`kill:thud` |
| `scripts/test-immersion.mjs` | 见 §4 |
| `scripts/smoke-immersion.mjs`、`smoke-visual.mjs` | 见 §4 |
| `README.md`、`hud-fragment.html` 帮助 | 玩法段与按键说明 |

## 4. 可测性与验收

**纯逻辑（目标 38 → ≥ 48）**：鸭子选取确定性（同 seed 同结果）；冷却在 busy/paused 不走；`canKill` 在目击范围内返回 null、俯视 5 m 内返回 null、第一人称背对时允许；`maxCorpses` 上限；`meetingStart` 名单 8 席、玩家首席、absent ⊂ 名单；`SELECT` 拒绝 dead/eliminated；`computeVotes` 对 absent 0~4 人都让目标严格最多票且总票数 = 在场人数；`resolveMeeting` 鸭子出局 → 新一轮清空；非鸭子 → eliminated 累加；`checkSilence`。

**冒烟（桌面 + 手机）**，`?round=force-kill`（首帧镇民 ≥ 2 即置冷却为 0 并放开目击判定一次；不影响默认路径）：
1. 等 `state().walk.npcs.round.corpses.length === 1`（≤ 10 s）；截 `corpse-close.png`（走到 1.2 m 处第一人称）。
2. 距离 ≤ 1.2 时 `state().walk.reportable` 非空且提示文字含「报警」；> 1.2 为空。
3. KeyR → 阶段 `reporting` → `seating`（`immersion.entry === 'report'`，全程未出现 `ringing`）；截 `report-pov.png`；手机用「报警」按钮。
4. 投票阶段：`[data-dead]` 票卡数 = 1 且 `disabled`；可选票卡数 = 在场 NPC 数；`snapshot().absent.dead` 与镇民 `corpses` 一致。
5. 投出一位非死者 → 结果票数 = 在场票数、目标最多 → 出局演出 → 返回；返回后该 actor 不在 `npcs.npcs`，`corpses` 为空，`#walk-round-toast` 文本含「无辜」或「安全」。
6. 连续 3 轮（force-kill → 报警 → 投票 → 返回）`renderer.info.memory` 几何/材质数不增长。
7. reduced-motion 变体：倒地无过渡、渐晕静态。

**视觉门新帧**：`corpse-close`、`report-pov`、`voting-dead`（同现有相对阈值；基线首次运行只补缺）。

**性能门**：镇民 5 位 + 腿 ≤ 4；漫游 p95 帧时相对 1.6.0 基线劣化 > 15% 则回退 4/2。

**肉眼验收（机主）**：A 腿近景「一眼认出是鹅鸭杀的腿」；B 发现演出红晕不刺眼；C 会议死者空椅 + 红叉可读；D 小结卡文字与真实结果一致。A 不过则转 S1 建模（1.7.x），不在方案 A 上反复调。

## 5. 边界与风险

- **露馅**：鸭子只顺路刀，可能几十秒无事发生；冷却上限 40 s 已考虑。不为此加追杀。
- **性能**：腿只留脚部网格 + 一块圆片，三角数远小于整鹅；仍走性能门。
- **手机**：3 位镇民一刀后剩 2，会议 8 席多为空椅；接受，1.7.x 再议收缩。
- **无血腥**：与设计 1.2 一致；无血迹、无尖叫。
- **确定性**：全部随机走同一颗种子；`force-kill` 只改冷却与目击放行，不改种子。
- **旧 HTML**：`#walk-round-toast`/报警按钮缺失时模块静默降级（无小结卡、键盘 E/R 仍可报警）。
