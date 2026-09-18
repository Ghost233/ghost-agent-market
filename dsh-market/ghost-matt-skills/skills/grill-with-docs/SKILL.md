---
name: grill-with-docs
description: 通过持续追问打磨计划或设计，并在过程中同步创建 ADR 和术语表。仅在用户明确调用时使用。
disable-model-invocation: true
---

> **DSH 平台适配：** 保留仓库中文原版流程；技能名表示当前 DSH 技能目录中的同名项，用户通过界面的技能选择器显式调用，模型仅在该项允许模型调用时使用 `skill({ name })`。手动调用策略保持不变。子代理使用当前 DSH 实际提供的委派工具及其参数，继承宿主已配置的模型；不要求 Codex/Claude 工具或硬编码模型，不自动更换 provider。若必须的委派能力不可用，说明具体限制，不伪造执行。

调用 Skill 工具两次，分别传入 `grilling` 和 `domain-modeling`。
