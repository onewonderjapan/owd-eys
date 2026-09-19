# 发布方式

结构：东京私有 S3、CloudFront OAC 回源 `/out`、HTTPS、自定义域名、Route 53 Alias A。本站使用独立 bucket 与分发，与同账号其他站点互不影响。

证书、缓存策略与安全响应头策略复用同账号已签发的通配符证书及既有策略；站点主机名只新建 A 记录，发布前确认该名称为空且公网 NS 与目标 Hosted Zone 一致。

## 账号标识与环境变量

仓库内**不保存**任何账号级标识（账号 ID、bucket 名、CloudFront 分发 ID、Hosted Zone ID、证书 ARN、AWS profile 名）。
全部改由环境变量提供：复制 [`.env.example`](../.env.example) 为 `.env`（已 gitignore）填入实际值，执行发布相关命令前加载。

| 变量 | 用途 |
|---|---|
| `EYS_AWS_PROFILE` | AWS CLI profile；**无默认值**，缺失即报错退出 |
| `EYS_AWS_ACCOUNT_ID` | 目标账号 ID，`sts get-caller-identity` 校验 |
| `EYS_SITE_DOMAIN` | 站点主机名 |
| `EYS_S3_BUCKET` / `EYS_S3_REGION` | 发布 bucket 与区域 |
| `EYS_CF_DISTRIBUTION_ID` | 上传后失效的 CloudFront 分发 |
| `EYS_ACM_CERT_ARN` / `EYS_HOSTED_ZONE_ID` | CloudFormation 部署参数 |
| `EYS_CF_CACHE_POLICY_ID` / `EYS_CF_RESPONSE_HEADERS_POLICY_ID` | 复用自有策略时覆盖模板默认的 AWS 托管策略 |

仓库内的 CloudFormation 模板是 [`infra/site.example.yaml`](../infra/site.example.yaml)，所有标识均为参数。
若本地保留了写死实际值的副本，请命名为 `infra/site.yaml` 或 `infra/site.local.yaml`——这两个文件名已在 `.gitignore` 中。

1. `npm ci`；先由原始工作区整理资产，或上线后 `npm run fetch-assets` 恢复哈希锁定的资产。
2. 增加 `package.json` 版本后执行 `npm run build`、`npm test`，再运行 `scripts/smoke.mjs`、`scripts/smoke-first-person.mjs` 和 `scripts/smoke-entry-recovery.mjs`；核对实际网页角色选择、进入地图与加载失败重试。
3. 创建基础设施：
   ```sh
   aws cloudformation deploy --profile "$EYS_AWS_PROFILE" --region ap-northeast-1 \n     --stack-name owd-eys --template-file infra/site.example.yaml \n     --parameter-overrides SiteDomainName="$EYS_SITE_DOMAIN" SiteBucketName="$EYS_S3_BUCKET" \n       AcmCertificateArn="$EYS_ACM_CERT_ARN" HostedZoneId="$EYS_HOSTED_ZONE_ID" PublishDns=false
   ```
4. 按 `scripts/publish.py` 的清单上传 `dist/`，先内容哈希资产、后 HTML；不删除远端旧文件。
5. 核对 CloudFront 实际资源，再将 `PublishDns=true` 应用到同一 stack，创建站点的 Alias A。
6. 检查 HTTPS、真实角色加载与移动、原始 S3 匿名请求被拒绝，记录发布回执。

GitHub 源码仓库**为公开仓库**（`onewonderjapan/owd-eys`）。因此：Git 不保存 GLB、人物头像、Blender 原件、登录信息、生成目录，也不保存任何账号级标识、内网地址、主机名或本机绝对路径。
公开文件仅为运行网页、运行 GLB 和缩略图；非官方二创与非商用声明必须保留。

> 注意：仓库转公开之前的**历史提交**中仍可能残留旧的账号标识与内网信息。本轮只清理了当前工作树；历史清洗（如轮换相关标识或重写历史）需另行评估执行。

## 建议：最小权限 IAM

发布不应使用管理员或 root 凭证。`scripts/publish.py` 已取消默认 profile，必须显式指定 `--profile` 或 `EYS_AWS_PROFILE`；建议为发布单独建一个 IAM 角色/用户，仅授予下列权限：

| 操作 | 资源 | 说明 |
|---|---|---|
| `sts:GetCallerIdentity` | `*` | 脚本的账号校验 |
| `s3:PutObject`、`s3:PutObjectAcl` 不需要 | `arn:aws:s3:::<bucket>/out/*` | 只写 `out/` 前缀 |
| `s3:GetObject`、`s3:ListBucket` | `arn:aws:s3:::<bucket>/out/*`、`arn:aws:s3:::<bucket>` | 复用已上传对象所需的 head/list |
| `cloudfront:CreateInvalidation` | 该分发的 ARN | 仅限本站分发 |
| `cloudfront:GetInvalidation` | 该分发的 ARN | 查询失效进度（可选） |

