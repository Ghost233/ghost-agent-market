---
name: ghost-workflow-team-sync
description: 将 GitHub 上最新的「Ghost工作流交付专家团」定义同步到本地 WorkBuddy，包括 agent 文件、团队实例、以及 my-experts 本地专家市场插件副本。当专家团更新后需要拉取最新设置或修复面板显示时使用。
---

# Ghost Workflow Team Sync

从 GitHub 仓库 `Ghost233/ghost-agent-market` 的 `main` 分支拉取最新的专家团定义，同步到本地 WorkBuddy 安装目录。

## 何时使用
- 你（或协作者）更新了专家团的 agent 定义 / 团队成员后，想把最新版本拉到本地。
- 你发现「专家」面板里看不到「Ghost工作流交付专家团」。
- 想确保本地 `~/.workbuddy/agents/` 里的 4 个成员与仓库保持一致。

## 机制说明（重要）
WorkBuddy 当前版本**不会**扫描自定义插件市场，也**不会**自动更新手动注册的 marketplace。因此「远端更新」改为：本 skill 直接从 GitHub 仓库拉取最新文件并写入本地安装目录，效果等价。

- 同步源：`https://raw.githubusercontent.com/Ghost233/ghost-agent-market/main/plugins/ghost-workflow-team/...`
- 同步目标（本地）：
  - 成员定义 → `~/.workbuddy/agents/ghost-workflow-team-*.md`
  - 团队实例元数据 → `~/.workbuddy/teams/ghost-workflow-team/config.json`
  - 本地专家市场插件副本 → `~/.workbuddy/plugins/marketplaces/my-experts/plugins/ghost-workflow-team/`
  - 本地专家市场清单 → `~/.workbuddy/plugins/marketplaces/my-experts/.codebuddy-plugin/marketplace.json`

## 关键机制：自定义 team 型专家不自动实例化（必读）

WorkBuddy 选中一个 team-type 专家时：
- **官方团队**：自动创建团队运行时实例并 spawn 成员。
- **本自定义专家团**：**只注入总监指令，不会自动建队**。

因此总监指令（`agents/ghost-workflow-team-lead.md`）里已硬编码 **Phase 0 第 0 步 = 先 `TeamCreate` 实例化团队，再 `Agent` spawn 三成员**。这套逻辑已作为指令内容固化在仓库真源里，由本 skill 一并同步到本地副本，所以「选中 + 发任务」即可自动跑起团队，无需手动提示。

> 若你只把专家包放进 `my-experts/plugins/` 但没同步总监指令，就会出现「指令注入了、团队却没启动」的现象——务必保证本地两份总监指令副本（my-experts 与全局 agents）与仓库一致。

## 副本一致性（维护铁律）

总监指令与成员定义存在 **3 份**，必须一致，否则会出现「本地能跑、重启后坏掉」：

| 位置 | 作用 | 维护方 |
|------|------|--------|
| `plugins/ghost-workflow-team/`（**仓库真源**） | git 版本化；本 skill 拉取的来源 | 你改这里 |
| `~/.workbuddy/plugins/marketplaces/my-experts/plugins/ghost-workflow-team/agents/` | 面板实际加载 | 本 skill 同步 |
| `~/.workbuddy/agents/ghost-workflow-team-*.md` | 成员 spawn 时按 agentType 解析 | 本 skill 同步 |

**切勿手动改本地副本**（会被下次 sync 覆盖）；改动只在仓库真源进行。同步时若本地与仓库字节一致则 `[skip]`，不会无谓刷新。

## 安全特性
- 每个被覆盖的文件先备份到 `~/.workbuddy/.../.gwf-backup/<时间戳>/`（agents、teams、plugin、marketplace 均有独立备份）。
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
2. 查看输出：每个目标显示 `[skip]`（未变）或 `[sync]`（已更新并备份）。
3. 若 agent 文件或 plugin 文件有更新，**彻底退出并重启 WorkBuddy** 让新定义生效；仅团队元数据变化时通常无需重启（重启亦无害）。

## 回滚
若同步后异常，从对应 `.gwf-backup/<时间戳>/` 目录把文件复制回原位置即可。
