# EYS 访问防护现状与低成本选项

核对日期：2026-09-10。本文依据线上 CloudFront、S3 配置和真实 HTTP 响应；本次只更新网站运行文件，没有启用新的访问限制或订阅套餐。

## 当前已启用

- 私有 S3，四项 Block Public Access 均开启；存储桶只允许指定 CloudFront 分发通过 OAC 读取 `out/*`。原始 S3 地址匿名请求返回 403。
- CloudFront 只接受 GET／HEAD，HTTP 跳转 HTTPS，最低 TLS 1.2；安全响应头包含 HSTS、CSP、禁止 iframe 嵌入和 nosniff。
- AWS 提供自动包含的 Shield Standard 基础 DDoS 防护，见 [AWS Shield 文档](https://docs.aws.amazon.com/shield/)。它不等于应用层 IP 限流。

## 当前未启用或未核实

- Web ACL 为空，没有 WAF 规则；没有边缘函数、IP／国家限制或登录校验，签名 URL／Cookie 验证未启用。
- 站点面向公众，知道地址即可读取网页和运行模型。私有 S3 保护的是回源边界，不能阻止从公开域名下载资源。
- 旧版 CloudFront 访问日志开关关闭；其他日志通道、账单预算和告警本次未核实。
- 读取的六小时 CloudFront 指标没有 5xx，包含本次浏览器测试流量，不能据此认定存在或不存在恶意访问。

## 无需单独购买 WAF 的选项

1. **公开试玩：优先评估 CloudFront Free 固定套餐。** 官方当前列出 $0/月、每月 100GB 与 100 万次请求，包含 5 条 WAF 规则和 IP 限流；套餐内无超额费用，但持续明显超量可能调整性能。日志和高级机器人管理不在 Free 中。此费用范围不代表整个 AWS 账号免费。
2. **限定体验者：CloudFront Functions 校验口令／令牌或 IP 白名单。** 在边缘拒绝未授权者，适合少量邀请用户；令牌可以转发，IP 白名单需处理动态 IP。Functions 按调用计费，按量套餐有月度免费额度，最终以账号账单口径为准。仅靠函数的进程内计数或只读 KeyValueStore，不能实现可靠的跨请求 IP 限流。
3. **辅助限制：国家范围或防盗链。** 适合明确访问区域或减少外站引用。代理可绕过地域限制，Referer 可伪造，不能代替身份验证。账单告警只能通知，不是硬性封顶。

当前分发使用自定义 `onewonder-pet-static-v1` 缓存策略（MinTTL 0）和 `onewonder-pet-security-v1` 响应头策略。Free 套餐不支持这两种自定义策略，必须先准备替代配置、保留新入口的缓存行为及安全头，并确认账号资格。尚未执行套餐切换或限制规则。

官方依据：[CloudFront 定价](https://aws.amazon.com/cloudfront/pricing/)、[套餐功能与限制](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)、[边缘令牌校验示例](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_kvs_jwt_verify_section.html)、[Functions 免费额度说明](https://aws.amazon.com/cloudfront/faqs/)、[KeyValueStore 只读访问](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html)。
