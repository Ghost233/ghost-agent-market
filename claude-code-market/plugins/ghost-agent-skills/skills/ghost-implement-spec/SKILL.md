---
name: ghost-implement-spec
description: "使用 Matt Pocock 的工单调度，通过本地 worktree 实施一份带关联工单的规格（不使用 PR），并强制全部子代理使用 Sonnet。仅在用户明确调用时使用。"
disable-model-invocation: true
---

# Ghost Implement Spec

这是 Matt Pocock `implement-spec` 的本地 worktree 包装，保留工单调度，覆盖 PR 交付方式和子代理配置。

1. 从当前可用 skill 中定位 frontmatter `name` **恰好为** `implement-spec` 的唯一 `SKILL.md`，完整读取后遵循它。目标应来自 `mattpocock-skills-zh`；找不到或存在多个候选时，在修改仓库前停止并报告。
2. 完整读取 [本地 worktree 交付规则](references/worktree-workflow.md)，以它覆盖目标 skill 的 PR、集成、交付与清理步骤：不创建、更新或合并 PR。其余任务图、frontier 调度与审查流程保持一致。
3. 本工作流直接或通过 `/code-review` 创建的**每个**子代理都必须在 Agent 调用中指定 `model: "sonnet"`。
4. 这包括 exploration、implementer、merger、review，以及修复审查问题的子代理。给每个子代理传最小的职责与上下文指针，不复制父线程历史。
5. 如果宿主不能为子代理指定 Sonnet，在修改仓库前停止并报告；不得静默降级或改用其他模型。
