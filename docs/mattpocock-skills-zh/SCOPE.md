# 范围

这个仓库包含我每天使用的 skills。内容经过筛选：欢迎想法，每个想法都按下面的标准判断。Issues 用来跟踪 skills 的变更。问题与讨论请放到 [GitHub Discussions](https://github.com/mattpocock/skills/discussions)。

## 接纳标准

想法或反馈 issue 只有**同时**满足两项标准，才会保持打开：

1. **实际观察到的失败。** 描述真实会话中发生的问题：运行了什么、skill 做了什么、你预期什么。假设性的改进（“如果……会更好”）不满足这一项。
2. **符合理念。** 不属于 [`.out-of-scope/`](./.out-of-scope/) 中的内容或过去的拒绝项，也不是配置选项、特定代理运行环境的分支，或只适合某个人工作流的调整。这些内容应放进你自己的 `CLAUDE.md` / `AGENTS.md`，或 fork 中（skills.sh 提供可编辑副本）。

改动大小不影响判断：修改一个词和重写全文适用同样的标准。表情回应和“+1”评论不计入标准。

## 按类别区分

- **`engineering/`、`productivity/`、`in-progress/`**：适用上述标准。
- **`misc/`**：已经冻结，不再维护。所有 issues 都会关闭。参见 [`frozen-misc-skills.md`](./.out-of-scope/frozen-misc-skills.md)。
- **新 skills**：不接纳提案与贡献。如果现有 skills 可以组合出该行为，就不新增 skill。参见 [`new-skills.md`](./.out-of-scope/new-skills.md)。

## 已作出的决定

[`.out-of-scope/`](./.out-of-scope/) 中每个文件记录一个被拒绝的概念和原因。提交 issue 前先阅读：

- [`frozen-misc-skills.md`](./.out-of-scope/frozen-misc-skills.md)
- [`harness-name-collisions.md`](./.out-of-scope/harness-name-collisions.md)
- [`mainstream-issue-trackers-only.md`](./.out-of-scope/mainstream-issue-trackers-only.md)
- [`native-question-tool.md`](./.out-of-scope/native-question-tool.md)
- [`new-skills.md`](./.out-of-scope/new-skills.md)
- [`question-limits.md`](./.out-of-scope/question-limits.md)
- [`setup-skill-verify-mode.md`](./.out-of-scope/setup-skill-verify-mode.md)
- [`subagent-recursion.md`](./.out-of-scope/subagent-recursion.md)

## 不明确的 issues

无法按标准判断的 issue 会获得一轮追问和 `needs-info` 标签。报告者 14 天内不回复，就关闭 issue。拒绝项以“not planned”关闭。
