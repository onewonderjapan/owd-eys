# 第一人称装备可见设计(B5 / pov-gear)

版本:设计 1.0(2026-09-20 夜间任务,见 PLAN_FLASH_20260920.md F5;仅设计,未施工)。

## 1. 范围

| 纳入(施工时) | 暂不纳入 |
| --- | --- |
| 第一人称/俯视漫游中,玩家角色已装备的**可见装备槽**随身体出现在画面里:翅尖上的 **wristwear**(flower.cuffs、winter.cuffs、lobster.claws)、随身 **handheld**(bard.lute 鲁特琴、guard.spear 长矛、anubis.khopesh 弯刃、guard.axe 斧、drink.carton 饮料) | 第一人称**头部镜面**里的自己(headwear/facewear 在低头时可见即可,不做镜面) |
| 数据源:漫游 avatar 的 `modules`(`manifest.presets[actorId].modules`)按 slot 分派到 POV 挂点,装备即挂、卸下即消失 | 挂点骨骼动画(手部摆动沿现有 waddle 节奏驱动) |
| 每槽一个**简化 POV 代理**(低模/贴图减半),不换玩家本体网格 | 任何新建模/新贴图;复用现有 GLB 与 A2 精修产物 |
| 手机端:handheld 只挂 1 件(优先 handheld > wristwear),wristwear 不挂 | 出局演出舞台内的装备变化(演出自带道具系统,互不干涉) |
| reduced-motion:挂点跟随但不做摆动(静止贴身) | 与 NPC 镇民的装备交互(NPC 保持现有无装备状态) |

## 2. 技术方案(草案)

- **挂点**:玩家 `visual` 组内新增两个空挂点 `pov_wrist`(翅尖,左右各一)与 `pov_hand`(身侧),位置与缩放先按俯视对照图定,参数进 `IMMERSION_CONFIG.povGear`(零硬编码)。
- **数据流**:`loadWalkingAvatar` 已返回 `modules`;`walk-npcs` 模式不适用(玩家唯一),在 `map-walk-avatar.js` 挂装备时**同槽挂 POV 代理**(缩小 + 位移,不改 mountEquipment 本体契约);换装后重进漫游即生效(漫游入口已有 avatar 重建)。
- **遮挡与裁剪**:第一人称下代理必须过"低头可见、平视不糊脸、不遮铃提示"三查;near plane 0.1 现值不动。
- **对 A2 精修的依赖**:手持物与本体的贴合受 A1/A2 曲面结论影响——**A2 三件外套方向拍板后**才施工(外套袖口会遮挡 wristwear 挂点),本设计先行冻结接口。

## 3. 性能与开关

- POV 代理 ≤2 个网格实例,三角形预算 ≤1500(复用现有 GLB 缩放,不新增资产);手机只挂 1 件,drawCalls 增量 ≤2。
- 冒烟信息项(不判失败):drawCalls 前后差、memory.geometries 差;预算门等 perf_probe 接发布门后一并生效。
- reduced-motion:摆动幅度固定 0;静音/暂停/busy 冻结五条语义不受影响(代理是玩家 avatar 子节点,跟随其显隐)。

## 4. 验收草案

1. 27 位角色 × 默认装:进漫游低头能看到 handheld/wristwear 对应件;卸装后消失(状态 `walk.npcs` 不变,新增 `walk.povGear = {slots: [...]}`)。
2. 桌面冒烟 +2 项:装备代理挂载数与 modules 匹配;busy 期间跟随玩家隐藏。
3. 手机冒烟 +1 项:只挂 1 件;drawCalls 增量 ≤2(信息项)。
4. 对照证据:`docs/immersion/` 下新增 pov-gear 对照截图(低头/平视/俯视三机位 × 有/无装备)。
