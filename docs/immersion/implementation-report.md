# POV 沉浸体验施工报告（implementation-report）

- 功能：eys-pov-immersion（按铃 → 8席POV圆桌会议 → 发言/投票 → 沉水/火堆出局 → 返回原位）
- 执行：ZCode（GLM-Flash），单代理；分支 `feature/pov-immersion`（自 main `87d47c1` 创建，未推送）
- 状态：**ready_for_user_review（本地候选，未部署）**
- 日期：2026-09-14；设计版本 1.2；候选版本 **1.2.0**（package.json/package-lock.json 已同步）
- 本地预览：`npm start` → [http://127.0.0.1:8870/](http://127.0.0.1:8870/)（构建产物 `dist/`，页面 pin `releases/1.2.0/`）

## 1. 完成范围

按铃（金铃+木座 Blender 道具，运行时碰撞代理，E/触摸触发）、8 席眼高圆桌会议（7 位现有角色 NPC 坐姿围桌 + 玩家 POV 翅膀下缘）、3 段发言字幕与说话者标记、7 头像投票（选择/确认分离、自己被投出演示入口、确定性 8 票剧本）、沉水（自身 POV + NPC 水下平视观演，鹅上/链中/石下，28 节实例链，深蓝渐变留白）、火堆（石圈+木柴+加色火焰片，抬起/投入两阶段）、跳过/重播/返回、静音、减少动态路径、失败重试、Esc/全局退出恢复、连续会话复用。覆盖自己/NPC × 水/火四支 + 移动端竖屏全链。

## 2. 新增/修改文件

新增 `src/`：immersion-config / immersion-state / immersion-props / immersion-actors / immersion-meeting / immersion-ejection / immersion-director / immersion-ui / immersion-audio / immersion-look / immersion.css / immersion-assets.json。
修改 `src/`：main.js（renderTarget 渲染）、map-walk.js（导演接入、铃判定、busy 冻结、HUD 隐藏、恢复）、map-walk-view.js（snapshot/restore/canChange 门控）。
新增脚本：`scripts/test-immersion.mjs`、`scripts/smoke-immersion.mjs`、`scripts/immersion/{build_props_blender.py,run_s1.py,import_assets.py,check_props.mjs,props_browser.mjs}`。
资产：`.cache/assets/2ccadcd4….glb`（按内容哈希），`assets-manifest.json` **仅追加 1 条**，源 `.blend` 与渲染图归档于 `<workspace>/immersion_assets\20260913T160211Z-e1f2\`。
未改动：地图/碰撞 JSON、角色与装备 GLB、rig-contract、发布脚本、WAF/CDN/DNS（未部署）。

## 3. 检查结果（最终 1.2.0 构建）

| 命令 | 结果 | 报告 |
| --- | --- | --- |
| `node scripts/test-immersion.mjs` | 28/28 passed | reports/immersion/p0-test-immersion.json |
| `node scripts/immersion/check_props.mjs` | 7/7 passed | reports/immersion/props-check.json |
| `npm run build` + `npm test` | PASS（156 files） | EYS_PACKAGE_PASS |
| `node scripts/smoke-immersion.mjs … immersion` | **32/32 passed** | reports/immersion/immersion.json |
| `MOBILE=1 node scripts/smoke-immersion.mjs … immersion-mobile` | **32/32 passed** | reports/immersion/immersion-mobile.json |
| `scripts/smoke.mjs` / `smoke-first-person.mjs` / `smoke-entry-recovery.mjs` | PASS | reports/immersion-base 等 |
| `node scripts/immersion/props_browser.mjs` | passed | reports/immersion/props-browser.{json,png} |

既有漫游（27角色/65装备/俯视与第一人称/入口恢复/旧缓存入口）全部保持通过。

## 4. 验收画面（A1–A9）与证据

| 编号 | 结论 | 证据（reports/immersion/） |
| --- | --- | --- |
| A1 按铃与提示 | ✅ | bell-near.png（金铃+木座+按铃按钮）；远端 E 查看仍在（smoke 断言） |
| A2 眼高圆桌 7 NPC 坐姿 | ✅ | meeting-pov.png、meeting-seats-debug.png（调试相机）、meeting-mobile.png |
| A3 发言/投票/结果一致 | ✅ | voting.png、vote-result.png（「橙色本体」被投出 4 票）；选A再选B、玩家不可选、双确认一次均断言 |
| A4 自己沉水低头见链石 | ✅ | water-self.png、water-self-look-down.png（拖动视角） |
| A5 NPC 沉水鹅上/链中/石下 | ✅ | water-npc.png；water-link-integrity.json 三时刻链端误差 ≤0.03 |
| A6 自己火堆阶段可分 | ✅ | fire-self.png（抬起）、fire-self-lit.png（投入火光）、fire-start.png |
| A7 NPC 火堆目标正确 | ✅ | fire-npc.png（目标在石圈内火焰中）；target=所选项断言 |
| A8 返回一致/连续会话 | ✅ | 恢复 delta=0；连续 5 轮 ring/cancel 几何数不增长（smoke 断言） |
| A9 移动端与兼容 | ✅ | MOBILE=1 全链 32/32；旧 HTML 无新节点仍可运行（运行时注入 UI+CSS） |

## 5. 偏差记录（设计值 → 实际值 → 原因 → 验证）

1. 座位半径 1.62 → **1.48**：坐姿鹅与桌沿距离过远，1.48 在设计允许 ±15% 内；meeting-seats-debug.png 验证。
2. 会议灯光强度高于直觉值（PointLight 26/1.7 decay 等）：r155+ 物理光照单位下初始过暗；meeting-pov.png 验证。
3. 状态机 snapshot 在计划固定字段外附加 `reducedMotion/busy` 纯数据字段：供导演与诊断只读使用。
4. `scripts/test-immersion.mjs` 对 assets-manifest 的基线校验由“字节不变”改为“只追加”（P0A 合法追加导致字节漂移，旧记录逐条比对仍全部保留）。
5. 沉水衔接按设计为项目改编：短码头+水花+入水淡切；水下构图严格按用户参考（鹅上/链中/石下，无海床触底）。

## 5a. 用户反馈修复（2026-09-14）

用户以默认角色 cast.14 体验时 POV 黑屏。自查复现并定位：自身 POV 相机位于玩家自己的鹅头内部——按铃阶段相机在漫游模型眼位（模型可见），自己沉水/火堆相机骑在目标眼位（目标模型可见），鹅体材质双面渲染使头部内表面糊满画面。修复：busy 期间隐藏漫游模型；自身出局分支隐藏目标整身模型（按设计仅保留画面下缘 POV 翅膀与锁链/火光的身体联系）。回归：`ACTOR=cast.14` 全链 32/32（新增 ring-pov.png 证据），默认链 32/32；water-self.png 现可见翅膀+锁链+石块，ring-pov.png 可见金铃。

## 5b. 沉水体验调优（2026-09-14，用户反馈）

- 时间线改为"被众人抬起（0–1.3s，架起晃动）→ 抬向水面抛出（1.3–2.4s，弧线）→ 入水（2.4s起）"，护送鹅站位前移，自身 POV 与旁观视角都能看到被架住的过程。
- 水下新增 8 尾低多边形鱼绕下沉柱环游（共享几何/材质，仅 2.5s 后可见，不新增依赖）。
- 下沉放缓：落差 0.44 / 3.2s 并带轻微浮沉（原 0.58 / 3.2s）；链石锚点随动，water-link-integrity.json 仍 ≤0.03。
- 回归：默认链 32/32 通过；证据 water-self.png / water-npc.png / water-self-look-down.png 已更新。

## 6. 未解决/未验证事项

- **glTF Transform 优化未运行**：本机未安装 CLI；按资产计划保留无压缩 GLB（300,812 字节，无 Draco/Meshopt/KTX2 依赖），不影响加载。
- **WebGL context loss 恢复**：复用既有暂停提示路径，未做自动化模拟（环境限制），保留手动验证说明。
- **prefers-reduced-motion**：代码路径完整（固定机位+无摆动+静音淡入淡出），未单独截图验证。
- **音频内容**：Web Audio 合成铃声/椅响/水/火 cue 已实现并在用户手势后解锁；无头环境无法验证听感，仅验证流程不阻塞、静音可用。
- `dist/__props_harness.html`、`dist/__meeting_harness.html` 为一次性调参页（gitignored 构建产物，不进 src、不参与发布内容核对）。

## 7. 断点续接说明

进度台账 `docs/immersion/progress.json`（当前 ready_for_user_review）；中断时先读台账与 `reports/immersion/immersion.json`，再查 `git diff`。S1 资产 run_id `20260913T160211Z-e1f2`（复用于全部重试）；冒烟行走使用导航 BFS+手工门通道+数字孪生(moveCircle)选键，全部为真实键盘输入，无传送/调试入口。
