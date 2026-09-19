# 更新记录 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号见 `package.json`。

1.2.0 之前的发布记录写在 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)（含首次上线与 1.1.x 的实测回执）。
本文件补齐 1.2.0 起的版本；条目由仓库内的设计/实施记录整理，**不含**未在仓库中留下证据的细节。

## [Unreleased]

### 安全 / Security

- 账号级标识（AWS 账号 ID、bucket 名、CloudFront 分发 ID、Hosted Zone ID、证书 ARN）
  全部移出仓库：新增参数化模板 `infra/site.example.yaml` 与 `.env.example`；
  `scripts/publish.py`、`scripts/verify-remote.mjs` 改从环境变量读取，缺失即报错退出。
- `scripts/publish.py` 取消默认 AWS profile，必须显式指定；
  `docs/DEPLOYMENT.md` 增加「建议：最小权限 IAM」一节。
- 资产流水线不再写死构建主机地址与远端账号，改由 `EYS_S1_HOST` / `EYS_S1_USER` 提供。
- 文档与设计记录中的本机绝对路径、个人用户目录、主机名一律改为仓库相对路径或占位符。
- `scripts/check-build.mjs`、`scripts/immersion/check_props.mjs` 的私有路径检查改为通用
  模式（覆盖 `C:/` 正斜杠写法与任意 IPv4 字面量），修复此前只匹配双反斜杠写法的盲区。

### 依赖 / Dependencies

- `playwright` 升至 ^1.55.1（修复 GHSA-7mvr-c777-76hp）。
- `package-lock.json` 重新生成，版本号与 `package.json` 对齐（此前滞留在 1.2.0）。

### 工程 / Tooling

- 新增 GitHub Actions CI（`npm ci` → 构建 → `npm test` → 沉浸逻辑测试 → `npm audit`）。
- 新增 Dependabot（npm + github-actions）。
- 新增本文件；`npm test:immersion` 脚本化 `scripts/test-immersion.mjs`。
- `scripts/smoke-entry-recovery.mjs` 的浏览器路径改为 `CHROME_PATH` 可覆盖。

### 移除 / Removed

- 根目录 `_stages_snippet.js`（`src/immersion-ejection.js` 的过期副本）与
  `_polish_stages.py`（一次性补丁脚本，结果已在源码中）。

## [1.4.2] - 2026-09-17

- 吊灯与流沙两段出局演出改为真正的第一人称调度（提交 “Chandelier + quicksand:
  true first-person staging”）。

## [1.4.1] - 2026-09-17

- 未核实：仓库内没有留下该版本的独立记录（浅克隆亦无历史提交可查）。

## [1.4.0] - 2026-09-17

- 出局 POV 镜头池扩充至 8 种：在沉水、火堆之外新增 E1 星空弹射、E2 流沙吞没、
  E3 吊灯砸落、E4 巨石滚落、E5 断桥坠落、E6 冲水飞湖；`STYLE` 环境变量可逐样式
  端到端验证。同时上线 E8 名册倒下 CSS 动画。详见
  [docs/immersion/ejection-shotlist.md](docs/immersion/ejection-shotlist.md)。

## [1.3.x] - 2026-09-16

- 1.3.3：沉水演出加深（链石下坠与入水后回望的构图调整）。
- 1.3.2：火堆演出相机轨道重调。
- 环境音与脚步：纯 Web Audio 合成的风声水声底噪与脚步，HUD「声音」开关记住偏好。
- 1.3.0 为当时的线上版本（`releases/1.3.0`，公网校验 PASS）；仓库同期转为开源
  （代码 MIT + 二创资产 NOTICE）。

## [1.2.0] - 2026-09-15

- POV 沉浸演出首发：走到法院金铃或广场应急按钮桌，与 7 位 NPC 围桌开会
  （三段发言、投票示意、结果揭晓），被投出或自演示时以第一人称体验沉水与火堆两种
  出局演出；可跳过、重播、静音，失焦自动暂停。
- 随后的「自身出局 POV 精修」三段会话按用户脚本重排时间线（水 9.5s 六拍、
  火 6.3s 五拍），时长参数集中到 `src/immersion-config.js`。
  详见 [docs/immersion/self-pov-refinement-report.md](docs/immersion/self-pov-refinement-report.md)。
