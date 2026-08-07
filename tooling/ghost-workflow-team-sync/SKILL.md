---
name: ghost-workflow-team-sync
description: 将 GitHub 上最新的「Ghost工作流交付专家团」成员定义与团队配置同步到本地 WorkBuddy（~/.workbuddy/agents 与 teams/ 实例）。当专家团更新后需要拉取最新设置时使用。
---

# Ghost Workflow Team Sync

从 GitHub 仓库 `Ghost233/ghost-agent-market` 的 `main` 分支拉取最新的专家团定义，同步到本地 WorkBuddy 安装目录。

## 何时使用
- 你（或协作者）更新了专家团的 agent 定义 / 团队成员后，想把最新版本拉到本地。
- 想确保本地 `~/.workbuddy/agents/` 里的 4 个成员与仓库保持一致。

## 机制说明（重要）
WorkBuddy 当前版本**不会**扫描自定义插件市场，也**不会**自动更新手动注册的 marketplace。因此「远端更新」改为：本 skill 直接从 GitHub 仓库拉取最新文件并写入本地安装目录，效果等价。

- 同步源：`https://raw.githubusercontent.com/Ghost233/ghost-agent-market/main/plugins/ghost-workflow-team/...`
- 同步目标（本地）：
  - 成员定义 → `~/.workbuddy/agents/ghost-workflow-team-*.md`
  - 团队实例元数据 → `~/.workbuddy/teams/ghost-workflow-team/config.json`

## 安全特性
- 每个被覆盖的文件先备份到 `~/.workbuddy/agents/.gwf-backup/<时间戳>/` 或 `~/.workbuddy/teams/.gwf-backup/<时间戳>/`。
- 团队实例的运行时字段（`leadSessionId`、`createdAt`、各成员 `joinedAt`/`tmuxPaneId`/`backendType`/`subscriptions`/`color`/`planModeRequired`）**全部保留**，只刷新 `description` 与成员列表。
- 若本地团队实例不存在，脚本只警告、不创建（避免生成无有效会话的坏实例）；请用 WorkBuddy 原生团队入口创建后再运行同步。

## 使用步骤
1. 运行同步脚本（默认从 `main` 分支拉取）：
   ```bash
   python3 ~/.workbuddy/skills/ghost-workflow-team-sync/sync.py
   ```
   如需显式指定分支 / 标签：
   ```bash
   GWF_BRANCH=main python3 ~/.workbuddy/skills/ghost-workflow-team-sync/sync.py
   ```
2. 查看输出：每个成员显示 `[skip]`（未变）或 `[sync]`（已更新并备份）。
3. 若 agent 文件有更新，**彻底退出并重启 WorkBuddy** 让新定义生效；仅团队元数据变化时通常无需重启（重启亦无害）。

## 回滚
若同步后异常，从对应 `.gwf-backup/<时间戳>/` 目录把文件复制回原位置即可。