不授予 `s3:DeleteObject`（发布流程从不删除远端对象）、不授予 bucket 策略与 CloudFormation 变更权限；基础设施变更用另一套人工审批的凭证执行。
凭证走 AWS CLI profile / SSO，不写入仓库、不写入 `.env` 之外的任何文件。

## 首次上线验证（2026-09-10）

- 地址：<https://eys.onewonder.co.jp/>；CloudFormation stack 状态 `UPDATE_COMPLETE`。
- S3：`$EYS_S3_BUCKET/out/`；CloudFront：`$EYS_CF_DISTRIBUTION_ID`（实际标识见本地 `.env`，不记录在仓库）。
- Route 53 只创建站点主机名的 Alias A，指向此 CloudFront 分发。
- 112 个运行文件共 136,646,626 bytes，上传后逐个验证大小与 SHA256 元数据；缓存失效已完成。
- HTTPS 首页、角色清单、地图清单与地图 GLB 的公网 SHA256 与构建结果一致；HTTP 自动转 HTTPS，S3 原始地址匿名访问返回 403。
- 浏览器确认 27 位角色可选、全部头像解码成功；本地实测 14／01／27 三套角色，公网实测 27 与手机 14 的装配、移动、返回换角。390px 页面与触屏方向键通过，运行错误列表为空。
- 本地回执位于忽略目录 `reports/`，包含构建清单、上传记录、公网校验及截图。后续发布先运行本地检查，再用 `node scripts/verify-remote.mjs` 与 `node scripts/smoke.mjs https://eys.onewonder.co.jp/ production` 验证真实域名。

回滚使用保留的 S3 对象版本或上一版本发布包；不删除本地或云端文件。CloudFormation 的 bucket 设置 Retain。当前项目无需 EC2、数据库或在线生成服务；每位访问者独立探索。

## 1.1.0 更新（2026-09-10）

粉花绿鹅的五瓣花环增加实体厚度、正反面弧度和圆润边缘，沿用原装备 ID、外轮廓与脸部开口。模型和角色缩略图来自衣橱 4.3.28，Blender 在 S1 生成并重载确认；原角色与贵族眼镜／褶领混搭已查看。

行走时用 V 或「视角」按钮切换俯视／第一人称。第一人称保持鹅的眼睛高度，鼠标拖动或点击锁定后环顾；手机可同时按方向键与拖动画面。Esc 先释放已锁定的鼠标。移动仍经过原有地图碰撞与房间判定。

本地选角／行走检查及公网第一人称检查通过，包含相对视线移动、桌面锁定和释放、390px 双指同时移动与转头、返回俯视及换角。`reports/production/first-person.json` 保存结果与所测构建哈希。公网花环 GLB、角色头像、视角代码及原地图的 SHA256 一致，运行错误列表为空。

此次构建 113 个文件，实际上传 8 个变化文件，105 个已按远端大小和 SHA256 元数据确认一致并复用；缓存失效完成。无 DNS／基础设施变更。旧文件保留。后续同步源资产可运行 `python -X utf8 scripts/sync-workspace-assets.py --source <本地衣橱工作区>`；发布前运行 `node scripts/smoke-first-person.mjs`，上传脚本要求该结果与当前构建哈希一致。

## 1.1.1 进入地图修复（2026-09-10）

复现了旧版 HTML 缓存与新版脚本混用时，缺少新增视角按钮导致初始化失败的问题。该问题与用户报告的「选了角色，点击进入没反应」一致，但未能确认用户当时的浏览器是否正处于这一组合。调查时，全新浏览器的 27 位角色逐一进入通过。

视角组件现可兼容旧 HTML；新版页面把 JS、CSS、JSON 和 Three.js 依赖固定在 `releases/1.1.1/`。入口 HTML 与旧路径别名要求重新验证缓存，版本目录和哈希模型使用长期缓存。已发布的版本目录禁止覆盖不同内容。加载地图时显示下载进度，角色装配显示已完成数量；失败后显示提示并允许重试。

本地及公网均通过三项定向检查：旧 HTML 搭配兼容脚本、地图下载一次 503 后重试、角色模型下载一次 503 后重试。公网桌面与手机第一人称检查通过，HTTP 缓存头、版本路径及 9 项文件 SHA256 校验通过。发布 131 个文件，37 个上传、94 个复用，缓存失效完成。角色模型维持 4.3.28，访问控制及 DNS 未变动。

现有防护与低成本选项见 [ACCESS_PROTECTION.md](ACCESS_PROTECTION.md)。详细检查结果保存在忽略目录 `reports/incident/` 和 `reports/production/`。

## 1.2.0 – 1.4.2（2026-09-15 ~ 09-17）

这几版没有基础设施、DNS 或访问控制变更，发布流程与上表一致（构建 → 本地冒烟 → `scripts/publish.py` 上传 → 缓存失效 → 公网校验）。
各版本的功能改动见 [CHANGELOG.md](../CHANGELOG.md)；沉浸演出的镜头清单与实施记录见 [docs/immersion/](immersion/)。

