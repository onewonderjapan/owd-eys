# Claude 内容 review · 2026-09-11 · owd-eys

- 条目 ID：CR-EYS-20260911-01
- 仓：onewonderjapan/owd-eys
- 分支：claude/review
- 写入方：Claude（开发侧 review）
- 机密分级：L2（社内）
- 状态：待机主阅读

## 仓定位

《鹅鸭杀》非官方二创「鹅教堂漫游」静态站源码（eys.onewonder.co.jp），Three.js 0.180.0 单页，无后端。历史仅 3 个 commit（2026-09-10），35 个跟踪文件，最大 blob 95 KB（src/map-walk-props.json），GLB/PNG 全在 S3 不入库。全仓无 BOM、无 CRLF、无 AK/Token 命中。版本 1.1.1 = package.json:3 = package-lock.json:3；依赖 three 0.180.0 / playwright 1.55.0 与锁文件一致（package-lock.json:64-67,32-35）。README 未声明 Three.js 版本，不冲突。声明位置：README.md:3、src/index.html:2（meta）/:5/:15、src/hud-fragment.html:8/:10；scripts/check-build.mjs:11 与 scripts/verify-remote.mjs:25-26 均断言其存在；infra/site.yaml:2,30,45 以 Description/Tag/Comment 标注 noncommercial。

## 发现

