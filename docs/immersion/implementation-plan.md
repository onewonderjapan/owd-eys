# POV 沉浸体验施工计划

执行者：ZCode（沿用 GLM-Flash），单代理，按 P0→P0A→P1–P6 顺序施工。读取本机官方与项目skill的路径见 [blender-assets-plan.md](blender-assets-plan.md)，无需Codex专用API；当前已授权本地开发、S1道具制作及验证，不授权发布。设计见 [design.md](design.md)，入口见 [START_HERE.md](START_HERE.md)。

**目标：** 在现有 Three.js 漫游里完成按铃、8 席 POV 会议、脚本投票、沉水/火堆四个视角分支，以及完整恢复与重试。

**架构：** 一个 renderer、一个行走 RAF，额外 Scene 和 PerspectiveCamera 由会话导演提供渲染目标；漫游状态冻结，结束时恢复。纯状态机处理阶段与票数，UI、角色包装、布景、音频分开。不得引入 React、R3F、Phaser、物理引擎、在线 AI 或新依赖。

**已核对的技术栈：** 原生 ES Modules / Three.js 0.180.0 / Playwright 1.55.0 / Node.js；项目版本 1.1.1，衣橱 4.3.28，地图 map_reference_v2。详细实测基线在 [baseline.json](baseline.json)。下述 `src/`、`scripts/` 相对路径均以 `<repo>` 为根。

**参考修订：** 用户已经提供沉水图片。P4必须先读 [water-reference.md](water-reference.md)，水下构图以该图为准；不要继续沿用早期「沉水待补图」的候选状态。

## 0. 不变量与施工纪律

- `src/map-scene.json`、`src/map-walk-props.json`、`src/assets/manifest.json`、所有现有GLB/头像/装备及源Blender不变；`assets-manifest.json`只追加本轮新道具，旧记录完全保留。新增铃碰撞仅加到运行时props副本。
- 原入口的失败重试、旧 HTML 容错、版本目录资源加载、27 角色/65 装备及非官方声明继续有效。不更改 WAF、S3、CloudFront、DNS、证书或发布策略。
- 修改文件 UTF-8 无 BOM、LF。只修改本功能相关文件；不全仓格式化。不要 `git reset`、`git clean`，不要删除目录或结束别人的服务。
- 新增七类道具采用Blender/GLB资产路线，详细契约见 [blender-assets-plan.md](blender-assets-plan.md)。实体道具不能以占位几何交差；动态水/火效果仍使用Three.js。原角色复用，不重做本体；Blender建模、渲染、烘焙及批量优化在S1执行。
- 不把私人路径、研究原图、施工文档、日志写入 `src/`。公开包检查会拒绝私人路径；新运行时配置只能包含公开资产 ID、数值与用户可见文案。
- P0–P5 使用既有依赖完成本地工作。P6 才将 package.json/package-lock.json 候选版本一起升为 1.2.0；若施工开始时版本已变化，先核对已占用版本并记录新的未发布版本，不能覆盖已发布的 immutable 目录。
- 不靠定时等待驱动状态：只有主 RAF 的 dt 推进阶段，暂停时不计时；加载、按钮和取消走事件。不要建立第二个 renderer、RAF 或持续 setInterval。

## 1. 当前真实接口与改动接缝

| 文件 | 当前行为 | 本次接入 |
| --- | --- | --- |
| `src/main.js` | `renderer.render(scene, walking?.camera || camera)`；主入口独占 enter 点击；`window.eys.state()` 只读 | render 查询 walking.renderTarget；继续保留现有 camera fallback。诊断信息加在 walk.state().immersion |
| `src/map-walk.js` | 拥有 RAF、keys/touches、walker、avatar、pause/stop；`view.update()` 每帧跟随 | 拥有一个 director；busy 时停止 walker.step 和 view.update，改调用 director.update；统一输入优先级与退出恢复 |
| `src/map-walk-view.js` | 返回 change/sync/projection/unlock/escape/input/update/camera/state；没有恢复接口 | 新增 snapshot/restore，给切换按钮/KeyV 加可切换门控；旧 DOM 节点读取保持安全 |
| `src/map-walk-simulation.js` | `createNavigation(layout,props)`、`createWalker(nav)`；state.position 是 `[X,Z]`，reset 只回出生点 | 原则不改。先校验原 props 的 map_id/hash，再以 `{...props,proxies:[...props.proxies,bellProxy]}` 构造导航 |
| `src/map-walk-avatar.js` | `loadWalkingAvatar(actorId,onProgress)` 返回 player/visual/model/version/actorId/label/modules；独立资源遍历释放 | 复用装配。修补实际所需的部分失败释放，禁止 rejected Promise 污染后续；演出副本由 immersion-actors 所有 |
| `src/map-walk.css`、`src/hud-fragment.html` | 现有漫游 HUD | 优先不改旧结构；新 UI 运行时 idempotent 创建，样式在新 immersion.css，旧 HUD 按阶段隐藏/恢复 |
| `scripts/build.mjs` | src 全树复制＋releases/version 复制，产物逐文件哈希 | 原则不改；新 JS/JSON/CSS 资源使用 import.meta.url 相对定位。没有新音频文件 MIME 需求 |

