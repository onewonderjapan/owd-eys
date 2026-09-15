# 自身出局 POV 精修报告（self-pov-refinement）

- 回应：`.design/self-ejection-pov/DESIGN_REVIEW.md`（R1–R5）+ 用户实测反馈（2026-09-15：演出过程感不足，要求按「走来→举起→走一段→岸边停顿→扔下→看着岸上的鹅下沉」重排）
- 执行：ZCode（GLM-Flash），分支 `feature/pov-immersion`（HEAD 基线 87d47c1，1.2.0，未提交修改之上继续；单代理，未派 reviewer）
- 台账：[self-pov-refinement-progress.json](self-pov-refinement-progress.json)（S1/S2/S3 三段会话记录）
- 证据目录：`reports/immersion-self-pov-refinement/`（修改前证据保留于 `.design/self-ejection-pov/screenshots/`）

## 演出时间线（S3 按用户脚本重排，时长集中在 immersion-config.js）

**沉水（水 9.5s，六拍）**：

| 拍 | 时间 | 画面（自己 POV 默认视线） |
| --- | --- | --- |
| 走来 | 0–1.7s | 全部 7 只鹅从码头后方走向我，视线迎着队伍（`water-walk.png`） |
| 举起 | 1.7–2.9s | 护送鹅到位握持并将我举起，转身低头看到握持（`water-lift.png`） |
| 携行 | 2.9–4.5s | 被抬着走一段，视线摇摆扫过两侧护送鹅与身后码头（`water-carried.png`） |
| 停顿 | 4.5–5.1s | 岸边停一下，低头看水：护送鹅探身、翅尖与码头板条入画（`water-edge.png`） |
| 扔下 | 5.1–5.9s | 松手抛出，下坠中回头——正对码头边目送的鹅群（`water-thrown.png`） |
| 下沉 | 5.9–9.5s | 缓慢下沉，默认视线锁定岸上的鹅（`water-underwater.png`）；身体 ~5.5s / 眼位 ~5.9s 过水面，水下可观察 6.0–9.1s（≥3s） |

**火堆（7.5s，五拍）**：走来(0–1.7) → 举起(1.7–2.9) → 携行(2.9–4.3) → 坑沿松手抛入(4.3–5.3) → 落定(5.3+)。护送鹅贴身握持并一路抬到坑沿石圈处才松手，身体划弧落入坑心；镜头沿身体路径推进到坑沿（`fire-rim.png` 坑沿双鹅持握、`fire-drop.png` 抛入、`fire-inpit.png` 坑内火光）。落定后翅膀外张不挡火芯。

实现要点：全员行进列（escorts + 5 名围观鹅全部进入演出场景）；扔下/下沉的默认视线由 `shoreGaze` 逐帧求解（随下沉自然抬角），用户拖动随时可离开（观察增量保留）；六拍视线均为导演编排的 base，用户增量叠加其上。

## 运行与验证（最终源码态）

- `npm run build`（156 files）+ `npm test`（EYS_PACKAGE_PASS）；`test-immersion.mjs` 28/28；`check_props.mjs` 7/7。
- 基准：`scripts/immersion/self_pov_refinement.mjs`（真实入口→键盘走到铃→自身演出，Playwright 录屏）
  - cast.14 water+fire：**PASS 0 失败、0 pageerror**；轨迹边界采样 max=2.33/s（水）/1.82/s（火）（≤3.5，无跳变）；低头 pitch=-1.413；重播复位水×8 火×6 全过；取消位置恢复误差 0。
  - 链端独立测量（抬 2.41s / 岸边 4.82s / 水下 7.21s）：errTop=errBottom ≤0.005（容差 0.03；端点=首末链节中心沿链轴 ±0.57×节长系帽端，对称系统偏差 0.0025×链长）。
  - REDUCE_MOTION=1 水：PASS（`reduce-motion/`）；ACTOR=cast.02 水：PASS（`cast02/`，身份/配色随角色）。
- 回归：`smoke-immersion.mjs`（NPC 水/火、5 轮 ring/cancel 泄漏、静音）**32/32 PASS**（NPC 链端检查已改为独立端点比较）。
- 编码：改动文件 UTF-8 无 BOM、LF。

