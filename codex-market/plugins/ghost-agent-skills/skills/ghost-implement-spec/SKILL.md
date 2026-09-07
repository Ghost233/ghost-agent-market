---
name: ghost-implement-spec
description: "使用 Matt Pocock 的 implement-spec 工作流实施一份带关联工单的规格，并强制全部子代理使用 gpt-5.6-terra/xhigh。仅在用户明确调用时使用。"
---

# Ghost Implement Spec

这是 Matt Pocock `implement-spec` 的薄包装，不复制或改写其工作流。

1. 从当前可用 skill 中定位 frontmatter `name` **恰好为** `implement-spec` 的唯一 `SKILL.md`，完整读取后遵循它。目标应来自 `mattpocock-skills-zh`；找不到或存在多个候选时，在修改仓库前停止并报告。
2. 保留目标 skill 的步骤、frontier 调度、分支/PR、审查与清理规则，只覆盖子代理创建参数。
3. 本工作流直接或通过 `$code-review` 创建的**每个**子代理都必须调用 `collaboration.spawn_agent` 并使用：
   - `agent_type: "worker"`
   - `model: "gpt-5.6-terra"`
   - `reasoning_effort: "xhigh"`
   - `fork_turns: "none"`
4. 这包括 exploration、implementer、merger、review，以及修复审查问题的子代理。给每个子代理传最小的职责与上下文指针，不复制父线程历史。
5. 如果宿主不能为子代理同时指定上述四项，在修改仓库前停止并报告；不得静默降级模型、推理强度或隔离方式。