导航已验证：Three X/Z 地面、Y 高度；像素变换 `[(px-526)*0.06,(py-279)*0.06]`。铃中心 `[9.70,-7.65]` 与触发站位 `[9.12,-7.56]` 当前均 `nav.collision(...) === null` 且 `roomAt(...).id === '04'`。新铃碰撞代理为以中心为圆心、半径 0.16 的 12 边形，`name:'immersion-bell'`、`room:'04'`、`height:[0.338,1.138]`。与角色半径 0.22 一起计算后，触发站位仍必须可达。

## 2. 新模块分工和契约

以下是要实现的新接口，不表示当前仓库已有这些函数。使用 JSDoc 记录约定即可，不迁移 TypeScript。

| 新文件 | 单一职责与导出 |
| --- | --- |
| `src/immersion-config.js` | 导出 IMMERSION_CONFIG、selectRoster(playerActorId)、createBellProxy()；尺寸/时长/候选角色/地图默认演出集中在此 |
| `src/immersion-assets.json` | 本轮GLB包URL/hash/bytes及七个节点名，禁止私有源路径 |
| `src/immersion-props.js` | createPropLibrary：加载、实例化、重试、共享几何材质与统一释放，完整接口见Blender资产计划 |
| `src/immersion-state.js` | `createImmersionState()`：纯事件状态机及票数计算，不能 import Three、DOM 或调用网络 |
| `src/immersion-director.js` | `createImmersionDirector(deps)`：启动/结束/异步生命周期/主时钟/渲染目标；不直接写 walker.position |
| `src/immersion-actors.js` | 加载独立的 8 位演员，坐姿/站姿/被抬姿态、POV 翅膀；变换复位与资源所有权 |
| `src/immersion-meeting.js` | 法院铃 Group 与会议 Scene、灯、椅、桌、座位与发言表演 |
| `src/immersion-ejection.js` | 一套水/火短演出接口，搭局部舞台、放演员、按时间采样镜头 |
| `src/immersion-ui.js` | ensure UI、状态呈现、点击回调、焦点/触摸；不计算票数和阶段时序 |
| `src/immersion-look.js` | 临时相机的拖动 yaw/pitch；按需 enable，无自动鼠标锁，清理 pointer capture |
| `src/immersion-audio.js` | 用户手势解锁的 Web Audio；bell/chair/water/fire 音效、静音/暂停/节点释放 |
| `src/immersion.css` | 新 HUD 和短淡入覆盖层；尺寸、safe-area、低动态样式 |
| `scripts/test-immersion.mjs` | Node assert 纯逻辑和真实配置/导航不变量检查 |
| `scripts/smoke-immersion.mjs` | Playwright 真实 UI 流程、截图、错误/恢复/移动端检查与报告 |

### 状态机

```js
// immersion-state.js
const machine = createImmersionState();
machine.dispatch({type:'START', actorIds, playerActorId, style:'water', reducedMotion:false});
machine.dispatch({type:'READY'});
machine.tick(dt);  // dt seconds; reject negative/NaN; cap at .05; paused => no advance
const state = machine.snapshot(); // deep plain-data snapshot, no live Sets or Three objects
```

状态字段固定为：`phase, elapsed, paused, actorIds, playerActorId, selectedId, targetId, style, selfDemo, votes, speakerIndex, error`。phase 取 `roam | preparing | error | ringing | seating | discussion | voting | result | ejection | finished | returning`。`busy = phase !== 'roam'`，error 也算 busy，直到重试或取消。

事件及效果：

