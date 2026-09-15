# 自己被票出的 POV 场景审查

结论：**需要精修，当前自身 POV 的视觉验收不通过。** 会话可以正常走完，但身体连接感、链石可读性与投入火堆的镜头还没有达到设计要求。原有流程测试 PASS 继续保留；它们不证明这几个画面已经合格。

## 审查对象与证据

- 本地运行版本：1.2.0，`http://127.0.0.1:8870/`；分支 `feature/pov-immersion`，HEAD `87d47c1ff1044e56fa134c0f5e1ec9cbd0c084f1`，功能存在于未提交修改中。
- 2026-09-14 新拍 16 张截图；Chrome headless，项目 Playwright，真实选角/进入漫游/键盘走到铃前/投票按钮。玩家 `cast.14`，目标为玩家本人。截图前后状态均写入 [capture.json](C:/3d/eys/owd-eys/.design/self-ejection-pov/capture.json)。
- 视口：1280×800、768×1024、375×812。后两项是桌面浏览器竖屏布局审查，使用鼠标拖动，未冒充真机触控验证。
- 核对了 ejection、director、actors、look 四个模块，src 与本地 served release 字节相同，排除查看旧构建的情况。完整哈希见 [review-baseline.json](C:/3d/eys/owd-eys/.design/self-ejection-pov/review-baseline.json)。
- 本轮未修改游戏源码、未重新跑全套 QC、未发布。7 次自身演出及返回未记录 pageerror；未做性能基准、声音听审或全部角色验收。
- 标准来自 [design.md](C:/3d/eys/owd-eys/docs/immersion/design.md)、[water-reference.md](C:/3d/eys/owd-eys/docs/immersion/water-reference.md) 和 [用户沉水图](C:/3d/eys/reference_research/immersion_20260913/user-water-sinking.jpg)。保留用户后续提出的鱼群和缓慢下沉；参考图只约束视觉关系，不证明官方动作时序。

## 必须修复

### R1 · P1：翅膀悬浮在眼前，竖屏失去双侧身体联系

**实拍：** 桌面两片翅膀在画面中部偏右，根部悬空；低头约 73° 后仍停在完全相同的屏幕位置。平板和手机只剩一片，另一片在画外。身体连接感没有随着低头建立。

证据：[桌面低头](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-water-down-3_8.png)、[手机低头](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/phone-water-down-3_8.png)、[手机火堆](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/phone-fire-forward-3_0.png)。

源码：[director:85](C:/3d/eys/owd-eys/src/immersion-director.js:85) 将两翼整组固定到相机，使用同一偏右位移和固定缩放；[actors:143](C:/3d/eys/owd-eys/src/immersion-actors.js:143) 的 extractWings 只复制网格几何/材质，没有保留明确的肩部连接与动作层级。

**精修要求：** 相机、身体、翅膀分清层级。以当前角色的肩部/身体代理作连接，翅根从视野下缘或身体侧面进入；正常平视时不占据画面中心，低头时身体/链条关系自然出现。屏蔽自身头脸、必要的近镜头帽饰，保留此前修复的 cast.14 不遮镜头效果。按 aspect 调整第一人称呈现，三种视口都能辨认左右身体联系。不能把完整自身模型重新打开后再次黑屏。

### R2 · P1：低头仍读不清长链和石块，抬起阶段链条脱离身体

**实拍：** 水下 3.85s，已实际拖到 pitch=-1.282 rad，画面只读到少量叠在一起的近端黑色链节；看不清独立石块与长链长度。手机也相同。抬起初段则出现一截悬在前方的链条，读不出它连着自己。

证据：[初段 0.4s](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-water-forward-0_4.png)、[水下低头 3.8s](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-water-down-3_8.png)。不能把浅色多边形气泡当成石块。

**确认的代码问题：** [ejection:209](C:/3d/eys/owd-eys/src/immersion-ejection.js:209) 把上锚点 X 写死为 sinkX=1.15，但抬起阶段玩家 X=0，抛出时才渐变到 1.15；相对当前身体至少在初段存在 1.15 单位的水平错位。真实 GLB 的 chain_anchor 被读取，却没有用于下锚点世界变换。28 节链节使用单位缩放，GLB 单节高度约 0.126；水下端点间距约 1.18，节中心距约 0.042，存在明显挤叠与沿链轴观看时的遮挡风险。

**证据缺口：** [ejection:223](C:/3d/eys/owd-eys/src/immersion-ejection.js:223) 将 gooseAnchor/stoneAnchor 直接赋值为 chainTop/chainBottom；[smoke:398](C:/3d/eys/owd-eys/scripts/smoke-immersion.mjs:398) 的对应距离比较因此恒等于零。旧链条 PASS 不能证明真实连接。

**精修要求：** 绑定身体局部锚点与石块导出锚点，更新世界矩阵后取真实世界坐标；链条长度、节距、缩放协调。调整身体绑点、石块相对前方的少量偏置和弱轮廓光，使低头约 60–75° 能从身前顺着长链看到下方独立石块，而不是视线恰好沿链轴被近端挡住。保持石块明显低于鹅、缓慢下沉，不引入海床或改成旁观视角。验收要分别取得模型锚点与实际首末链节端点，不能继续比较别名数组。

### R3 · P1：火堆眼位跳变，投入后失去火堆；抬举动作缺少接触

**实拍：** 1.5s 火堆在前方，2.1s 火焰逼近下缘，2.4s 突然变成大片空地和红色翅膀；3.5s 偶尔只有左侧巨大火焰片，竖屏 3.0s 完全读不到火堆。两位陪同鹅只在开头边缘露头，没有清楚的“托住—抬起—松手”动作。

