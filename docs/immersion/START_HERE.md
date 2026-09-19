# ZCode（GLM-Flash）施工入口：POV 会议与出局体验

> **当前状态（2026-09-20 复核）**：公网 **1.4.2 已发布**（2026-09-17）。后续功能排期按
> `C:/3d/eys/PLAN.md` **阶段 B** 推进；跨夜施工用自包含任务书系列 `C:/3d/eys/PLAN_FLASH_*.md`
> （每夜一份任务书 + 对应 REPORT，当前最新 `PLAN_FLASH_20260920.md`）。**状态正本是
> [progress.json](progress.json)**，每次只更新一行纪要；本文件其余段落均为历史记录，不再维护。
> 夜间基线（2026-09-20）：纯逻辑 35 项、桌面冒烟 72 项、手机冒烟 59 项，全绿。

> 【历史 · 2026-09-15 精修轮】**2026-09-15 精修轮状态（S3 完成）**：首轮 P0–P6 已完成（1.2.0 本地候选）。其后的「自身出局 POV 精修」经三段续接会话：S1 搭出 F1–F5 初版（遗留 6 项问题）；S2 修复全部遗留并重验；**S3 按用户脚本重排演出时间线**——水 9.5s 六拍（全员走来→举起→携行→岸边停顿→扔下→看着岸上的鹅缓慢下沉，默认视线逐拍编排）、火 6.3s 五拍（含行进列），时长集中在 immersion-config.js。最终验证：cast.14 水/火 0 失败 0 pageerror、NPC 主冒烟 32/32、REDUCE_MOTION 与 cast.02 专项 PASS、build+npm test 通过。详见 [self-pov-refinement-report.md](self-pov-refinement-report.md) 与 [self-pov-refinement-progress.json](self-pov-refinement-progress.json)。本地体验入口不变：`npm start` → http://127.0.0.1:8870/ 。后续以报告「剩余项」续接，不要按首轮 prompt 重做。

【历史 · 2026-09-15】状态：~~精修尚未施工~~ → **精修三段会话已完成（含用户脚本时间线），本地候选待用户验收画面。** 更新：2026-09-15。施工正本：`C:\3d\eys\owd-eys`。

## 【历史】当前入口：自身 POV 精修

用户本轮要求 review 自己被票出的场景，并给 ZCode 精修 prompt。已基于本地真实流程新拍桌面/平板/手机尺寸共 16 张图，发现翅膀悬浮与竖屏裁切、低头链石难读、火堆眼位跳变和效果占位问题。

- [本轮视觉审查及修改前截图](C:/3d/eys/owd-eys/.design/self-ejection-pov/DESIGN_REVIEW.md)
- [ZCode 本轮精修提示词](C:/3d/eys/owd-eys/docs/immersion/ZCODE_SELF_POV_REFINEMENT_PROMPT.txt)

首轮 progress.json/implementation-report.md 的流程 PASS 保留，但 A4/A6 的自身 POV 视觉结论由本轮审查补充为 needs_refinement。读取当前修改并按本轮 F1–F5 续做，不从 P0A 重造全部道具。以下首轮设计和启动文字保留供历史对照，不能直接作为本轮精修指令。

本次交付目标是可在本地浏览器完整体验的「走近法院铃 → 按铃 → 与其他鹅围坐圆桌 → 发言与投票 → 沉水或火堆出局 → 返回漫游」。保持现有地图数量，复用现有 27 位角色、65 个装备模块；完成的是单人 POV＋NPC 演出，不引入联网对局。

**已补沉水参考图：** 先看 [water-reference.md](water-reference.md)。水下画面采用鹅在上、长链连接下方石块、深蓝留白；设计1.2与P4已同步，早期待补图描述已由这份更新替代。

## 【历史】历史首轮启动提示词（本轮不使用）

直接复制下面这段，纯文本版见 [ZCODE_TONIGHT_PROMPT.txt](ZCODE_TONIGHT_PROMPT.txt)。本轮包含本地施工与S1道具制作；此处仅准备提示词，没有创建定时任务或启动ZCode。