| 事件 | 可处理阶段 | 效果 |
| --- | --- | --- |
| START | roam | 检查恰好 8 个唯一 actorIds 且 player 为首，重置会话，进入 preparing |
| READY / LOAD_FAILED | preparing | 分别进入 ringing / error；error 保存可读错误 |
| RETRY | error | 清错误，重新 preparing；director 启动新的加载代次 |
| BEGIN_VOTE | discussion | 提前进入 voting |
| SELECT(actorId) | voting | 仅接受本轮 NPC，selectedId 更新，selfDemo=false |
| SELF_DEMO | voting | selectedId=player，selfDemo=true，仍等待 CONFIRM |
| SET_STYLE(style) | discussion/voting | 仅 water/fire；其他值忽略 |
| CONFIRM | voting 且有 selectedId | 锁定 targetId/style，计算设计中的 8 条 votes，进入 result |
| SKIP | ringing/seating/discussion/result/ejection | 跳到该阶段正常下一阶段；不绕过加载或投票确认 |
| REPLAY | finished | 保留 target/style/votes，进入 ejection，elapsed=0 |
| RETURN | finished | 进入 returning，0.25 秒后 roam |
| CANCEL | 任意非 roam | 立即回 roam；由 director 发一次 onEnd；重复取消无副作用 |
| PAUSE / RESUME | 任意 | 只改 paused；RESUME 不补累计墙钟时间 |

定时转换：ringing 1.2 → seating 0.8 → discussion 7.8 → voting；result 1.2 → ejection（水 6 / 火 5）→ finished。每次进入阶段 elapsed 归零，发言者索引 `min(2,floor(elapsed/2.6))`。无效/重复/阶段不符事件忽略，不抛出让 UI 崩溃。style、targetId 一旦确认，不再受配置面板改变影响。

### 导演与行走集成

```js
const director = createImmersionDirector({
  props, // 当前map-walk拥有的PropLibrary，世界铃/舞台共享
  worldScene: scene, host, canvas: renderer.domElement,
  getAvatar: () => avatar, getWalker: () => walker, getNavigation: () => nav,
  onEnd: ({reason}) => restoreWalkSession(reason),
});
// director:
// start({playerActorId}) -> Promise<void>；只允许 roam+靠近铃时开始，其他触发立即返回
// dispatch(event), update(dt), projection(width,height), cancel(reason), dispose()
// get busy(): boolean
// get renderTarget(): null | {scene: THREE.Scene, camera: THREE.Camera}
// state(): 纯 JSON，含状态机快照与 loadedActors/sessionId/资源错误诊断
```

`start` 内部可读 walker/nav 判定交互，不能提供未校验的远程起会入口。声音解锁在用户触发调用栈内同步发起，随后才 await 加载。首次进入漫游时PropLibrary异步加载，未ready前禁用按铃；失败仍可正常漫游，显示道具重试按钮。director.start也检查props.state().ready，不能READY后才发现没有桌椅。`preparing/error` 的 renderTarget 为 null，仍看原地图；ringing 使用 worldScene＋铃前相机；seating 至 finished 使用相应舞台 Scene；returning 保持最后舞台淡黑再恢复。

map-walk 的入口包装顺序：检查 active/paused/help/info/nearBell → clearInput → snapshot 原 view 和位置/朝向 → view.unlock → director.start。只在成功接受 START 时保存一次快照。view.snapshot 返回 `{mode,yaw,pitch}`，view.restore(snapshot) 直接还原数值并 sync/update/projection，**不能调用 change() 模拟恢复**，因为 change 会重算初始 heading。

主帧循环：

```js
if (director.busy) {
  director.update(paused ? 0 : dt);
  // 不执行 walker.step、漫游 avatar 步态、view.update、camera follow。
} else {
  // 原有漫游帧逻辑。
}
render(); // 原 RAF 只保留一次提交
```

main 的渲染：

```js
const render = () => {
  const target = walking?.renderTarget;
  renderer.render(target?.scene || scene, target?.camera || walking?.camera || camera);
};
```

walking 新增 renderTarget getter；原 camera getter保留。resize 调原投影与 director.projection；忙时不让 view/overview 改演出相机。忙时所有 movement/E/V/home/help/inspect 入口均路由到会话逻辑，不只拦键盘。现有 view.toggle.onclick 也需 `canChange` 门控。

