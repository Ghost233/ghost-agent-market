# 运行时与 Compose

## 本机与服务器

- 本机采用 Apple container + Orchard + `andrew-waters/compose`；使用官方预编译发行版或 Homebrew 官方二进制包。升级不再受旧 Socktainer 兼容版本限制。
- 原生运行时数据保存在 `/Users/ghost233/Library/Application Support/com.apple.container`。保留现有数据目录、镜像、卷及数据库文件。
- 本机服务状态用 `container system status` 检查；确认未运行后用 `container system start` 启动，再验证 CLI 和服务版本一致。不要把启动系统服务视为应用容器已启动。
- 本机没有 Docker 兼容 socket。保留的 Docker CLI 用于真实服务器/远程 Docker，不代表本机有 Docker Engine；按项目要求选择远程上下文，不能全局设置指向已卸载兼容层的 `DOCKER_HOST`。

## 项目入口与迁移检查

对照实际 CLI、API 服务版本与脚本调用，检查项目说明是否仍引用旧 Socktainer、Docker socket 或兼容层专用通道。按用户已选原生运行时修正所需入口和对应说明，保留服务器 Docker 配置。

迁移或升级后，使用项目既有正式入口完成最小检查。覆盖本次需要的源码注入、依赖访问、命令执行、结果取回和服务连接。单独运行一个原生命令，不能证明项目入口已经适配。

完成标准：所需入口在当前运行时实际成功，日志和退出结果可核对，原有数据与需要恢复的服务已验证。后续作业复用有效检查；运行时、入口或相关网络变化后，补验受影响通道。

## Compose

插件来源：[andrew-waters/compose](https://github.com/andrew-waters/compose)。Orchard 内置 Swift 包，终端插件独立安装，两者的版本应分别核对。Apple container 升级后检查插件是否仍可用，缺失时通过 Orchard 或该项目正式发行包恢复。

- 先查看实际 `container compose up --help`，用 `container compose up -f <本机配置> --dry-run` 检查兼容性及计划，再执行 `up`。CLI 0.4.0 只提供 `up`、`down`；其余操作用原生 `container list/logs/exec/stop/start`。
- 本机持久化使用明确指定的宿主机目录绑定挂载，Compose 写在服务的 `volumes:` 中，不创建新的命名卷。已有命名卷的数据仍须保留；迁到目录前先备份并核对数据。
- 本机测试不要求 Docker 的 `restart:` 策略，不为此添加监控守护进程；服务器配置保留其真实 Docker 行为。CLI 0.4.0 会拒绝不能兑现的字段，不能只保留服务器的 `restart:` 然后假定本机忽略。
- 采用项目现有的本机/服务器配置组织方式。CLI 0.4.0 不提供多份 `-f` 合并。需要时生成一份可独立运行的本机配置，不要将限制扩展到服务器。
- 按依赖顺序启动不等于依赖已就绪。应用有连接重试时可接受该限制；应用启动失败就退出时，通过实际启动验证定位问题。
- 服务访问使用实际 IP 或 Apple 原生 DNS。插件 0.4.0 的主机名为 `<project>-<service>`，不假设 Docker Compose 的短服务名及网络别名有效。容器重建后重新核对地址与解析。
- 插件 0.4.0 支持绑定挂载，尚不支持命名卷、`healthcheck`、带条件的 `depends_on`、`entrypoint`、多网络挂载等。每次针对实际项目配置检查，后续插件升级以新的文档和实测结果为准。

## 升级与恢复

升级前记录运行中的容器、镜像引用、网络、挂载和需要恢复的服务，备份配置及插件；安排停机后再替换运行时。升级后验证版本、原有数据可见性、原生命令和服务探活。构建器按需恢复，不能把临时测试容器误当成常驻服务。

旧 Socktainer 的 Docker attach、exec、cp、healthcheck、DNS、rename 与 Buildx 缺陷属于历史兼容层证据，不作为新版原生命令的限制。遇到问题先检查原生服务状态与日志，定位当前版本的实际失败。

额外宿主机挂载、系统 DNS/路由/防火墙修改、运行时存储迁移及第三方远程构建仍按当前任务的授权范围执行。
