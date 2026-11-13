---
name: home-repo-init
description: 初始化当前目录为 Home Repo，创建 AGENTS.md、scripts/ 和 templates/。
---

# Home Repo 初始化

这个 skill 把当前目录初始化为一个 Home Repo，用于跨仓库协作。

## 什么是 Home Repo

Home Repo 是一个统一的 git 仓库，用于：
- 存放跨仓库的规范和文档
- 协调跨仓库 feature 的开发
- 作为 agent team 的启动点

## 初始化流程

### 1. 检查当前目录

确认当前目录是你想要作为 Home Repo 的目录。

### 2. 初始化 git 仓库

如果当前目录还不是 git 仓库：

```bash
git init
```

### 3. 创建目录结构

```bash
mkdir -p scripts templates docs/standards
```

### 4. 创建 AGENTS.md

从模板创建 AGENTS.md，填写你的仓库地图。

### 5. 创建 .gitignore

创建 .gitignore，忽略子仓库和构建产物。

### 6. 创建辅助脚本

创建 scripts/create-worktree.sh，用于创建 worktree。

## 下一步

初始化完成后，使用 `home-repo-coordinate` skill 协调跨仓库 feature。