## 逐项回应（截图均经逐张人工检查）

| 项 | 内容 | 证据 |
| --- | --- | --- |
| R1 翅膀悬浮 | 翼代理逐帧从源网格矩阵重derive=真实肩点绑定；双面+风格自发光克隆材质；窄屏按 aspect 内收；修复 director 缺失的 lerp | 前 `.design/.../desktop-water-down-3_8.png` → 后 `water-lift.png`、`water-down-desktop.png` |
| R2 链石不可读 | 石块 ~0.31m 深灰；锚点=身体绑点/GLB chain_anchor；独立端点测量三时刻 ≤0.005；smoke 同步改独立比较 | `water-down-desktop/tablet/phone.png`、`water-link-integrity-water.json` |
| R3 火堆跳变/无接触 | 水/火统一身体轨迹+行进列；岸边停顿拍；落坑翅膀外张，火芯/木柴/坑沿可见 | `fire-walk/lift/carried/drop/inpit.png` |
| R4 入水时机/氛围 | 抛弧加深使眼位 ~5.9s 真正过水；单次水花（身体破水驱动）；环境/音频/俯仰全部由实时轨迹高度驱动；水下 ≥3s | `water-thrown.png`（下坠回头）、`water-underwater.png`（无硬横线） |
| R5 鱼/气泡/火焰占位感 | 鱼椭球身+竖尾鳍+离眼 ≥0.85；气泡柔边精灵；火焰渐变轮廓连木柴 | `videos/frames/water-underwater-video.png`、`fire-inpit.png` |
| 用户脚本（S3） | 六拍/五拍时间线 + 全员行进列 + 下坠/下沉默认视岸 | 六拍连帧 `water-*.png`、`videos/frames/water-*-video.png`、录屏 `videos/self-water.webm` / `self-fire.webm` |

## 剩余项（如实陈述）

- 低头时双翼为紫色椭圆豆状：绑定/外展正确，圆润翼几何俯视下缺翼尖细节（需改几何）。
- 携行段护送鹅头部在画面下方占比较大（近距离被举着的物理结果，读感为「从它们头顶看出去」）。
- 手机/平板为桌面模拟触控（无真机）；声音仅代码级验证；偶有鱼游过石块附近（动态重叠）。

## S3 补充：演出行走卡顿修复（2026-09-15 用户反馈「走路很卡」）

新增探针 `scripts/immersion/perf_probe.mjs`（真实入口+逐节拍 RAF 采样，含 135% 显示缩放模拟）实测：行进拍 ~40fps，明显低于后续节拍 60–80fps——行进时 7 只鹅全部入画。两项修复：

1. **演出期间渲染比例降为 1×**（`map-walk.js` frameLoop：busy 时 `setPixelRatio(1)`，回漫游恢复 `min(devicePixelRatio,1.35)`）——高分/缩放显示的填充率直接减半。
2. **围观鹅与护送鹅隐藏远景不可读的亚厘米网格**（趾缝/鼻孔/眼内高光/喙缝；护送鹅保留头冠，帽子/服装等身份件全部保留）。

修复后（软渲染 + DSF 1.35 实测）：火 walk 39.5→**61.9fps**，lift 76.4 / carry 75.1 / toss 83.7 / settle 83.5；水 walk 54.0、carry 89.7、sink 76.6–82.1。`test-immersion.mjs` 时长断言同步改为按 config 驱动（28/28）。走位寻路逻辑抽取为共享模块 `scripts/immersion/walk_harness.mjs`（验证脚本与探针共用）。

## S3b 补充：火演出位置修正（2026-09-15 用户反馈）

用户指出火演出「不行」且「被扔进火堆时位置不对」。根因：火分支护送鹅握持点在 (1.15, ±0.85)，而身体被举在 x=0——举起/携行全程握持悬空，抛掷是从 1 米外隔空抛入；镜头轨在投掷段横穿身体路径。修复：

