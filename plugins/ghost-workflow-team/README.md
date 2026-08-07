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
