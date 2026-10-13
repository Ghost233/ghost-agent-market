# Matt Pocock Skills

一组由 Claude Code 加载的代理 skills（斜杠命令与行为）。Skills 按类别组织，由 `/setup-matt-pocock-skills` 生成的仓库配置使用。

## 术语

**Issue tracker（问题跟踪器）**：
承载仓库 issues 的工具，例如 GitHub Issues、Linear、本地 `.scratch/` Markdown 约定等。`to-tickets`、`to-spec` 和 `triage` 等 skills 会读取并写入它。
_避免使用_：backlog manager、backlog backend、issue host。

**Issue（问题）**：
**问题跟踪器**中一个独立的工作单元，可以是缺陷、任务、spec，或 `to-tickets` 产出的切片。
_避免使用_：ticket。只有引用把它称为 ticket 的外部系统，或指下面的**决策工单**时才使用。

**Decision ticket（决策工单）**：
`wayfinder` 的工作单元，是 `wayfinder:map` 的子 **Issue**。它承载一个*问题*，解决结果是决策，而非待执行的实现切片。**决策**这个限定词使它与实现工单区分开来。`wayfinder` 先引入完整术语，之后简称为“工单”。

**Triage role（分诊角色）**：
分诊时给 **Issue** 添加的标准状态机标签，例如 `needs-triage`、`ready-for-afk`。每个角色通过 `docs/agents/triage-labels.md` 映射到**问题跟踪器**中的实际标签字符串。

## 关系

- 一个**问题跟踪器**承载多个 **Issues**。
- 一个 **Issue** 同一时间只带一个**分诊角色**。
- 一个**决策工单**是一个 **Issue**，也是 `wayfinder:map` 的子问题。

## 已标记的歧义

- 过去“backlog”同时指承载 issues 的*工具*和其中的*工作集合*。已解决：工具称为**问题跟踪器**；“backlog”不再用作领域术语。
- “backlog backend”与“backlog manager”。已解决：统一为**问题跟踪器**。
