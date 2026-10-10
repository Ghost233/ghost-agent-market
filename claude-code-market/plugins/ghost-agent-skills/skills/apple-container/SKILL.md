---
name: apple-container
description: 在这台 Mac 上使用 Orchard、Apple container 和 andrew-waters/compose 运行、构建及诊断本机容器。用于明确选择本机原生容器工作流的任务；服务器 Docker 工作流遵循服务器和项目约定。
---

# 本机 Apple container / Orchard

本机使用 Apple container 原生运行时、Orchard 图形界面及 `andrew-waters/compose` 插件。服务器继续使用真实 Docker / Docker Compose。本机运行方式仅适用于用户或项目已选择容器执行的任务。

本 skill 负责运行时操作与环境验收。依赖准备、公共契约和最终门禁的执行顺序遵循项目开发流程。讨论或编辑本 skill 不启动容器作业。

## 操作入口

1. 操作前读取 [运行时与 Compose](references/runtime.md)。检查 `container --version` 和 `container system status`；使用 Compose 时再检查 `container compose --version`。以实际 CLI 与 API 服务版本为准。
2. 本机容器、镜像、网络、日志、执行及复制使用原生 `container`；编排使用 `container compose` 或 Orchard。服务器与远程 Docker 上下文继续使用标准 `docker`。
3. 构建、依赖安装、测试及文件传输前读取 [执行与验收](references/runbook.md)。镜像归档、Registry 或磁盘回收前读取 [镜像与数据](references/images-registry.md)。
4. 验收必须有真实退出码、服务探活及所需产物的证据。迁移和升级还须对账原有容器、镜像、挂载与卷，并验证项目正式入口和需要恢复的服务。旧项目说明与当前运行时不符时，按用户已选运行时适配所需入口，并同步对应说明。

Socktainer 已退出本机工作流。遇到 Docker socket/API 依赖时，明确指出需要项目适配或用户授权的远程 Docker 端点；不能把原生 Compose 当成 Docker API 兼容层，不能自行重新安装旧兼容层。
