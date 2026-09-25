# 鹅教堂漫游 · Goose Chapel Walk

《鹅鸭杀》（Goose Goose Duck）非官方二次创作，仅用于技术验证与娱乐，不用于商业用途；与原作官方无关联，原作相关权利归其权利人所有。

在线体验：https://eys.onewonder.co.jp/

## 玩什么

先从 27 位角色中选择同行者，再走进鹅教堂小镇：

- **漫游**：WASD／方向键移动，E 查看位置，V 或「视角」切换俯视／第一人称。第一人称按住画面拖动环顾，电脑可点击画面锁定鼠标、Esc 释放；手机用方向键移动＋拖动转头。
- **环境音与脚步**（2026-09-16）：纯 Web Audio 合成的风声水声底噪，脚步随真实移动节奏响起；HUD「声音」开关记住偏好。
- **拍照模式**：P 键或「拍照」按钮进入，隐藏全部界面只留取景框，拖动构图，Enter 导出当前画面 PNG。
- **黄昏光照**：F 键或「黄昏」按钮切换暖色暮光，只改灯光与背景、随时可逆。
- **应急桌灯光闪烁**（2026-09-19）：走近广场应急按钮桌时，小镇灯光缓慢明暗两拍后完整还原（reduced-motion 为单次平缓压暗）；会议演出期间绝不触发。
- **镇民闲逛**（2026-09-20）：漫游中 3~5 位镇民沿寻路闲逛、头顶偶尔冒出本地闲聊气泡；开会演出期间整体回避，拍照模式保留画面但不冒泡，手机端减为 3 位。
- **镇民刀人 · 腿 · 拉腿开会**（1.7.0）：镇民中暗藏一位鸭子（UI 绝不揭示，同一颗种子可复现）。鸭子趁无人目击时把镇民刀倒——受害者原地变成两条朝天鹅腿＋同色身体圆片；走近腿按 E 或 R（手机点「报警」）触发发现演出并直接进会议，死者椅子空置且票卡红叉不可选。投出普通镇民则本轮继续，投出鸭子则小镇安全并开新一轮；镇民只剩一位且无腿时小镇陷入寂静。非血腥：无血迹、无尖叫、无震屏。
- **POV 沉浸演出**(2026-09-15 首发,2026-09-17 扩充):走到法院金铃或广场中央的红色应急按钮桌,与 7 位 NPC 围桌开会——三段发言、投票示意、结果揭晓;被投出(或自演示)时以第一人称体验 **8 种出局演出**:沉水(链石下坠)、火堆(抬入火中)、星空弹射(飘向星空俯瞰小镇)、流沙吞没、吊灯砸落、巨石滚落(压成纸片鹅)、断桥坠落、冲水飞湖。8 种演出在会议界面右上切换;可跳过、重播、静音,失焦自动暂停。全部为本地单人 NPC 演出,不含联机、语音或完整胜负规则。

## 本地开发

```sh
npm ci
npm run fetch-assets
npm run build
npm test
npm start
```

预览地址：http://127.0.0.1:8870/ 。首次上线前由原始工作区填充 `.cache/assets/`；正式上线后 fetch-assets 从已发布站点下载并核对 SHA256。GLB 和头像存放在 S3，不进入 Git；每个运行资产的哈希与大小见 `assets-manifest.json`，原始 Blender 与制作档案不在公开包内。

## 工程结构

| 位置 | 职责 |
|---|---|
| `src/main.js` | 角色选择页与整体装配 |
| `src/map-walk.js` + `map-walk-{simulation,view,avatar}.js` | 小镇行走、碰撞导航、双视角 |
| `src/walk-npcs.js` | 漫游镇民闲逛、对话气泡与鸭子刀人/腿造型（种子确定性，独立加载/释放） |
| `src/walk-round.js` | 1.7.0 镇民轮纯逻辑：鸭子选取、刀人资格、腿/缺席账本、会议结算（零 Three/DOM） |
| `scripts/dev/` | 一次性开发辅助脚本留档（不参与构建） |
| `src/walk-audio.js` | 环境音与脚步（Web Audio 合成，无音频资产） |
| `src/immersion-state.js` | 会议/出局纯状态机（零 DOM/渲染依赖，全量单测） |
| `src/immersion-director.js` | 状态机与舞台/音频/UI 的编排，世代令牌防竞态 |
| `src/immersion-{meeting,ejection}.js` | 圆桌会议舞台、沉水/火堆出局演出 |
| `src/immersion-props.js` | 道具库（GLB sha256/bytes 运行时校验） |
| `scripts/build.mjs` | 版本化构建（内容寻址 release 目录 + 哈希清单） |
| `scripts/smoke-immersion.mjs` 等 | 端到端冒烟（桌面 + 手机断言） |
| `scripts/publish.py` | 发布门 + S3/CloudFront 上传（哈希复核、HTML 最后传） |

