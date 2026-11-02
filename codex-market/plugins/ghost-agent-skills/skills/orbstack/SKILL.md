---
name: orbstack
description: 在本机使用 OrbStack 提供的 Docker 兼容引擎及标准 Docker Compose 运行、构建和诊断容器。服务器沿用项目 Docker 配置。讨论或编辑本 skill 不启动容器作业。
---

# OrbStack / Docker 容器操作

本机使用 OrbStack 提供的 Docker 兼容引擎，通过标准 `docker` CLI、Docker API 和 `docker compose` 操作。服务器沿用项目指定的 Docker 端点和 Compose 配置。面向用户使用中文，用户另有要求时除外。

本 skill 负责运行时操作与环境验收。依赖准备、编译、测试和交付遵循 `container-dev-workflow` skill 及项目检查入口。

## 操作入口

1. 操作前读取 [运行时与 Compose](references/runtime.md)，确认当前连接目标和 Docker 服务能力；本机目标为 OrbStack，远程任务使用项目指定端点。
2. 构建、依赖安装、测试及文件传输前读取 [执行与验收](references/runbook.md)。镜像归档、Registry 或磁盘回收前读取 [镜像与数据](references/images-registry.md)。
3. 项目容器维护 Compose 文件及配套环境配置以固定运行参数，执行前用 `docker compose config` 核验，实际运行参数与配置保持一致。
4. 验收保留真实退出码、日志、服务探活及所需产物。迁移和升级还须对账原有容器、镜像、挂载与卷，验证项目正式入口和需要恢复的服务；同步过时的项目说明。

讨论或编辑本 skill 不启动容器、切换引擎或清理资源。
