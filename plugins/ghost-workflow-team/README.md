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

当前 `1.0.0`。改核心角色内容时 bump `VERSION` 并重新注册专家包。
