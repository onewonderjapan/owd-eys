# Grok 建议 · 2026-09-15 · 产品空窗卫生快照与知识轨合入后的写作边界

- 条目 ID：GK-20260915-01
- 仓：onewonderjapan/owd-eys
- 分支：grok/knowledge
- 模型：grok-4.6 / xhigh
- 专管 Bot：管鹅鸭仓的
- 类：知识 | 建议 | 风险提醒（周更卫生快照 / 写作边界）
- 机密分级：L1（公开站点可见事实：入口、版本、玩法边界、非官方声明）；L2（私有 GitHub 组织分支 tip、合入流程细节，勿写入公开页）
- 状态：待开发阅读

## 摘要

本仓是鹅教堂漫游实验/娱乐验证轨（公开入口仍为 https://eys.onewonder.co.jp/；README 声明非官方二创、技术验证、娱乐、非商用）。本周产品侧为空窗：**本周无新事故/无新发版**。空窗不算失败。

`package.json` version 仍为 `1.1.1`，`three` 仍为 `0.180.0`。自 2026-09-10「Fix cached-page map entry and pin release assets」（`87d47c1`）之后，`main` 无新的产品/玩法提交。GitHub Releases 列表为空。公开玩法边界未变：选角 → 小镇漫游俯视/第一人称；27 角色；单人；无联机/完整规则。

本周关键变化在知识轨，不在玩法：2026-09-13 机主下令内容审阅后，PR #2 已把既有 `grok/knowledge`（`grok-inbox/`，含 GK-20260911-01 cache-pin hygiene 与 CR 指针）合入 `main`；PR #3 已把既有 `grok/feedback` 合入 `main`。`main` 现含 `grok-inbox/` 与 `grok-feedback/` 目录。这是**既有 inbox/feedback 的一次性归档合入**，不等于以后建议可直接写 `main`。三轨（`claude/review` · `grok/knowledge` · `grok/feedback`）继续分写。`grok/knowledge` tip 摸仓时停在 `7de3087`（本条为此后新增 inbox，只写本轨）。

开发 agent 本周只需做低风险卫生：核对五条 tip、确认写作落点仍是 `grok/knowledge` 的 inbox（本条即示例）、把 GK-20260911-01 建议过但本次未在 `docs/` 文件名层看到的缓存钉扎回归清单标为待核、不要把空窗当成要补发版或要改玩法的信号。

## 依据（可核对引用；未核实须标明）

以下为 2026-09-15 只读摸仓、经 GitHub org 连接核实的事实。

### 分支 tip（已核实）

| 分支 | tip SHA |
| --- | --- |
| `main` | `4a9f23c90218df8b03f8fd838ada36af46484d0e` |
| `grok/knowledge` | `7de3087590e79d0f4dcd1059d4b4a81abba99677`（摸仓时；本条提交后会前进） |
| `grok/feedback` | `83405bbedf3dc972b09828bd7bcbf816dc1abf55` |
| `claude/review` | `aab3dab79b18fa221f4217d38c792455137745db` |
| `chore/bot-collab-track-20260911` | `898cdd1de032e09e71f8a615c8992120bc3e09bc` |

### 产品与公开入口（已核实）

- `package.json` version：`1.1.1`；依赖 `three`：`0.180.0`。
- 公开入口：https://eys.onewonder.co.jp/
- README 声明：非官方二创、技术验证、娱乐、非商用；选角 → 小镇漫游俯视/第一人称；27 角色；单人；无联机/完整规则。
- 自 2026-09-10「Fix cached-page map entry and pin release assets」（`87d47c1`）之后，`main` 无新的产品/玩法提交。
- GitHub Releases 列表为空（无新发版标签）。
- `docs/` 文件名仍为：`ACCESS_PROTECTION.md`、`DEPLOYMENT.md`、`IMPLEMENTATION.md`（无新增文档文件名）。
- **本周无新事故/无新发版。**

### 本周流程变化（已核实 · 2026-09-13 机主下令内容审阅后合入）

- PR #2 **merged**：integrate `grok/knowledge` → `main`（docs only：`grok-inbox/`，含 GK-20260911-01 cache-pin hygiene + CR pointer + README）。
- PR #3 **closed/merged**：integrate `grok/feedback` → `main`（dev-side review）。
- `main` 现含 `grok-inbox/` 与 `grok-feedback/` 目录。
- `grok/knowledge` tip 摸仓时仍停在 `7de3087`；本条 GK-20260915-01 只写入 `grok/knowledge` 的 `grok-inbox/`，不是对 `main` 的直接提交。
- PR #1 **仍 open**：`docs: 接入 Bot 协作轨`（`chore/bot-collab-track-20260911` → `main`），updated 2026-09-11。

### 既有 inbox（已核实 · `grok/knowledge`）

- GK-20260911-01：cache-pin hygiene（固化 1.1.1 缓存钉扎回归清单、卫生快照、体验验证表）。
- GK-20260911-02：pointer to accepted CR-EYS-20260911-01（CR 正文保留在 `claude/review`；三轨不合并政策仍适用）。
- 机主已把**当时** knowledge/feedback 内容合入 `main`。这只覆盖那一次审阅通过的存量，不改变之后新建议的落点。

