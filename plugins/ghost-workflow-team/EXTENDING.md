# 如何扩展：新增一个项目 owner

本包核心 4 角色稳定不变；领域能力通过**项目本地 agent** 扩展，互不污染、随项目 git 维护。

## 步骤

1. 在你的项目根创建 / 编辑 `<项目>/.workbuddy/agents/<项目>-<role>.md`。
   例：`myapp/.workbuddy/agents/myapp-payment-owner.md`
2. 文件 frontmatter 至少包含：

   ```yaml
   ---
   name: myapp-payment-owner
   description: 负责支付领域相关决策与产出
   displayName:
     en: "Payment Owner"
     zh: "支付负责人"
   profession:
     en: "Payment Owner"
     zh: "支付负责人"
   maxTurns: 120
   ---
   ```

   正文写清该 owner 的工作范围、输入、工作流与不应做。
3. 提交到项目 git（本仓库 `.gitignore` 未排除 `.workbuddy/agents/`，默认会被跟踪；若你的环境有全局忽略，请相应放行）。
4. 启动专家团后，总监在调度时**按 `name`（即 agent id）直接调度**该 owner，如同调度固定成员。

## 晋升为通用核心

若某 owner 证明在各项目都通用：

1. 复制其 `.md` 进本包 `agents/`，重命名保持 id 唯一。
2. 在 `.codebuddy-plugin/plugin.json` 的 `agents[]`、`teamInfo.memberAgents`、`members[]` 注册。
3. bump `VERSION`，提交并推送 `main`（包文件改动即触发 GitHub Action，见 README「远端更新」），
   Action 自动重建 zip 并覆盖 `latest` Release；WorkBuddy 刷新即生效。

## 约定

- 项目 owner 文件名带项目 slug 前缀，避免跨项目在用户级 `~/.workbuddy/agents/` 撞名。
- 总监采用"约定法"调度：领域命中即调度，不需额外清单文件。
- **副本一致性**：总监指令 / 成员定义存在 3 份（仓库真源、my-experts 本地副本、全局 agents 副本）。改动 **只** 在仓库 `plugins/ghost-workflow-team/` 进行，其余两份由 `ghost-workflow-team-sync` skill 从仓库同步，切勿手动改本地副本（会被下次 sync 覆盖）。
- **运行缺口**：本自定义 team 型专家被选中时只注入总监指令、不会自动建队。团队实例化逻辑（Phase 0 第 0 步 `TeamCreate` + spawn 三成员）已写进总监指令，无需每次手动加。若需调整实例化行为，改仓库 `agents/ghost-workflow-team-lead.md` 即可。
