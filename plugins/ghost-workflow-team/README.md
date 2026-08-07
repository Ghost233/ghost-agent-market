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

## 远端更新（Release 自动构建）

包源码在仓库 `plugins/ghost-workflow-team/`，由 `.codebuddy-plugin/marketplace.json` 构成 WorkBuddy marketplace。
发版走 **GitHub Actions**（`.github/workflows/build-marketplace-zip.yml`），不再手动 `gh release create`：

1. 改包内容 / `VERSION`。
2. `git commit -am "..." && git push`
3. `git tag workflow-marketplace-v1.0.1 && git push origin workflow-marketplace-v1.0.1`
   → Action 自动构建 `ghost-workflow-marketplace.zip` 并发布 Release（资产名固定）。

WorkBuddy 侧注册的是 `releases/latest/download/ghost-workflow-marketplace.zip`（`autoUpdate:true`），
因此推新 tag 发版后，所有装了该市场的环境刷新即拉取最新版。
