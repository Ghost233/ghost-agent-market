# Ghost Home Repo for DSH

Home Repo 跨仓库协作 skill，用于管理多个仓库的 feature 开发，协调子代理并行工作。

## 什么是 Home Repo

Home Repo 是一个统一的 git 仓库，用于：
- 存放跨仓库的规范和文档
- 协调跨仓库 feature 的开发
- 作为 agent team 的启动点

## 包含的 Skills

- **home-repo-init**：初始化当前目录为 Home Repo
- **home-repo-coordinate**：协调跨仓库 feature 的开发

## 安装

```bash
npm pack ./dsh-market/ghost-home-repo --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-ghost-home-repo-0.1.0.tgz
```

## 使用

### 初始化 Home Repo

在你想要作为 Home Repo 的目录里：

```
使用 home-repo-init skill
```

### 协调跨仓库 Feature

在 Home Repo 里：

```
使用 home-repo-coordinate skill
```

## 核心概念

### Lead Agent 协调模式

- Lead agent 在 Home Repo 里运行，负责协调
- 每个子代理只负责一个仓库的一个 issue
- 子代理之间不直接通信，所有跨仓库协调通过 lead agent
- 子代理的 prompt 里预先提供所有需要的上下文

### Worktree 隔离

- 每个 feature 在独立的 worktree 里开发
- 子代理只在自己的 worktree 里工作
- 通过 prompt 约定和上下文预提供，避免子代理跑偏

## 文档

- [Home Repo Pattern](https://www.aihero.dev/the-home-repo-pattern)
- [DSH Bundle 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

## 许可

MIT