原 pause/resume 同时向 director 派发 PAUSE/RESUME，并暂停/恢复音频；只传 dt=0 不足以更新UI中的paused状态。director检测到 busy→roam 时统一调用一次 onEnd，涵盖正常RETURN结束、CANCEL和全局stop；不要在多个分支分别重复调用恢复。取消后再来的READY/LOAD_FAILED既要过sessionId检查，也要过状态机阶段检查。

结束恢复：冻结期间位置不发生变动，校验差距 ≤1e-6；恢复保存的 heading/view、avatar 可见性、旧 HUD hidden 值、焦点；清输入。normal return/cancel 回漫游；全局 stop/更换角色先置 active=false，再 cancel director，onEnd 此时只清快照，不能重新激活漫游。原 controls、DPR、滚动位置的恢复仍由原 stop 处理。

### 舞台、角色、音频的所有权

```js
// actors：独立加载8份，所有权限于此会话；不借用 walking avatar 做破坏性姿态
loadImmersionActors(actorIds, {onProgress, isCurrent}) -> Promise<ActorSet>
// ActorSet: get(actorId), pose(actorId, mode), reset(), dispose()
// mode: 'seated' | 'standing' | 'carried'; 位置朝向由舞台决定
// ActorSet 创建的 POV 翅膀只共享只读 geometry/material，统一 dispose 一次

createWorldBell({config, props}) -> {group, update(t), dispose()}
createMeetingStage({actors, playerActorId, config, props}) -> Stage
createEjectionStage({actors, targetId, playerActorId, style, config, props}) -> Stage
// Stage: scene, camera, update({elapsed,speakerIndex,reducedMotion}),
//        projection(width,height), reset(), dispose()
// Stage.dispose只释放自建动态效果与私有材质；移除借用道具，不释放actors/PropLibrary的资源
```

演员一次会话内复用，水/火切换与重播不能再次下载或多建演员。最多并发加载 2 个 actor；计数是完成角色数 0..8，不是各模块完成数相加。角色装配内现有多 GLB Promise.all 若有部分成功再失败，要捕获并释放成功部分；等所有该次请求 settle 后清理，不能漏掉晚到资源。

每次 start/retry/cancel 递增 sessionId。完成回调只有 `id===currentId && !cancelled` 才可挂场景或 READY；晚到模型 dispose 后丢弃。取消立即返回地图，**不等待慢网络才恢复 UI**。GLTFLoader 的底层请求未必能真正取消，代次检查必须存在。失败清空本次失败状态，重试不沿用 rejected Promise。结束后释放会话 Scene/ActorSet/音频节点；原漫游 avatar 永远只由 map-walk 释放。

为了避免旧 HTML 缺少新元素，`ensureImmersionUi(host)` 运行时只创建一个 `#immersion-ui`，可重入；内部链接 `new URL('immersion.css',import.meta.url).href`。事件绑定一次，提供 `render(state)` 和 `dispose()`；字符串用 textContent，头像 URL 来自现有 manifest。既有 DOM 读取需判空，旧模板不能让第一步直接崩溃。

音频接口：`unlock()`、`play(cue)`、`setMuted(bool)`、`pause()`、`resume()`、`stop()`、`dispose()`。无可用 AudioContext 时返回静默成功；pause/resume 不重复播放钟声；停止断开所有本轮 source/gain 节点。可复用一个 AudioContext，不为每个音效新建上下文。

## 3. 分阶段施工

每阶段只在通过列出的必要检查后将 progress.json 对应项标为 passed，记录改动文件、执行命令、截图/报告路径。不要把计划中的检查填写成已执行。小阶段无需反复跑所有既有浏览器回归。

### P0：基线、接口与状态机

- [ ] 读skill/设计/Blender资产计划/台账；对baseline.json所列关键文件核SHA256。另存当前assets-manifest至本轮报告目录作为只追加检查的输入，后续不能刷新这份输入掩盖旧记录变动。HEAD 改变不自动等于冲突，检查具体 diff；禁止重置代码对齐旧 HEAD。
- [ ] 确认干净或记录已有修改，保留用户文件。在当前 checkout 创建本功能本地分支（若已在同名功能分支则续接）；不创建第二份资产目录、不推送。
- [ ] 创建 immersion-config.js，集中实现尺寸、候选8位NPC、时长、默认演出和铃代理。
- [ ] 创建 immersion-state.js，实现完整事件表与派生票数。
- [ ] 创建 scripts/test-immersion.mjs。用真实配置与模拟时间验证：非法阶段事件无效果、未选择不能确认、8 张票计数正确、自己演示与普通投票分开、暂停不推进、重复确认/取消不重复出结果、重播不丢 target/style。
- [ ] 在同一测试验证 roster 对27位玩家都为8个不重复ID且玩家首席、bell交互点在 room04、叠加bell代理后该点仍无碰撞；校验地图/碰撞文件原哈希未变。
- [ ] 运行 `node scripts/test-immersion.mjs`，产出明确断言结果。此阶段不声称已有画面。

