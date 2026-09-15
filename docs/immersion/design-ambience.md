# walk 环境音与脚步声设计(B1 / ambience)

版本:设计 1.0(2026-09-15 夜间任务,见 PLAN_TONIGHT_20260915.md T2)。状态:随夜间分支交付。

## 1. 范围

| 纳入这一轮 | 暂不纳入 |
| --- | --- |
| walk 模式的低音量环境底噪(风/远处水声,Web Audio 合成) | 音频文件资产、3D 空间化音频、按区域变化的环境声 |
| 与移动联动的脚步声:走才响,停即停,节奏随步频 | 靴子/地面材质差异化脚步 |
| walk HUD 新增「声音」开关(默认开;记住偏好到 localStorage) | 全局设置页、音量滑杆 |
| 失焦自动暂停时静音(复用既有 pause 行为) | 后台继续播放 |

不做联机/语音/AI 对话/后端/账户/付费;非商用二创边界不变。

## 2. 技术方案

- 新模块 `src/walk-audio.js`,工厂 `createWalkAudio()`,模式仿 `immersion-audio.js`:
  惰性创建共享 AudioContext、主增益节点、一切失败静默不阻塞体验。
- **环境底噪**:环形白噪声 buffer → 低通(约 400Hz,缓慢 LFO 在 300–500Hz 漂移)→
  低增益(≈0.035)。无采样资产,纯合成。
- **脚步声**:frameLoop 每帧调用 `frame(dt, moving)`;内部按累计移动距离每 0.62 单位
  (与视觉 bob 的 `s.distance*15` 同源节奏)触发一次短促带通噪声(约 90ms,
  700→250Hz 下扫,峰值 ≈0.12,随机 ±8% 音高/音量防机关枪效应)。不移动不累计。
- **开关**:HUD `walk-actions` 行新增 `<button id="walk-mute" aria-pressed>`;状态存
  `localStorage['goose.walk.audio']`;默认开。静音走主增益,不销毁上下文。
- **生命周期**:`start()` 时解锁(进入 walk 的点击即用户手势);`stop()` 时停底噪并
  suspend;失焦 pause / 回焦 resume 挂到 map-walk 既有 `pause()`/`resume()`。
- **可测性**:暴露 `window.eys.state().walk.audio = {on, muted, steps, ambience}`。
  steps 为累计脚步计数,smoke 用它断言"移动时增长、静止时不变、静音后不再增长"。

## 3. 验收

- 桌面 + MOBILE=1 smoke 全绿,新增 3 条音频断言通过。
- 静音开关对环境音与脚步同时生效;刷新后记住偏好。
- 不影响 immersion 会话内的既有音效(immersion-audio 独立实例,互不共享节点)。
- reduced-motion 不改变声音行为(声音与动效无关)。
