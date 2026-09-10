# 鹅教堂漫游

《鹅鸭杀》（Goose Goose Duck）非官方二次创作，仅用于技术验证与娱乐，不用于商业用途；与原作官方无关联，原作相关权利归其权利人所有。

公开入口：https://eys.onewonder.co.jp/

先从 27 位角色中选择同行者，再进入鹅教堂小镇。WASD／方向键移动，E 查看位置，V 或「视角」按钮切换俯视／第一人称。第一人称按住画面拖动环顾，电脑也可点击画面锁定鼠标、Esc 释放；手机可同时用方向键移动与拖动画面转头。「更换角色」返回角色册。当前为单人场景探索，不包含原作完整规则或联机玩法。

## 本地开发

```sh
npm ci
npm run fetch-assets
npm run build
npm test
npm start
```

预览地址：http://127.0.0.1:8870/ 。首次上线前由原始工作区填充 `.cache/assets/`；正式上线后 fetch-assets 从已发布站点下载并核对 SHA256。

代码在组织私有 GitHub 仓库协作；GLB 和头像在 S3，不进入 Git。每个运行资产的哈希与大小见 `assets-manifest.json`。原始 Blender 与制作档案保留在本地项目，公开包不含源文件下载入口。

地图几何来自已交付 map_reference_v2，角色来自衣橱 4.3.28。粉花绿鹅使用加厚、圆润的五瓣花环，保留原有轮廓与脸部开口。角色装配、碰撞、视角和渲染按模块分离，生成计算仍在 S1。运行、发布资料见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

基础设施沿用 pet.onewonder.co.jp 的私有 S3＋CloudFront OAC＋HTTPS＋Route 53 Alias A 模式；EYS 使用独立 bucket 与分发。部署不删除历史资源或文件。
