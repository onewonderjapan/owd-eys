# 发布方式

与现有 pet.onewonder.co.jp 对照实测：AWS 账号 566601428909，东京私有 S3、CloudFront OAC 回源 `/out`、HTTPS、自定义域名、Route 53 Alias A。EYS 独立 bucket 与分发，不修改 pet 站点。

复用 pet 站点的已签发通配符证书、静态缓存策略及安全响应头策略。eys.onewonder.co.jp 只新建 A 记录；该名称在发布前查询为空，公网 NS 与 Hosted Zone Z049829035FWZ7KYTMXD4 一致。

1. `npm ci`；先由原始工作区整理资产，或上线后 `npm run fetch-assets` 恢复哈希锁定的资产。
2. 增加 `package.json` 版本后执行 `npm run build`、`npm test`，再运行 `scripts/smoke.mjs`、`scripts/smoke-first-person.mjs`、`scripts/smoke-entry-recovery.mjs`、`scripts/smoke-perf.mjs`（性能门：只看相对指标——漫游最差帧 ≤500ms、p95 ≤ 4×中位、water/fire 出局节拍最低 fps ≥ 漫游中位 fps 的 50%，写入 `reports/local/perf.json`）、`scripts/smoke-immersion.mjs`（桌面）、`MOBILE=1 node scripts/smoke-immersion.mjs http://127.0.0.1:8870/ immersion-mobile`、八个 `STYLE=<style>` 出局冒烟，然后 `scripts/smoke-visual.mjs`（画面健全门：对当次构建的关键帧做方差/色块/过曝/全黑相对检查，写入 `reports/local/visual.json`）与 `python -X utf8 scripts/contact-sheet.py`（拼出 `reports/local/contact-sheet.jpg`，发布前肉眼扫一遍）；`node scripts/check-undeclared.mjs` 静态检查未声明标识符（publish 门会直接运行它）。核对实际网页角色选择、进入地图与加载失败重试。
3. `aws cloudformation deploy --profile onewonder.root --region ap-northeast-1 --stack-name onewonder-eys --template-file infra/site.yaml --parameter-overrides PublishDns=false` 创建独立基础设施。
4. 按 `scripts/publish.py` 的清单上传 `dist/`，先内容哈希资产、后 HTML；不删除远端旧文件。
5. 核对 CloudFront 实际资源，再将 `PublishDns=true` 应用到同一 stack，创建 eys 的 Alias A。
6. 检查 HTTPS、真实角色加载与移动、原始 S3 匿名请求被拒绝，记录发布回执。

GitHub 源码仓库保持组织私有。Git 不保存 GLB、人物头像、Blender 原件、登录信息或生成目录。公开文件仅为运行网页、运行 GLB 和缩略图；非官方二创与非商用声明必须保留。公开内容范围已按用户要求核对。

## 首次上线验证（2026-09-10）

- 地址：<https://eys.onewonder.co.jp/>；CloudFormation `onewonder-eys` 状态 `UPDATE_COMPLETE`。
- S3：`onewonder-eys-566601428909/out/`；CloudFront：`E23UO5CSFQ0BWM`（`d3cngbirlx1hz5.cloudfront.net`）。
- Route 53 只创建 `eys.onewonder.co.jp` 的 Alias A，指向此 CloudFront 分发。
- 112 个运行文件共 136,646,626 bytes，上传后逐个验证大小与 SHA256 元数据；缓存失效已完成。
- HTTPS 首页、角色清单、地图清单与地图 GLB 的公网 SHA256 与构建结果一致；HTTP 自动转 HTTPS，S3 原始地址匿名访问返回 403。
- 浏览器确认 27 位角色可选、全部头像解码成功；本地实测 14／01／27 三套角色，公网实测 27 与手机 14 的装配、移动、返回换角。390px 页面与触屏方向键通过，运行错误列表为空。
- 本地回执位于忽略目录 `reports/`，包含构建清单、上传记录、公网校验及截图。后续发布先运行本地检查，再用 `node scripts/verify-remote.mjs` 与 `node scripts/smoke.mjs https://eys.onewonder.co.jp/ production` 验证真实域名。

回滚使用保留的 S3 对象版本或上一版本发布包；不删除本地或云端文件。CloudFormation 的 bucket 设置 Retain。当前项目无需 EC2、数据库或在线生成服务；每位访问者独立探索。

## 1.1.0 更新（2026-09-10）

粉花绿鹅的五瓣花环增加实体厚度、正反面弧度和圆润边缘，沿用原装备 ID、外轮廓与脸部开口。模型和角色缩略图来自衣橱 4.3.28，Blender 在 S1 生成并重载确认；原角色与贵族眼镜／褶领混搭已查看。

行走时用 V 或「视角」按钮切换俯视／第一人称。第一人称保持鹅的眼睛高度，鼠标拖动或点击锁定后环顾；手机可同时按方向键与拖动画面。Esc 先释放已锁定的鼠标。移动仍经过原有地图碰撞与房间判定。

本地选角／行走检查及公网第一人称检查通过，包含相对视线移动、桌面锁定和释放、390px 双指同时移动与转头、返回俯视及换角。`reports/production/first-person.json` 保存结果与所测构建哈希。公网花环 GLB、角色头像、视角代码及原地图的 SHA256 一致，运行错误列表为空。

此次构建 113 个文件，实际上传 8 个变化文件，105 个已按远端大小和 SHA256 元数据确认一致并复用；缓存失效完成。无 DNS／基础设施变更。旧文件保留。后续同步源资产可运行 `python -X utf8 scripts/sync-workspace-assets.py --source C:/3d/eys/web_wardrobe`；发布前运行 `node scripts/smoke-first-person.mjs`，上传脚本要求该结果与当前构建哈希一致。

## 1.1.1 进入地图修复（2026-09-10）

复现了旧版 HTML 缓存与新版脚本混用时，缺少新增视角按钮导致初始化失败的问题。该问题与用户报告的「选了角色，点击进入没反应」一致，但未能确认用户当时的浏览器是否正处于这一组合。调查时，全新浏览器的 27 位角色逐一进入通过。

视角组件现可兼容旧 HTML；新版页面把 JS、CSS、JSON 和 Three.js 依赖固定在 `releases/1.1.1/`。入口 HTML 与旧路径别名要求重新验证缓存，版本目录和哈希模型使用长期缓存。已发布的版本目录禁止覆盖不同内容。加载地图时显示下载进度，角色装配显示已完成数量；失败后显示提示并允许重试。

本地及公网均通过三项定向检查：旧 HTML 搭配兼容脚本、地图下载一次 503 后重试、角色模型下载一次 503 后重试。公网桌面与手机第一人称检查通过，HTTP 缓存头、版本路径及 9 项文件 SHA256 校验通过。发布 131 个文件，37 个上传、94 个复用，缓存失效完成。角色模型维持 4.3.28，访问控制及 DNS 未变动。

现有防护与低成本选项见 [ACCESS_PROTECTION.md](ACCESS_PROTECTION.md)。详细检查结果保存在忽略目录 `reports/incident/` 和 `reports/production/`。