### 未核实假设（本次只读未逐字核对，不得当已完成）

- **未核实假设**：GK-20260911-01 建议的「1.1.1 缓存钉扎回归清单 / 卫生快照 / 体验验证表」是否已写入 `docs/DEPLOYMENT.md` 正文。本次只确认 `DEPLOYMENT.md` **文件名未变**、`docs/` **无新增文件名**；未逐字 diff 正文。
- **未核实假设**：线上 https://eys.onewonder.co.jp/ 当前缓存头、地图入口、release asset pin 是否仍与 `87d47c1` 预期一致。本次未做体验点击、未抓响应头。
- **未核实假设**：PR #1 仍 open 的原因（冲突、等待机主、范围争议等）。本次只确认仍 open、updated 2026-09-11。
- **未核实假设**：`main` 上 `grok-inbox/` / `grok-feedback/` 与对应轨 tip 的文件是否逐字相同（合入后是否另有微调）。本次只确认目录已出现在 `main`、合入事件为 PR #2 / #3。

## 建议开发 agent 下一步

目标：低风险、可执行、一天内读完并留下可核对记录。不要借空窗扩玩法。本仓是实验/娱乐验证轨，勿与正式产品仓混写。

1. **先读边界，再动手。** 新建议、新周更、新 feedback 仍分别写在 `grok/knowledge`、`grok/feedback`；CR 仍写在 `claude/review`。机主把存量 inbox/feedback 合入 `main` 之后，**后续条目默认仍 push 到对应轨**，由机主审阅后再决定是否合入。本条 GK-20260915-01 的正确落点是 `grok/knowledge` 的 `grok-inbox/`，不是 `main`。
2. **做一张本周卫生对照表（只读，写进下一轮 inbox 或本地笔记即可，不要改产品代码）。** 核对上表五条 tip 是否仍为所列 SHA；核对 `package.json` 仍为 `1.1.1` / `three@0.180.0`；核对 Releases 仍为空；核对 `docs/` 仍仅三份文件名。若 SHA 或 version 已变，先停，标「与 GK-20260915-01 摸仓不一致」，不要自行追发版。
3. **补核 GK-20260911-01 的文档债（只读 diff，不擅自改 docs）。** 打开 `main` 与 `grok/knowledge` 上的 `docs/DEPLOYMENT.md`，确认正文是否已有 1.1.1 缓存钉扎回归清单、卫生快照、体验验证表。有则在回复里写「已在 DEPLOYMENT.md §x」；无则保持「未合入」，把补丁继续作为 knowledge 建议，等待机主下令，不要直接改 `main` 上的 docs 来「顺便完成」。
4. **空窗处理口径。** 对外/对机主复述时写明：**本周无新事故/无新发版**。不把空窗写成阻塞、失败或必须补 commit。产品玩法边界（27 角色、单人、无联机/完整规则、非商用二创）本周不变，不需要为了「看起来有进展」而改 README 或 bump version。
5. **PR #1 只登记、不擅自推进。** 记录「仍 open，updated 2026-09-11，源分支 `chore/bot-collab-track-20260911` @ `898cdd1`」。除非机主点名，不要 rebase、不要改标题范围、不要用本条周更去关或合这条 PR。
6. **阅读顺序（约一小时）。** README（定位）→ 本条 GK-20260915-01 → GK-20260911-01 / GK-20260911-02 → `docs/DEPLOYMENT.md` 是否含缓存钉扎清单（未核实则标未核）→ 确认三轨 tip 与 `main` 上已归档的 `grok-inbox/`、`grok-feedback/` 目录存在即可收工。

## 明确不要做什么

- 不要把本条或任何新建议 **push 到 `main`**。`main` 上已有的 `grok-inbox/`、`grok-feedback/` 是机主审阅后的存量归档，不是今后的写作入口。
- 不要因为知识轨已合入 `main`，就主张「三轨可以合并」或「以后 inbox 直接写 `main`」。三轨继续分写：`claude/review` · `grok/knowledge` · `grok/feedback`。CR-EYS-20260911-01 仍留在 `claude/review`。
- 不要把空窗当成要发版、要 bump `1.1.1`、要补 GitHub Release、要改玩法或要加联机/完整规则的理由。**本周无新事故/无新发版**，空窗不算失败。
- 不要删除历史 S3 对象。
- 不要把 GLB / 头像 / Blender 源文件建议进 Git。
- 不要建议用本条去关 PR #1，或把 `chore/bot-collab-track-20260911` 强行合进 `main`。
- 不要把本仓写成正式产品仓，或与其它正式产品仓的发版/事故流程混写。本仓定位仍是鹅教堂漫游：非官方二创、技术验证、娱乐、非商用。
- 不要在未逐字核对 `DEPLOYMENT.md` 正文的情况下，声称 GK-20260911-01 的回归清单「已经合入 docs」。文件名未变 ≠ 正文已改。
- 不要为了「卫生」而改缓存策略、unpin release assets、或重做 `87d47c1` 已钉扎的地图入口，除非机主另下产品令且有可核对 repro。
