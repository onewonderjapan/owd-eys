# Blender 道具资产与网页接入

修订：2026-09-14，设计1.2。用户已同意将道具制作改为 Blender＋GLB 流程，由 ZCode 执行；本文件替代早期「所有布景都用运行时几何、本轮无需Blender」限制。当前只完成计划，尚未运行资产任务。

## 使用的技能

| 工作 | 已核对的本机 skill |
| --- | --- |
| Blender资产清理、GLB导出、优化与网页验证 | [OpenAI web-3d-asset-pipeline](C:/Users/蔡瀛杰/.codex/plugins/cache/openai-curated-remote/game-studio/0.1.2/skills/web-3d-asset-pipeline/SKILL.md) |
| POV镜头、状态/渲染分离、输入与HUD | [OpenAI three-webgl-game](C:/Users/蔡瀛杰/.codex/plugins/cache/openai-curated-remote/game-studio/0.1.2/skills/three-webgl-game/SKILL.md) |
| 保留角色本体、服装身份与坐标契约 | [项目定制 blender-reference-wardrobe](C:/Users/蔡瀛杰/.codex/skills/blender-reference-wardrobe/SKILL.md) |

官方来源：[资产 skill](https://github.com/openai/plugins/blob/main/plugins/game-studio/skills/web-3d-asset-pipeline/SKILL.md)、[插件作者声明](https://github.com/openai/plugins/blob/main/plugins/game-studio/.codex-plugin/plugin.json)。Blender项目skill只借用参考还原、身份和坐标纪律，不触发新皮肤、全装备入库或公开下载流程。

ZCode按文件路径读skill即可，不需要识别Codex的插件调用语法。如果插件缓存版本更新，按相同skill名称在本机缓存中查找；先核实新版内容再记录实际路径。仅采用适用规则，继续沿用现有ES Modules/Three.js，不因为官方通用模板推荐而迁移Vite/TypeScript/Rapier或另装MCP。

## 资产范围与命名

用一个新 `.blend` 保存可编辑的七类道具，导出一个共享GLB道具包。已有鹅体、27个角色配方、65个装备和地图源文件保持原样。坐姿通过已有演员副本的pivot包装完成，可在Blender中用复制的演员作比例检查，但不把演员重新导出到道具包。

| 资产根节点名 | 内容与挂点 | 网页用途 |
| --- | --- | --- |
| `prop_bell` | 金色钟罩、钟舌、深木铃台；子节点 `bell_swing_pivot`、`bell_clapper_pivot` 位置对准实际转轴 | 法院原地图中的可操作铃；只动两个pivot |
| `prop_round_table` | 圆桌、真实桌沿厚度、桌腿、暗红细节；接地原点 | 圆桌会议视觉中心 |
| `prop_chair` | 椅面、靠背、椅腿；接地原点，局部前方朝+Z | clone八次，按8个座位朝桌心 |
| `prop_dock` | 约6×6以内的局部木栈桥，清楚的木板边缘 | 入水短过渡，不能扩成新探索地图 |
| `prop_sink_stone` | 深灰不规则石块，顶部子节点 `chain_anchor`；接地原点 | 水下长链下方的重物 |
| `prop_chain_link` | 一个低面数封闭椭圆链节，中心原点，长轴局部Y，环面在XY平面 | 提取几何/材质，Three.js实例化24–32节并更新链端 |
| `prop_firepit` | 石圈与木柴、内侧投落空间，接地原点 | 火堆出局；火焰与照明在Three.js中实时产生 |

尺寸沿用 design.md 和 water-reference.md。在Blender的Z向上源空间制作，导出后以glTF的Y向上验收；导出后的根节点局部原点与比例才是运行时依据，不能在网页额外旋转90度补偿。机械pivot保留父子关系，不能把钟罩和钟舌合并成不能动作的一块。

每个导出根节点的translation归零、scale为1，模型按自身用途设计局部坐标；原型在GLB中重叠没关系，因为运行时只抽取需要的根节点，绝不把整个原型包直接挂进场景。Blender检查用另一个不导出的展示集合，将副本排开拍图；GLB仅导出七个资产集合，不带展示灯、相机、角色副本或隐藏备份。

材质优先可导出的Principled/PBR、少量共享材质、真实倒角和必要平滑法线。确实需要纹理才在S1烘焙，单张上限1024，并嵌入GLB。透明水面、气泡、火焰、灯光、镜头与姿态时序由Three.js负责；这些动态效果可用运行时几何。不能用积木占位道具代替最终Blender资产。

## S1制作与W2归档

W2正本：`C:\3d\eys\owd-eys`。以下是本轮要创建的目录/文件约定，不代表已经生成：

- 可提交的源脚本：`scripts/immersion/build_props_blender.py`、`scripts/immersion/run_s1.py`、`scripts/immersion/import_assets.py`、`scripts/immersion/check_props.mjs`。
- W2本轮资产归档：`C:\3d\eys\immersion_assets\<run_id>\`，保存 `.blend`、原始/优化GLB、渲染图、日志和报告，原始文件不覆盖。
- S1产出目录：`~/outbox/eys-immersion/<run_id>/`；SMB收集目录：`\\172.72.0.1\Home\outbox\eys-immersion\<run_id>\`。`run_id`用实际UTC时间＋短编号生成，第一次写入progress后续接复用；不能每次重试都丢失原任务身份。
- 管理记录与施工文档只在W2维护。S1运行日志属于生成证据，可随产物带回。

已存在的参考运行器：[web_wardrobe/material_lab/run_s1.py](C:/3d/eys/web_wardrobe/material_lab/run_s1.py)。只参考其ssh/SMB及Blender环境配置：它会打开历史角色文件并使用旧日期目录，**不能原样拿来运行本轮**。新薄启动器传独立脚本、输出目录和日志，启动空场景/本轮候选文件，不打开或覆盖旧角色源。

P0A开始时只读核实 `ssh s1`、SMB、S1实际home、Blender二进制与版本。旧运行器中的 `/home/baibai/outbox/codex-3d-atelier/runtime/usr/bin/blender` 仅为候选位置，须先确认存在；不能以Windows的blender.exe替代S1执行。用参数数组和正确远端shell引用，设置 `--python-exit-code 1`。脚本应可按run_id识别既有产物和完成记录；长任务立即记录远端PID/命令、日志路径，在ZCode中断后仍能查明状态。

模型构造、Blender渲染、烘焙和批量资产优化均在S1；W2做源脚本编写、哈希核对、SMB收集、清单接入、网页构建和浏览器验收。不调用付费生成服务，也不安装额外模型/MCP作为隐含前置条件。

glTF Transform优先复用已有可用运行环境作inspect/prune/dedup，保留上述全部命名根节点及pivot；必须实测优化后没有丢失节点或移动原点。默认不启用Draco/Meshopt/KTX2，因为现有GLTFLoader没有配置这些解码器。若优化工具缺失，先检查原始GLB的大小/材质/节点；保留可加载的无压缩GLB并记录该优化项未运行，不为压缩重构运行时。Blender本身或S1连接失败时记录P0A阻塞，继续不依赖资产的状态/UI代码，不能把占位资源标为最终验收通过。

## 新资产接入契约

1. S1报告 `asset-report.json` 最后写出，含run_id、实际Blender版本、脚本hash、`.blend`及GLB的文件名/hash/bytes、7个根节点及pivot列表、导出后的边界尺寸、材质/纹理数量、各检查结果与渲染文件。候选hash不允许用计划占位字符串填充。
2. W2复制并逐文件验SHA256。`import_assets.py`必须支持 `--source <收集后的目录>`，只接受实际报告及匹配的GLB。运行之前列明新增路径；已存在同名不同hash文件报错，不覆盖。
3. GLB按真实SHA256命名为 `.cache/assets/<sha256>.glb`，向 `assets-manifest.json.assets` **仅追加** `{path:'assets/<sha256>.glb',sha256,bytes}`。旧记录的path/hash/bytes和base_url保持不变。不把七个道具塞进角色的65个装备模块。
4. 创建 `src/immersion-assets.json`，schema=1、pack_id=`eys-immersion-props-v1`、url=`assets/<实际hash>.glb`、sha256、bytes、nodes（七个命名节点的映射）。该JSON不得含私人目录、S1地址、报告路径或 `.blend` 下载地址。
5. 配置JSON通过 `new URL('immersion-assets.json',import.meta.url)`加载，GLB沿用项目根的内容哈希assets路径，以 `new URL(config.url,document.baseURI)`定位。构建脚本已能复制src树和清单资产，先复用，不另建CDN或发布路径。
6. 新GLB尚未在公网发布，`fetch-assets`不会替你从公网取到它。P0A必须把正确文件放入本地.cache；后来缓存缺失时从本轮W2归档恢复并核hash，不把404当网络故障重试。
7. `baseline.json`保留施工前快照。P0额外把初始assets-manifest拷到本轮本地报告目录，P0A/P6逐条验证旧资产记录完全保留；只允许新增本轮道具条目。不得重新生成baseline掩盖修改。

## 加载与资源所有权

新增 `src/immersion-props.js`：

```js
createPropLibrary() -> PropLibrary
// PropLibrary.ensure({onProgress}) -> Promise<void>
// PropLibrary.instantiate(nodeName) -> THREE.Object3D
// PropLibrary.chainPrototype() -> {geometry, material}
// PropLibrary.state() -> {ready, loading, error, packId}
// PropLibrary.dispose() -> void
```

首次进入漫游时加载配置和道具包：失败不阻止原有漫游，显示「会议道具加载失败／重试」，铃交互保持禁用，不能挂一个假铃并进入空会议。成功后实例化原地图铃，随后导演与舞台共享同一个库；导演start再次检查库ready。JSON/GLB任一失败须清除失败Promise，重试能继续。读到无效根节点/尺寸时走同样的可读错误路径。

库按当前map-walk实例存活，只加载一份；它拥有模板的geometry/material/texture资源。instantiate通过clone保留独立Object3D变换，共享只读资源。舞台/铃销毁只移除自己的对象，不能遍历dispose共享材质；需要改变某个实例材质时显式clone并由该实例释放。链节InstancedMesh借用库的geometry/material，清理其自身实例缓冲，不释放库的借用资源。只有当前应用/地图实例真正销毁，先移除全部借用对象后才能PropLibrary.dispose；更换角色、会议返回和重播不销毁仍被世界铃使用的库。

舞台工厂改为接收 `props`：createWorldBell({config,props})、createMeetingStage({actors,playerActorId,config,props})、createEjectionStage({actors,targetId,playerActorId,style,config,props})。库加载完成前不创建正式舞台，运行时装饰与演员仍各自拥有资源。

## P0A完成证据

- 真实可打开的 `immersion-props.blend`、可加载的GLB、最后写出的asset-report和哈希核对记录。
- Blender道具全景＋铃转轴/椅面/链石的局部渲染；在S1实际重新打开 `.blend` 验证7类资产可独立编辑。
- `node scripts/immersion/check_props.mjs` 读取实际GLB，检查节点、pivot、变换、尺寸和运行时不支持的压缩扩展；对比原清单确认只追加。
- 浏览器用真实GLTFLoader加载，截 `reports/immersion/props-browser.png`，确认与Blender渲染的比例、颜色、法线一致，不因alpha/轴向变成黑块或侧躺。
- 最终视觉仍需P2/P4/P5各自场景验收。P0A只证明道具可用，不能代替角色坐姿、按铃或实际投出的完整行为。
