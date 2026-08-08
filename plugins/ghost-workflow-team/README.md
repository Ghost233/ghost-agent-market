# GhostWorkflowTeam（Ghost工作流交付专家团）

一个**稳定、精简、可扩展**的交付专家包。

## 核心角色（固定，随包分发）

- **总监（lead）**：编排、阶段门、调度。
- **监工**：进度 / 质量监控。
- **开发**：执行产出。
- **审查**：质量门、验收。

## 扩展模型（方案 A）

专家包**只能全局存放**（`~/.workbuddy/plugins/marketplaces/my-experts/plugins/GhostWorkflowTeam/`），不能项目本地化。per-project 的领域 owner 不进包，而是放在**项目本地** `<项目>/.workbuddy/agents/`，随项目 git 版本化，总监按需按 id 调度。详见 `EXTENDING.md`。

## 版本

当前 `1.0.0`。改核心角色内容时 bump `VERSION`。

## 运行与触发（关键机制，必读）

本专家团是**自定义 team-type 专家**，与官方团队有一个必须了解的缺口：

- **官方团队**：被选中时 WorkBuddy 会自动创建团队运行时实例并 spawn 成员。
- **本自定义专家团**：被选中时 WorkBuddy **只会注入本总监指令，不会自动创建团队实例**。

因此「总监指令」（`agents/ghost-workflow-team-lead.md`）里已硬编码 **Phase 0 第 0 步 = 必须先 `TeamCreate` 实例化团队，再 `Agent` spawn 三名固定成员**。这套逻辑已写进指令文件，下次你「选中专家团 + 发任务」时会自动触发，无需手动提示。

> 实测：`TeamCreate` 生成的 `config.json` 结构与官方 `aicoding-arch-team/config.json` **逐字段一致**（`leadAgentId` / `leadSessionId` / `members[]` / `inboxes/`），是有效团队实例，可正常协作。

### 副本一致性（维护铁律）

总监指令与成员定义必须保持 **3 份完全一致**，否则会出现「本地能跑、重启后坏掉」：

| 位置 | 作用 | 由谁维护 |
|------|------|---------|
| `plugins/ghost-workflow-team/agents/` **（仓库真源）** | git 版本化、sync 拉取的来源 | 你改这里 |
| `~/.workbuddy/plugins/marketplaces/my-experts/plugins/ghost-workflow-team/agents/` | 面板实际加载的本地副本 | `ghost-workflow-team-sync` 从仓库同步 |
| `~/.workbuddy/agents/ghost-workflow-team-*.md` | 成员 spawn 时按 agentType 解析 | `ghost-workflow-team-sync` 从仓库同步 |

**正确位置只有 `my-experts/plugins/`**（自定义专家目录）；`experts/plugins/` 是内置/云端市场缓存区，放自定义专家会被判定「不在专家目录下，将无法被检测到」，请勿使用。

## 远端更新（Release 自动构建 + 单一 latest）

包源码在仓库 `plugins/ghost-workflow-team/`，由 `.codebuddy-plugin/marketplace.json` 构成 WorkBuddy marketplace。
发版走 **GitHub Actions**（`.github/workflows/build-marketplace-zip.yml`）：

- 触发：推送到 `main` 且包相关文件（`plugins/ghost-workflow-team/**`、`.codebuddy-plugin/**`、构建脚本）有改动；或手动 `workflow_dispatch`。
- 行为：始终维护【单一】rolling release（tag = `latest`），每次覆盖旧资产并删除上一版 release，**不在 GitHub 上堆积多个 release**，避免存储告警。也可手动在 Actions 页 Run workflow。

更新步骤：
1. 改包内容 / `VERSION`。
2. `git commit -am "..." && git push`
   → Action 自动构建 `ghost-workflow-marketplace.zip` 并覆盖 `latest` Release（资产名固定）。

WorkBuddy 侧注册的是 `releases/latest/download/ghost-workflow-marketplace.zip`（`autoUpdate:true`），
因此推新改动发版后，所有装了该市场的环境刷新即拉取最新版。首次手动发的旧 `workflow-marketplace-v1.0.0` release
可手动删除以保持"只保留一个 release"。