```text
你是 ZCode，本次沿用 GLM-Flash，执行今晚的 EYS POV 沉浸体验施工。

工作目录：C:\3d\eys\owd-eys。
先读 C:\3d\eys\owd-eys\docs\immersion\START_HERE.md，
再读 C:\Users\蔡瀛杰\.codex\skills\eys-pov-immersion\SKILL.md。
按 design.md（1.2）、blender-assets-plan.md、water-reference.md、implementation-plan.md 和 progress.json 执行；官方及项目技能的具体路径在资产计划中，必须按职责使用。

目标：完成按铃 → 玩家与7位NPC围坐圆桌 → 发言和投票 → 沉水/火堆出局 → 返回原位置的本地可玩闭环。覆盖自己POV与NPC旁观，不增加地图或联机系统。

实体道具在S1用Blender制作，交付可编辑.blend与GLB；Three.js负责POV、交互、实例和动态效果。复用现有角色与装备。沉水按用户参考：鹅在上、长链、石块在下、深蓝水域；自己低头可看链石，NPC用水下平视镜头。

先核对实时Git状态与基线，保留已有修改；然后按 P0→P0A→P1–P6 顺序施工。W2维护代码/文档/资产归档，S1执行建模渲染，经SMB核hash收集。每阶段更新progress，记录run_id、日志、产物、检查结果和下一步；中断先查既有任务状态，从未通过阶段续接，不能盲目重跑。

直接推进已确定范围，不反复问常规实现选择。单代理，不派reviewer，不自行换模型，不追加多轮全量QC。遇到单点阻塞记录原因并继续独立工作；真实资产或视觉验收未通过不能用占位物/假PASS交差。

完成后交付本地预览、源Blender/GLB、按铃/圆桌/沉水/火堆的截图、验证报告和implementation-report.md。只做到本地候选，不推送、不部署、不改WAF/CDN/DNS、不调用付费服务、不删除文件。
```

## 阅读顺序与文件职责

1. [施工 skill](C:/Users/蔡瀛杰/.codex/skills/eys-pov-immersion/SKILL.md)：如何动手、如何接续、不可破坏的边界。
2. [design.md](design.md)：用户可见体验、镜头、造型、操作、参考证据与验收标准。
3. [implementation-plan.md](implementation-plan.md)：已核对的真实文件、模块接口、逐阶段施工与检查命令。
4. [baseline.json](baseline.json)：编制时版本、Git HEAD、关键文件哈希。仅作比对，不是恢复脚本。
5. [progress.json](progress.json)：本功能独立施工台账。不要修改其他资产任务已完成的 checkpoint。
6. [blender-assets-plan.md](blender-assets-plan.md)：官方skill分工、P0A的七类道具、S1执行、GLB接入与资源所有权。
7. [参考画廊](C:/3d/eys/reference_research/immersion_20260913/index.html) 与 [原始参考清单](C:/3d/eys/reference_research/immersion_20260913/references.json)：Luna 搜集、逐图核对的素材来源。

设计与计划有明确默认值，可直接实施。视觉调整限于文档规定的局部尺寸、镜头位置和时序；改变功能范围需留下偏差说明。验收图未拍、测试未跑，不能把阶段标为 passed。

## 本地启动与最终交接

施工前在项目根目录核对 `git status --short`、`git rev-parse HEAD`、`package.json`。已有 `node_modules` 和资产缓存可复用；缺依赖才 `npm ci`，缺资产才 `npm run fetch-assets`，不要删除缓存。

完成候选功能后：

```powershell
Set-Location 'C:\3d\eys\owd-eys'
npm run build
npm test
npm start
```

预览默认 [http://127.0.0.1:8870/](http://127.0.0.1:8870/)。不要接管不属于本任务的已有端口进程；遇占用则使用一个新端口并记录在 progress.json。完整检查命令与验收表以施工计划 P6 为准。

最终写 `docs/immersion/implementation-report.md`，记录预览地址、完成阶段、改动范围、检查结果、证据路径、未解决事项。产物截图和机器报告放 `reports/immersion/`，该目录不进入公开包。最终状态为 `ready_for_user_review`，不写成已发布。