发布与部署细节见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)；沉浸演出的设计与实施记录见 [docs/immersion/design.md](docs/immersion/design.md)。

## 测试

```sh
npm test                         # 纯逻辑（状态机 + 寻路共 38 项）+ 产物检查
node scripts/smoke-immersion.mjs # 端到端桌面冒烟（进入→行走→按铃→会议→出局→镇民）
MOBILE=1 node scripts/smoke-immersion.mjs http://127.0.0.1:8870/ immersion-mobile  # 手机断言
STYLE=<water|fire|bridge|flush|quicksand|space|chandelier|boulder> \
  node scripts/smoke-immersion.mjs http://127.0.0.1:8870/ style-<style>            # 单风格出局全程（含画面门）
node scripts/smoke-perf.mjs      # 性能门（相对指标、无灾难性卡顿；reports/local/perf.json，发布门之一）
node scripts/smoke-visual.mjs    # 画面健全门（关键帧方差/色块/过曝/全黑；reports/local/visual.json，发布门之一）
python -X utf8 scripts/contact-sheet.py  # 把关键帧拼成 reports/local/contact-sheet.jpg，发布前肉眼扫一遍
node scripts/check-undeclared.mjs # 静态检查：未声明标识符（1.4.0 splash 冻结 bug 的类别），发布门之一
node scripts/smoke-first-person.mjs # 第一人称门（机位挂头部、身体可见；reports/local）
node scripts/smoke-entry-recovery.mjs # 演员加载失败→error→重试的恢复门
```

## 许可与边界

- **代码**：以 [MIT License](LICENSE) 开源——本仓库中的 JavaScript/CSS/HTML 与构建发布脚本。
- **模型与美术资产**（GLB、贴图、缩略图及 Blender 源的派生物）：为基于《鹅鸭杀》官方视觉的非商用二创，**不随代码以 MIT 提供**，仅限非商业的技术验证与娱乐用途；原作相关权利归其权利人所有。见 [NOTICE.md](NOTICE.md)。
- 本项目不提供联机、语音、账户或任何后端服务。

## Bot 协作轨（2026-09-11 起）

本仓有三条协作分支。它们都**不是仓库正本**，默认不合并进 `main`；经机主内容 review 后可例外合入，只作为建议与反馈的输送通道：

| 分支 | 目录 | 写入方 | 读取方 | 用途 |
|---|---|---|---|---|
| `grok/knowledge` | `grok-inbox/` | 专管 Grok Bot | 开发 agent | Bot 定期推送的知识 / 建议 / 风险提醒（条目 `GK-<仓>-YYYYMMDD-NN`） |
| `grok/feedback` | `grok-feedback/` | 开发 agent / 机主 | 专管 Grok Bot | 对 GK 条目的采纳 / 拒绝 / 修正要求（条目 `GF-<仓>-YYYYMMDD-NN`） |
| `claude/review` | `claude-review/` | Claude（开发侧 review） | 开发 agent / 机主 | 对仓内容本身的 review 建议（条目 `CR-<仓>-YYYYMMDD-NN`） |

开发 agent 每次会话开始：

```bash
git fetch origin grok/knowledge grok/feedback claude/review
git show origin/grok/knowledge --stat --oneline   # 看最新 GK 条目
```

- 读 `grok-inbox/` 最新条目当**建议输入**，不当已生效规则。
- 对 GK 的裁定写进 `grok/feedback`，**不直接写 `grok/knowledge`**（那是 Bot 专属写入分支）。
- 要落地的改动走正常 PR → `main`，PR 描述引用对应 GK / CR 条目 ID。
- 专管 Bot 只写 `grok/knowledge`，运行前读 `grok/feedback`；禁止 push `main`。