### P0A：Blender道具、GLB接入与验证

- [ ] 先读 [Blender资产计划](blender-assets-plan.md) 和其中三个skill入口，核实S1/SMB/Blender运行环境；在progress记录run_id、实际二进制/版本、日志/产物位置。所有新路径按文档创建，旧源文件不动。
- [ ] 创建scripts/immersion下的构建、S1薄启动器、导入、检查脚本；按七个固定根节点与三个挂点在S1制作.blend和GLB。先做轮廓、厚度、比例与材质，不能输出几个未经处理的默认立方体冒充道具。
- [ ] S1实际重开.blend，导出并检查节点、尺寸、法线、材质；拍道具全景/铃转轴/椅面/链石细节，最后写asset-report.json。复用现有工具做适量glTF优化，不引入未配套解码器。
- [ ] W2经SMB收集并核hash，按真实hash缓存GLB，只追加assets-manifest，生成公开immersion-assets.json；原清单条目、27角色/65装备保持不变。
- [ ] 实现PropLibrary，浏览器加载实际GLB，检查原点/轴向/pivot与材质；保存props-browser.png。运行node scripts/immersion/check_props.mjs并保存真实结果。
- [ ] P0A通过后继续P1。若S1暂时不可用，将P0A标blocked并记具体依赖，仍可推进P1–P3的独立代码；涉及真实道具的截图和阶段不得假记passed。

### P1：导演接入、铃与退出恢复

- [ ] 创建 director/UI/样式/临时 look 模块，完成单会话资源容器和渲染目标；接入 main.js 与 map-walk.js。
- [ ] 为 map-walk-view.js 新增 snapshot/restore/canChange 门控，兼容缺少新 HUD 的旧页面。
- [ ] 从PropLibrary实例化真实prop_bell并挂原世界，添加运行时代理和近距离判定。E/触摸按铃进入 preparing；远离恢复位置查看。
- [ ] START 时保存快照，busy期间禁行走与视角切换；先可用静态准备面板验证取消，不能以该面板算最终会议。
- [ ] 实现准备中取消、Error重试 UI、Esc/更换角色/失焦；late-load 代次检查与 dispose 不留到最后补。
- [ ] 局部浏览器检查：从真实角色册进入地图，走到法院附近触发/取消；长按W再按铃，退出时不能继续自行走动；截图 `reports/immersion/bell-near.png`。记录快照前后坐标、heading、view。

### P2：演员、坐姿和眼高圆桌

- [ ] 实现 immersion-actors，使用8份现有装配；按语义前缀组织脚/脚缝/翅膀 pivot，保存并可复原所有变换。不新增人物素材，不删服饰。
- [ ] 修复装配实际需要的部分失败清理，并用请求中断验证；完整角色数就绪后才 READY。异步取消检查先通过再继续堆视觉。
- [ ] 实现 createMeetingStage，从PropLibrary取圆桌与椅子，实例化8椅8座，桌沿与眼高按设计；NPC都面桌心。玩家摄像机隐藏整头，提取副本翅膀供POV，不能碰漫游avatar。
- [ ] 添加铃前 POV 翅膀/钟摆动画和 seating 淡入。临时 look 只在会议允许拖动，原view.canLook false，避免同一次拖动两台相机都响应。
- [ ] 截图：`meeting-pov.png`、`meeting-seats-debug.png`（仅调试相机，用于确认椅子与脚，不作为正式玩家视角）、`meeting-mobile.png`。
- [ ] 用 cast.10 与一位有大头饰的角色走一次；确认现有装备身份、脚坐姿与桌面关系；A2通过才进入P3。纯站姿或鹅站桌上不得通过。

### P3：发言、投票与结果

