# 仅为硬依赖添加明确的 `/setup-matt-pocock-skills` 指针

工程类 skills 依赖各仓库的配置，包括 issue tracker、triage 标签词汇和领域文档布局。这些配置由 `/setup-matt-pocock-skills` 初始化。有些 skill 缺少配置就无法正常工作，因为它们必须发布到指定的 issue tracker，或应用指定的标签字符串。另一些 skill 只用配置来提高输出精度，例如统一词汇、了解 ADR；缺少配置时仍能工作。

我们将它们分为**硬依赖**和**软依赖** skills：

- **硬依赖**（`to-tickets`、`to-spec`、`triage`）：加上一句明确说明：_“……应已提供给你；如果没有，请运行 `/setup-matt-pocock-skills`。”_ 缺少映射会让输出出错，而不只是含糊。
- **软依赖**（`diagnose`、`tdd`、`improve-codebase-architecture`）：仅在普通说明中宽泛地提及“项目的领域术语表”和“你正在修改的区域中的 ADR”。即使没有这些文档，skill 仍可工作，只是输出不够准确。

这样能减少软依赖 skills 的 token 开销，也避免在并不需要初始化的地方照搬 setup 指针。
