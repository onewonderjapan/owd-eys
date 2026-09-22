# immersion-ejection.js 机械拆分映射 · 2026-09-23(F1)

源文件:`src/immersion-ejection.js`(1279 行 / 60KB,拆分前基线 = `9ac5776`)。
拆分为纯机械重构:分支体逐行搬运(仅缩进调整),`createEjectionStage` / `EJECTION_STYLE_DURATION`
导出面不变,未知 style 落 flush 的 `else` 语义由注册表 `?? buildFlushStage` 等价保留。

## 目标结构

- `src/ejection/common.js` — 共享 scratch 向量、数学/轨迹工具、前奏上下文 `createEjectionContext()`、尾声 `finishStage(ctx, build)`。
- `src/ejection/stage-<style>.js` ×8 — 每个导出同签名 `buildStage(ctx)`,内容 = 原 style 分支体。
- `src/immersion-ejection.js` — 收缩为注册表(静态 import ×8 + style→builder 映射),导出面不变。

## 行号区间 → 目标模块

| 原行号 | 内容 | 去向 |
|---|---|---|
| 1–16 | import + 模块级 scratch(UP、tmpMat、tmpVecA–E、tmpLink、tmpEnd、tmpScale、tmpQuat、TWIST_Q) | common.js(具名导出,全舞台共享同一组实例,语义与原模块级变量一致) |
| 17–19 | lerp / clamp01 / ease | common.js |
| 20–32 | track()(平滑路点轨迹,写入 out,零分配) | common.js |
| 33–47 | softFlameTexture() | stage-fire.js(唯一使用者) |
| 48–66 | softBubbleTexture() | stage-water.js(唯一使用者) |
| 68–94 | createEjectionStage 前奏:scene/camera/owned/take/stage/reduced/lastPose/poseOnce | common.js `createEjectionContext()` |
| 95–109 | 常量(dockDeckY/sinkX/chainLength/stoneScale/eyeH/pitX/bindLocal)+ escorts/watchers + faceYaw | common.js ctx |
| 110–128 | watcherSimplify/escortSimplify/hiddenParts/setHiddenParts(毫米级细节隐藏) | common.js ctx |
| 130–137 | facePit()(使用 pitX) | common.js ctx |
| 140–455 | WATER 分支 | stage-water.js |
| 458–646 | FIRE 分支(flames/flameMat/flameTex 三个 let 随迁,仅 fire 使用) | stage-fire.js |
| 647–652 | E1–E6 注释头 | 随各舞台文件头部拆分 |
| 653–757 | SPACE (E1) 分支 | stage-space.js |
| 760–850 | QUICKSAND (E2) 分支 | stage-quicksand.js |
| 853–987 | CHANDELIER (E3) 分支 | stage-chandelier.js |
| 990–1074 | BOULDER (E4) 分支 | stage-boulder.js |
| 1077–1166 | BRIDGE (E5) 分支 | stage-bridge.js |
| 1169–1256 | FLUSH (E6) 分支(原 `else`,兜底一切未知 style) | stage-flush.js |
| 1258–1274 | stage.projection / detachActors / dispose(尾声,分支之后挂接) | common.js `finishStage(ctx, build)` |
| 1277 | createEjectionStage 收括号 | 注册表(构造 = createContext → finishStage) |
| 1279 | EJECTION_STYLE_DURATION | 留在注册表,原样 |

## 提交节奏与门

1. ①抽 common + 迁 water/fire(其余六个先变成本地 `build<Style>Stage(ctx)` 函数,注册表就地)→ 全门。
2. ②迁其余六个到 stage-*.js,注册表只留 import + 映射 → 全门。
3. ③旧文件死代码清扫 → 全门。

每步门:纯逻辑 38/38 → build → 桌面默认标签冒烟 74/74 → MOBILE 61/61 → STYLE ×8 逐样式全绿。
任何一条红:回退该步。

## 完成判据

- `immersion-ejection.js` ≤ 150 行;
- `grep -c "style==='" src/immersion-ejection.js` 只剩注册表处(预期 0,style 分派改查表);
- 冒烟计数与基线完全一致(74/61,拆分不许增减断言)。