证据：[1.5s 接近](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-fire-forward-1_5.png)、[2.1s](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-fire-forward-2_1.png)、[2.4s 火堆丢失](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-fire-forward-2_4.png)、[手机 3.0s](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/phone-fire-forward-3_0.png)。

**原因：** [ejection:315](C:/3d/eys/owd-eys/src/immersion-ejection.js:315) 的自身相机先在目标后方，1.2s 换另一套偏置，2.2s 再直接置于 pitEye；按当前公式，2.2s 前后位置极限相差约 0.95 项目单位，这是代码推导值，不是速度测量。导演 [director:200](C:/3d/eys/owd-eys/src/immersion-director.js:200) 又用自由观察绝对旋转覆盖 baseYaw/basePitch，所以阶段设计的转向没有执行；实测默认 yaw 全程 -π/2，pitch 全程 -0.05。陪同鹅在 [ejection:250](C:/3d/eys/owd-eys/src/immersion-ejection.js:250) / [ejection:386](C:/3d/eys/owd-eys/src/immersion-ejection.js:386) 固定站位且 standing，不随抬举/松手变化。

**精修要求：** 水火共用稳定的身体移动基准，眼位从本体求出；抬举、短抛物线、入水/入坑连续衔接。镜头基准姿态与用户观察偏移组合，不能互相覆盖，也不能每帧强行归零用户视角。两位鹅用现有翼部 pivot 体现接触、抬起、释放，不引入复杂物理。火堆投入时坑沿、木柴、火光保持空间连续，不能靠“翅膀变红”代替进入火中。保留自由环顾与取消退出。

## 应当同步精修

### R4 · P2：水下入场时机和深水氛围不统一

**实拍：** 标称水下的 2.55s 仍有横贯画面的水面边界，翅膀被水面切成两段；3.5s 默认前视仍大面积亮蓝。低头画面较暗，但缺少可辨认的石块轮廓。

证据：[2.5s 水面](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-water-forward-2_5.png)、[3.5s 前视](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-water-forward-3_5.png)。

**代码：** [ejection:127](C:/3d/eys/owd-eys/src/immersion-ejection.js:127) 与眼高计算使 2.4s 的眼位 Y 仍为 +0.0595，而水面 Y=0；鱼群、水花、声音分别按另一组固定时间启动。水花还在 2.05s 与 2.4s 两段公式重新出现。声音只做代码审查，本轮未听审。

**要求：** 区分身体碰水和眼位过水面事件，让各自的水花/水下环境转换由同一轨迹事件触发，避免整张矩形闪白两次。核心水下阶段回到参考图的深海军蓝、上方弱光、下方暗色；石块和链节有少量轮廓光。通过微弱远近参照表现慢沉，不能只把背景一刀换蓝。核心可读水下段至少约 3s；若时长不足，只微调本段配置并记录，不增加地图。

### R5 · P2：鱼和火焰仍是明显的几何占位效果

**实拍：** 鱼是没有鱼尾的黄色圆锥，近镜头时像飞来的尖锥；气泡像不透明灰色多边形；火焰是高亮矩形交叉片，越靠近镜头越明显。

证据：[水下装饰](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-water-down-3_8.png)、[火焰矩形](C:/3d/eys/owd-eys/.design/self-ejection-pov/screenshots/desktop-fire-forward-1_5.png)。源码：[ejection:104](C:/3d/eys/owd-eys/src/immersion-ejection.js:104)、[ejection:294](C:/3d/eys/owd-eys/src/immersion-ejection.js:294)。

**要求：** 保留用户要求的鱼群，补鱼身/尾鳍轮廓、柔和配色和离眼位的最小距离，让它们做中远景参照；气泡小、稀疏、柔边且不抢链石。火焰用带透明轮廓的程序化材质/形状，火根连着木柴，收住白色过曝和镜头内巨大片。复用资源与既有数量上限，不扩成体积水/体积火工程。

## 代码审查补充：修改导演时顺手核实

以下没有在本轮浏览器独立复现，不能标成画面实测缺陷或已通过：

- 减少动态：START 事件未传 reducedMotion（[director:329](C:/3d/eys/owd-eys/src/immersion-director.js:329)），状态机默认 false；CSS 媒体查询仅影响淡入淡出。即使传 true，现有水火位置动画仍会强制移动。应接通偏好、提供固定眼位/低动态衔接，保留主动观察。
- 重播/跳过入口直接 machine.dispatch，而 enterPhase 依赖 tick 前后或另一套 wrapper；重播可能漏掉 look 重置与阶段一次性动作。精修导演时统一入口，并验证一次“低头→结束→重播”恢复预定初始姿态与效果。
- finished 以 elapsed=999 采样演出，应冻结真实末帧或使用明确结束姿态，避免假时间重新改变特效/动作。

## 精修验收与交接

先完成 R1–R3，再处理 R4–R5。用实际自己 POV 证明：左右翅根有依托，抬举/松手可读；低头看清链石；火堆投入前后连续；竖屏核心主体不丢失。水下姿态至少保留约 3s 供观察。两段各交付一段完整录屏和固定关键帧，写清实际动作时刻，不能用 NPC 图代替自己。

沿用已有功能 PASS；只做本轮修改关联的轨迹/锚点检查、针对性浏览器路径、一次构建。NPC 水/火各做一次短回归以保护共享代码即可；不要求从 P0A 重造道具，不追加审查代理。修改前后证据分目录保存。

当前交接：[ZCode 精修提示词](C:/3d/eys/owd-eys/docs/immersion/ZCODE_SELF_POV_REFINEMENT_PROMPT.txt)。本报告提出的是下一轮施工要求，当前源码尚未修复。