- [ ] UI 接入纯状态机：3段字幕、说话角色标记/微动作、提前投票、7个NPC头像、自己的演示入口、独立确认按钮。
- [ ] discussion/voting 显示沉水/火堆选择；确认后锁定。头像 selection 用 aria-pressed；默认无选择，确认禁用。
- [ ] 按事件契约计算8票结果；目标演员与文本、票数和后续出局 actorId 使用同一 source，禁止随机重新挑鹅。
- [ ] 输出状态只读 `window.eys.state().walk.immersion`，包括 phase/targetId/style/actorIds/votes/paused/sessionId。禁止加入任意执行代码或远程控制入口。
- [ ] 短UI检查：选A再选B只有B提交；双击确认只有一次；自己演示选中后仍需确认；拖动不能误投票；截图 `voting.png`、`vote-result.png`。

### P4：沉水两种视角

- [ ] 打开 [用户沉水图与施工说明](water-reference.md)：确认鹅在上、长链连接下方石块、深蓝留白；单帧未显示触底，不追加海床结局。
- [ ] createEjectionStage 支持 water；把已选目标和两名不同于目标的陪同演员移入出局舞台，不 clone出额外整身演员。
- [ ] 从PropLibrary取短码头、石块和单链节几何；按6秒设计制作短入水衔接，2.2–5.6秒突出深蓝水下主体。链条悬垂约目标身高1.2–1.5倍，石块独立位于下方；链节用24–32个低面数实例，上下锚点随鹅/石更新，不引入物理引擎。
- [ ] 目标位置/自身相机使用同一关键帧函数。自身保持眼位POV，低头可看链与石；NPC旁观入水后淡切固定水下平视镜头，同帧可见完整鹅、长链、石块。两名陪同仍留岸上，不把此观察镜头说成陪同鹅的潜水。
- [ ] 重播之前 actors.reset + stage.reset，水面/泡/雾色/可见性完整复位；finished面板可返回。不能用整屏蓝色和文字替代下沉空间关系。
- [ ] 检查自身/旁观两支、跳过/重播/取消；截图 `water-self.png`、`water-self-look-down.png`、`water-npc.png`，以及开始/入水两帧。水下早中晚三个时间点写 `water-link-integrity.json`：链上下端与目标/石块锚点误差各≤0.03项目单位；结合截图通过A4/A5。

### P5：火堆两种视角、音频与舒适度

- [ ] 从PropLibrary实例化prop_firepit，再加动态火焰与灯光。同一出局接口支持 fire；两陪同鹅抬目标、前移、投到石圈内，按5秒时间线。自身 POV 与目标眼位同步，旁观能看清完整落点。
- [ ] 火焰几何/粒子≤24，不搞物理火灾；火光照到附近角色，终点遮挡淡黑。截图 `fire-self.png`、`fire-npc.png`，再补抬起/落点关键帧证明过程。
- [ ] 实现 Web Audio 的铃声、椅响、水泡/闷音、火声；每个 cue 只在阶段跨越阈值时触发一次，重播前重置触发集合。权限拒绝时流程继续。
- [ ] 静音、reduce-motion、本地偏好异常兜底；pause恢复不快进也不再响一次铃。低动态自身出局用固定 POV关键画面，确保仍有沉水/火堆结果。
- [ ] 做5轮不同类型的返回/重开，记录 scene/geometry/texture/listener/声音源数量是否持续增长。只针对增长点修复，禁止因此换整个渲染框架。

### P6：集成验收与本地交付

- [ ] 完成功能后更新候选版本（package.json和package-lock一起）；旧1.1.1发布内容不覆盖。完整运行一次下方验收命令组。
- [ ] scripts/smoke-immersion.mjs 参数约定为 `[url] [label]`，默认本地8870及immersion；输出 `reports/<label>/immersion.json`。报告含 `passed`、实际 version、当前 `reports/build.json` 原始字节 SHA256、checks/errors、截图文件列表，别生成空PASS。
- [ ] 测试从角色册真实入口开始，通过实际键盘移动到铃；可用现有导航数据计算可通行路径，再转换成WASD输入。四支在同一页连续验证，每次返回本来就在铃前，不重复走整张地图。不要提交公开 `teleport/debug` 控制入口，也不要跳过真实入口只调用director假装完整通过。
- [ ] 桌面四支 water-self/water-npc/fire-self/fire-npc 均完整返回；移动竖屏跑一条完整链，横屏核界面；已有视角与入口恢复脚本通过。
- [ ] 场景加载中退出后慢请求完成不能重新打开会议；失败一次→重试成功；预览用旧HTML去掉全部新UI节点仍可按铃、投票、返回。网络日志核新JS/CSS/JSON都在同一releases版本目录（根alias旧缓存用例单列）。
- [ ] A1–A9证据齐全后更新 progress.json 为 ready_for_user_review，写 implementation-report.md。若只有部分完成，status=partial，列出首个未通过阶段、报错、已尝试方法及下一条最小动作，不谎称完成。
- [ ] 不调用 publish/verify-remote 指向生产的新版本，不 push，不修改基础设施。交接本地预览与候选包即可。