1. **CloudFront 缓存策略真值不在仓内** — infra/site.yaml:62-63 — DefaultCacheBehavior 只引用外部 CachePolicyId / ResponseHeadersPolicyId，模板不定义 TTL；docs/ACCESS_PROTECTION.md:24 称该自定义策略 MinTTL 0 — 边缘是否尊重源站 `no-cache` 完全取决于这条仓外配置，控制台一改即可复发「旧 HTML + 新脚本」事故，且 Git 无法审计。
2. **发布链路绑定单台 Windows 机** — scripts/smoke-entry-recovery.mjs:11 硬编码 Edge 可执行路径且无环境变量覆盖；scripts/publish.py:19-20 强制要求其产出报告与当前构建哈希一致 — 换机/CI 无法发布；smoke.mjs:6、smoke-first-person.mjs:7 虽有 CHROME_PATH 覆盖，默认值同为本机路径。
3. **基础设施标识符四处明文重复** — scripts/publish.py:7、scripts/verify-remote.mjs:31、infra/site.yaml:16/65/89、docs/DEPLOYMENT.md:3/19 — 桶名、账号 ID、分发 ID、Hosted Zone ID 各写一份（非密钥，私有仓可接受）— 多处易漂移；若仓库转公开或 fork 需先清理。
4. **部署使用名为 `<privileged-profile>` 的 AWS profile** — scripts/publish.py:5、docs/DEPLOYMENT.md:9 — 若该 profile 对应 root 凭证，与最小权限原则冲突，也无法按项目审计【是否 root 凭证未核实】。
5. **旧 HTML 兼容只有 1.0.0 一份样本** — scripts/fixtures/index-1.0.0.html、scripts/smoke-entry-recovery.mjs:8,17 — 回归只覆盖 1.0.0 HTML；1.1.0 HTML 无样本。src/map-walk-view.js:6-8,15-18,68 对 `#walk-view-toggle`/`#walk-reticle` 做了空值保护，但 `.walk-key-hint`（:7,:17）未保护 — 现有两版 HTML 都含该元素，风险低但缺防线。
6. **私有路径检查有盲区** — scripts/check-build.mjs:9 — 正则只匹配 `X:\`（双反斜杠）、`/home/`、单一写死的内网 IP、`.codex/`，不匹配 `C:/` 正斜杠形式（docs/DEPLOYMENT.md:36 正是这种写法）— 源工作区路径若以正斜杠泄入 dist 不会被拦。
7. **文档衣橱版本不一致** — docs/IMPLEMENTATION.md:5 写 4.3.27；src/assets/manifest.json 实际 version 4.3.28，README.md:23、docs/DEPLOYMENT.md:30 亦为 4.3.28 — 读者按 IMPLEMENTATION 校验会误判。
8. **每次发布全量失效 `/*`** — scripts/publish.py:49 — HTML 与根别名已 no-cache、releases/ 与哈希资产不可变，全量失效属冗余；每月超免费路径数后计费【费用口径未核实】。
9. **缓存判定表达式 `or`/`and` 混排无括号** — scripts/publish.py:27 — 按 Python 优先级恰好得到预期语义（releases/** 或 assets/*.glb|png → immutable，其余 → no-cache），但可读性差、易被误改。
10. **.gitattributes 对从不入库的类型设规则** — .gitattributes:2-3 `*.glb -text`/`*.png -text`，而 .gitignore 与 README.md:21 均声明这些文件不进 Git — 无害冗余。

## 缓存策略核实结论

- HTML TTL：源站侧 `no-cache,max-age=0,must-revalidate`（scripts/publish.py:27，index.html 与所有根路径别名；verify-remote.mjs:20 校验公网响应含 no-cache）「已核实」；CloudFront 边缘是否尊重取决于仓外策略 MinTTL（ACCESS_PROTECTION.md:24 称 0）「未核实」。
- releases/ 资源 TTL：`public,max-age=31536000,immutable`（publish.py:27），已发布版本目录内容不同即拒绝覆盖（publish.py:33-34），verify-remote.mjs:19 校验 immutable「已核实」；`assets/<sha256>.glb|png` 同为 immutable，assets-manifest.json 94 项全部 `assets/` 前缀、与 src/assets/manifest.json + src/map-scene.json 引用集合完全一致（无缺失、无多余），不放在 releases/ 下属内容哈希设计「已核实」。
- 兼容层覆盖范围：scripts/build.mjs:8-9 把全部非 HTML src 文件同时输出到根路径与 releases/1.1.1/，build.mjs:20-21 对 vendor/three 同样双写；根别名走 no-cache；src/main.js:15,41 与 map-walk-avatar.js:6 用 `import.meta.url` 解析清单，旧 HTML 自然落到根路径；map-walk-view.js 空值保护覆盖 1.0.0 HTML 缺少的两个元素「已核实」；对 1.1.0 HTML 的兼容「未核实」。

## 建议

### P0（本周）
- 把 CloudFront 缓存策略与安全头策略的完整定义（MinTTL/DefaultTTL/MaxTTL、CSP 文本）以 `AWS::CloudFront::CachePolicy` / `ResponseHeadersPolicy` 资源写入 infra/site.yaml，或至少将当前线上策略 JSON 导出入 infra/ 供审计（对应发现 1）。
- 给 scripts/smoke-entry-recovery.mjs:11 增加 `CHROME_PATH`/`EDGE_PATH` 环境变量覆盖，与 smoke.mjs 一致（对应发现 2）。

### P1（本月）
- 将桶名/分发 ID/账号 ID 收敛到单一来源（如 infra/ 输出或 `.env.example` + 读取环境变量），publish.py / verify-remote.mjs / docs 引用它（对应发现 3）。
- 为发布新建最小权限 IAM 身份（S3 PutObject/HeadObject 限 `out/*` + cloudfront:CreateInvalidation 限该分发），替换 `<privileged-profile>` profile（对应发现 4）。
- 在 scripts/fixtures/ 增加 index-1.1.0.html 样本并纳入 smoke-entry-recovery 循环；`.walk-key-hint` 加空值保护（对应发现 5）。
- 修正 docs/IMPLEMENTATION.md:5 的 4.3.27 → 4.3.28（对应发现 7）。

### P2（有空再说）
- scripts/check-build.mjs:9 正则补 `[A-Za-z]:/` 正斜杠盘符形式与 `C:\`（单反斜杠）（对应发现 6）。
- publish.py:49 改为只失效 `/index.html` 与根别名列表，或加 `--full-invalidation` 开关（对应发现 8）。
- publish.py:27 加括号并拆成具名变量（对应发现 9）；删除 .gitattributes:2-3 冗余规则（对应发现 10）。

## 不建议做
- 不建议把 GLB/PNG 或 Blender 源引入 Git 或 Git LFS：现有「S3 内容哈希 + assets-manifest.json 校验 + fetch-assets 恢复」链路已闭环（scripts/fetch-assets.mjs:5、build.mjs:15）。
- 不建议把 `assets/<sha>` 也搬进 releases/ 目录：内容哈希已保证不可变，搬运只会让 94 个大文件每版重复上传。
- 不建议为解决缓存事故改用短 max-age 替代 no-cache：当前「HTML no-cache + 版本目录 immutable」是正确模型，问题只在边缘策略不可审计。
- 不建议现在切换 CloudFront Free 套餐：ACCESS_PROTECTION.md:24 已指出自定义策略不兼容，需先完成 P0 第一条。

## 未核实
- 线上 CloudFront 缓存策略实际 MinTTL/DefaultTTL/MaxTTL 与响应头策略内容（仓内只有 ID，见 infra/site.yaml:62-63）。
- `<privileged-profile>` profile 是否为 AWS root 凭证。
- 1.1.0 版 HTML 与 1.1.1 脚本的组合是否可进入地图（无 fixture）。
- 每次 `/*` 失效的实际月度费用。
- docs/DEPLOYMENT.md:21,36,44 所述上传数量、公网 SHA256 校验结果（依赖忽略目录 reports/，仓内无回执）。
- 该私有仓未启用分支保护/CODEOWNERS 的情况（仅一个 main 分支，本次未查 GitHub 设置）。
