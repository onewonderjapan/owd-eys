# 镇民闲逛与对话气泡设计(B4 / walk-npcs)

版本:设计 1.0(2026-09-20 夜间任务,见 PLAN_FLASH_20260920.md F1)。状态:随 feature/overnight-20260920 分支交付。

## 1. 范围

| 纳入这一轮 | 暂不纳入 |
| --- | --- |
| 漫游常驻 2~4 位镇民 NPC:出生在离玩家 ≥3.0 的可走点,沿 findPath 路点以 1.4 u/s 闲逛,到点停留 1.5~4.0s 再选新目标 | NPC 与玩家/互相之间的推挤碰撞(只做"距玩家 <0.9 原地等待",不改玩家 walker) |
| 头顶对话气泡:每 6~14s 说一句固定闲聊(2.8s),文案来自本地池,与会议 speechPool 零重复 | 任何 AI/联机对话、语音、玩家可触发 NPC 剧情任务 |
| busy(会议/出局演出)期间整体隐藏,回到漫游恢复;退出 walk 全部释放 | NPC 进房间开门、坐椅子、参与投票 |
| reduced-motion:气泡直接显隐(无淡入淡出),行走摇摆动画停用 | 夜晚/黄昏专属 NPC 行为(黄昏只改光照,NPC 不感知) |
| 手机端常驻 2 位(`mobileCount`),桌面 4 位(`count`) | 性能预算门(本轮只在冒烟记录 drawCalls/RAF/内存,不做门禁) |

不做联机/后端;非商用二创边界不变;官方截图不进 src/ 与生产资产;`map-scene.json`/`map-walk-props.json` 一字不改。

## 2. 技术方案

- **参数正本**:`immersion-config.js` 新导出 `WALK_NPC_CONFIG = {count: 4, mobileCount: 2, speed: 1.4, pauseRange: [1.5, 4.0], avoidPlayerRadius: 0.9, spawnMinDistance: 3.0, bubble: {duration: 2.8, cooldown: [6, 14], pool: [8 句]}}`(舞台/模块内零硬编码)。
- **寻路复用**:`findPath`/`pickWanderTarget` 已下沉 `src/map-walk-simulation.js`(F1.1,冒烟同源);NPC 移动走 `moveCircle`,与玩家同一套碰撞半径。
- **实现位置**:`src/walk-npcs.js` 新模块 `createWalkNpcs({scene, nav, config, getPlayerPosition, getPlayerActor, isMobile, reducedMotion, camera, host})`,返回 `{start, update, setHidden, setBubblesHidden, stop, state}`。`map-walk.js` 接线:
  - start():进入 walk 且玩家 avatar 就绪后启动;演员取 `rosterCandidates` 排除玩家后前 N 位,`loadWalkingAvatar` 顺序加载(并发 ≤ `maxConcurrentActorLoads`),出生点 `pickWanderTarget`。
  - frameLoop:roam 分支 `update(dt)`(暂停时自然不调 → 冻结);busy 分支顶部 `setHidden(true)`(与 `stopFlicker()` 同位),回 roam `setHidden(false)`;`stop()` 退出 walk 时 `npcs.stop()` 逐个 `disposeWalkingAvatar`。
  - 演出关系:会议 8 位 ActorSet 由 director 自建自管,行走 NPC busy 期整体隐藏,不存在"同一只鹅两处";两者不共享任何可释放资源。
- **气泡层**:运行时 ensure 一个 `#walk-npc-bubbles`(挂 `#viewport`,pointer-events:none,旧缓存 HTML 缺元素也不崩);每帧把 NPC 头顶点 `camera.project` 投到屏幕,相机后方或屏外即隐藏;拍照模式层整体隐藏(`#walk-npc-bubbles` 进 busy/photo 隐藏清单)。
- **确定性**:模块内一颗种子 LCG(同 `pickSessionSpeeches` 惯用法),出生点、闲逛目标、停顿时长、气泡文案全部可复现。

## 3. 边界与风险

- **性能**:首次把"多角色常驻"引入漫游(桌面 4 位 ≈ 每位 ~5k 三角形 + 阴影贴片)。本轮只在冒烟里记录 drawCalls/2s RAF/memory 作信息项;预算门留给下一轮(perf_probe 接发布门)。
- **卡墙**:NPC 沿路点走,moveCircle 滑墙;若推进量连续为 0(被道具新增代理卡住),原地小停后换目标,不会越界或穿墙。
- **旧 HTML**:气泡层/状态字段缺失时模块静默降级(无气泡、state 仍可用),不抛错。