## 4. 验证命令与证据矩阵

以下命令在项目根目录执行。npm start 单独保持终端运行；已有服务复用前先确认正在服务本次 dist。浏览器由现有脚本使用本机 Chrome，CHROME_PATH 可覆盖已安装路径。

```powershell
node scripts/test-immersion.mjs
node scripts/immersion/check_props.mjs
npm run build
npm test
npm start
```

另一个终端：

```powershell
node scripts/smoke.mjs http://127.0.0.1:8870/ immersion-base
node scripts/smoke-first-person.mjs http://127.0.0.1:8870/ immersion-first-person
node scripts/smoke-entry-recovery.mjs http://127.0.0.1:8870/ immersion-entry
node scripts/smoke-immersion.mjs http://127.0.0.1:8870/ immersion
```

| 检查组 | 断言与证据 | 不通过时处理 |
| --- | --- | --- |
| Blender与GLB | .blend真实重开、七类资产可编辑；GLB节点/pivot/尺寸及浏览器材质通过；旧资产清单只追加 | 修新道具导出或PropLibrary，不重做旧人物与地图 |
| 原有包/入口/漫游 | package PASS；27/65不变；俯视/POV/方向控制/更换角色；cached-html/map-retry/avatar-retry | 修接入点或资源定位，不升级依赖绕过 |
| 真正的圆桌POV | 当前玩家身份、7NPC围坐、角色脸、桌沿、椅脚可见；移动端未遮脸 | 调尺寸/相机/姿态，不把桌换矩形或减少NPC掩盖 |
| 状态与重复操作 | 连按铃只有1会话、重复确认1结果、失败可重试、连续5次返回原position/view | 检查代次/所有权/事件门控 |
| 出局四支 | 目标与票一致；起始、中间、终点截图显示实际落水/投火；自己视角仍是POV | 修关键帧/镜头/遮挡，不能只改文字 |
| 暂停与输入 | hidden/blur暂停；WebGL loss若环境支持模拟则核恢复；E/V/WASD/home受控；Esc与全局退出 | 缺环境的检查标未验证，保留手动操作说明 |
| 旧缓存/版本 | 旧DOM＋新脚本无null异常；新UI只创建1份；release资源版本一致；无新增外部依赖请求 | 修ensure UI和import.meta.url路径 |
| 性能与泄漏 | 记录当前设备、viewport、DPR和帧耗时；渲染单Scene；几何/材质/节点数量无逐轮增加 | 先减少粒子/重复资源与无用绘制，不擅减角色还原度 |

只在相关修改后重跑受影响检查；最终针对最终build跑一次完整命令组。不要反复追加多轮全量QC，也不要派reviewer。

## 5. 断点与偏差记录

progress.json 每个阶段记录 `status:pending|in_progress|passed|blocked`、changed_files、checks、evidence、notes；每条check含 command/result（passed/failed/not_run）及报告路径。当前没有运行结果，初始值为空数组是正常的待施工状态。

恢复时：读 progress → 看 git diff 与当前文件 → 只核最新阶段证据是否匹配当前 build/code → 从第一个未通过阶段继续。已通过且未受后续修改影响的角色/地图基线不重做。版本/资源哈希变更必须说明具体来源，不能自动套用旧基线，也不能因为HEAD不同就整个停工。

允许的局部偏差：为避免装备穿模微调椅子/镜头/光照、在现有房间内微调铃站位、按设备减少粒子。必须在 implementation-report.md 写「设计值 → 实际值 → 原因 → 验证图」。不允许静默取消坐姿、删掉自己的POV、用文字替代投出、添加地图、扩成联机或自动发布。