- 握点改为贴身 (0.3, ±0.55)；举起后护送鹅**一路抬着身体走到坑沿**（石圈外侧 x≈1.32 处停住），从坑沿松手，身体划弧落入坑心 (2.3, 0.16)。
- 松手时机改为抛掷开始（4.3s），松手后退到 backSpots；镜头轨沿身体路径推进到坑沿近观（落定帧 (1.85, 0.82, 0.68)），不再横穿轨迹。
- 时长对齐水的节奏：fire 6.3→**7.5s**（走来 1.7 + 举起 1.2 + 携行 1.4 + 抛入 1.0 + 落定），`fireWindow [4.5, 7.3]`；音频 whoosh/fire 节拍随 beats 自动对齐。

验证：fire 基准 PASS 0 失败、0 pageerror；关键帧 `fire-rim.png`（坑沿双鹅持握）、`fire-drop.png`（抛入）、`fire-inpit.png`（坑内火光围住身体）；回归水基准 PASS、NPC 32/32、28/28、EYS_PACKAGE_PASS。

用户复检反馈「火堆还是歪的」：根因是坑沿/落定镜头停在轴线侧面（z=+0.55），构图整体倾斜——坑被推到画面左侧、地面斜线、护送鹅头部歪出画。修复：抛入与落定镜头拉回行进轴线（z=0，落定帧 (0.72, 0.82, 0) 正对坑心 1.58m），携行镜头 z 也归零。修复后 `fire-rim/drop/inpit.png` 全部为对称端正构图：火坑居中、木柴放射对称、石圈左右均衡、双鹅在左右下角对称持握。回归水/火基准 PASS、NPC 32/32、EYS_PACKAGE_PASS。

## S3c 补充：卡顿根因确认为 MSAA（2026-09-15 用户反馈「卡顿没解决」）

首两项优化后用户仍报卡顿。扩展探针抓取 GPU 字符串、逐节拍绘制调用数与帧时间百分位后确认：本机浏览器走 **Intel UHD 核显（ANGLE D3D11，非软件渲染）**，DPR 1.35；行进拍绘制调用仅 86–96、帧时间中位 18ms 且无 GC 尖峰——瓶颈是 **WebGLRenderer 的 MSAA 4× 抗锯齿填充开销**（每像素 4 倍着色 + resolve），在核显上吃掉约 40% 帧预算。

修复：`main.js` 渲染器 `antialias: false`（全局一次性生效，含漫游视图）。实测（Intel UHD + DSF 1.35）：火 walk 55.4→**88.4fps**，lift 105.1 / carry 99.2 / toss 91.8 / settle 104.2，帧时间中位 11.3ms、p95 12.8ms、无尖峰；1.35× 分辨率下低多边形画面锯齿轻微。诊断接口 `window.eys.rendererInfo()`（只读统计）保留供后续排查。回归：水/火基准 PASS、NPC 32/32、28/28、EYS_PACKAGE_PASS、第一人称漫游 PASS。

## S3d 补充：入场漫游卡顿定位与缓解（2026-09-15 用户澄清「卡的是进游戏后，不是演出」）

用户澄清卡顿发生在**进入游戏的漫游行走**，而非演出。实测：漫游仅 **11–20fps**（95 绘制调用、帧时间 48–96ms、232k 可见三角形、DPR 1.35），而演出场景同机可达 88–105fps。根因：地图 GLB 将整个城镇合在 **17 个大网格/205k 三角形**里，无分块、无 LOD——无论走到哪都是全量渲染，Intel UHD 核显上即触顶；另有一定测量噪声来自用户同时打开的页签争用 GPU。

本轮缓解（`map-walk.js`）：漫游渲染像素比 1.35→**1.0**（配合已关闭的 MSAA），实测漫游 **11–20fps → 31.3fps**（竞争负载下测量，独占时更高）；俯视卡通地图在 1× 下视觉可接受。结构性根治（把地图按房间切块重导出以启用视锥剔除）涉及地图资产重做，超出本轮范围，记录为后续项。回归：水/火基准 PASS、NPC 32/32、28/28、EYS_PACKAGE_PASS、基础漫游 PASS。

## 断点续接

读台账与 `refinement-run.json`（顶层=cast.14 水/火基准 PASS），再查 `git diff`。专项归档 `reduce-motion/`、`cast02/`；修改前基线证据在 `.design/self-ejection-pov/`。注意：`重播` 按钮只存在于 finished 阶段，演出中点击无效（S3 已按「每拍等 finished 再重播」取帧）。
