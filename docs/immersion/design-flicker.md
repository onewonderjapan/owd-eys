# 应急按钮桌灯光闪烁事件设计(B7 / flicker)

版本:设计 1.0(2026-09-19 夜间任务,见 PLAN_FLASH_20260919.md F2)。状态:随 feature/overnight-20260919 分支交付。

## 1. 范围

| 纳入这一轮 | 暂不纳入 |
| --- | --- |
| 自由漫游走近**红色紧急按钮桌**(第二会议入口,`IMMERSION_CONFIG.button`)时,小镇灯光缓慢明暗两拍(约 2.2s)后完整还原 | 官方 sabotage 的玩法机制(任务失效/电力系统),仅取"灯光异常"的氛围影子 |
| 触发半径离开 + 滞回距离后重新武装(再走近可再触发) | 音效(静音语义零风险,也避免与会议音效抢戏) |
| reduced-motion:改为单次平缓压暗-回弹(不产生明暗振荡) | 持续性 sabot 事件队列、随机全局事件系统 |
| busy(会议/出局演出)期间绝不触发;演出中若在播放则立即还原并解除武装 | 与黄昏光照的组合编排(两者互不破坏即可,见 §3) |
| 只改灯光 intensity,原值逐灯还原;不销毁/不替换任何灯光或道具对象 | 颜色/贴图/雾变化;聚光灯逐盏扫动 |

不做联机/后端;非商用二创边界不变;官方截图不进 src/ 与生产资产。

## 2. 技术方案

- **参数正本**:`IMMERSION_CONFIG.flicker = {radius: 2.1, rearmGap: 1.0, duration: 2.2, dips: 2, floor: 0.55, reducedFloor: 0.7}`(舞台内零硬编码,遵循 shotlist 模板)。
- **实现位置**:`src/map-walk.js`(事件属于漫游世界,不属于任何 ejection 舞台)。漫游帧循环里:
  - 触发:roam、非 busy、非 paused、非 photoMode,且玩家与 `button.interaction` 距离 < `radius` → 保存场景顶层半球/平行光的 intensity 快照,进入播放。
  - 播放:亮度系数 `1-(0.5-0.5·cos(2π·dips·u))·(1-floor)`,u∈[0,1];起止均为 1.0,慢节奏余弦两拍,**非频闪**。
  - 还原:u≥1 时逐灯写回快照原值;`armed=false`,离开 `radius+rearmGap` 后重新武装。
  - busy 守卫:frameLoop busy 分支顶部 `stopFlicker()`(立即还原+解除武装);离开 walk(`stop()`)同样还原。
  - 黄昏互斥:若闪烁播放中切黄昏(setDusk),先还原闪烁再存黄昏快照,避免把被压暗值存成黄昏基线。
- **reduced-motion**:系数 `1-sin(π·u)·(1-reducedFloor)` —— 单次平滑压暗到 0.7 再回弹,无振荡。
- **可测性**:`window.eys.state().walk.flicker = {active, t, duration, count, lastMin, lastReduced}`
  与 `walk.lights`(当前各灯 intensity 数组)。count 为已完成触发次数(免竞态断言);
  lastMin/lastReduced 记录上次触发的最深压暗系数与是否 reduced 分支;lights 用于
  "还原后逐灯精确相等"断言。

## 3. 边界与风险

- 与会议入口共用同一张桌子:走近开会必然先触发一次闪烁——这是设计效果(氛围预告),
  不影响 KeyE 进入会议;会议开始的 busy 守卫保证演出画面不受闪烁干扰。
- 与黄昏叠加:黄昏开启时走进触发半径,闪烁在黄昏值基础上压暗并还原到黄昏值,数值自洽。
- 只扫 `scene.children` 顶层灯光(与 setDusk 同一扫描范围),ejection 舞台自建灯光不在范围。
