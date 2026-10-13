> **已归档。** 本 skill 在 v1.3.0 从插件移除，不再维护。没有替代 skill：代理无需专用 skill 处理 merge 或 rebase 冲突。本页保留供参考。

## 它的作用

`resolving-merge-conflicts` 逐差异块处理进行中的 Git merge 或 rebase，再运行项目检查，以提交完成操作。

它拒绝把冲突视为文字问题。修改前追溯两边的**[一手来源](https://www.aihero.dev/ai-coding-dictionary/primary-source)**（提交消息、PR、原始 issue），因此是在两个意图之间选择，而非两块文本。兼容时保留双方；不兼容时选择符合合并目标的一方，说明权衡。不发明新行为掩盖冲突，也绝不用 `--abort`。始终把合并推进到完成提交。

## 何时使用

输入 `/resolving-merge-conflicts`，或任务适合时[代理](https://www.aihero.dev/ai-coding-dictionary/agent)自动使用。

Git 已停在无法自动解决的冲突时使用。只处理眼前冲突，不管两侧其他内容：

| 你的情况 | skill |
| --- | --- |
| merge 或 rebase 中，树里有冲突标记 | 本 skill |
| 合并完成，但行为异常、原因未知 | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |
| 规划怎样切分工作以减少分支冲突 | 两者都不是，见下面并行问题 |

## 一手来源优先于 `ours` 与 `theirs`

目的在于阻止靠标志解决：`--ours`、`--theirs`，或手删看似不重要的块，让标记消失、构建通过。这种解法语法可完美，却悄悄丢掉他人有意做的变更。

未读意图就无法保留。因此先研究历史（提交、PR、[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)），再看差异。检查同理：找到仓库自己的[自动检查](https://www.aihero.dev/ai-coding-dictionary/automated-check)，提交前执行，因为合并最容易产生看似兼顾双方、却双方测试都不通过的代码。

## 常见问题

**Claude Code 自己已能解决冲突，为何需要 skill？**

增值是“找一手来源”“运行反馈循环”，否则每次要手动提示。未提示的代理通常仅凭差异给合理方案就停。skill 不允许跳过理解双方原因与之后检查。相比好[模型](https://www.aihero.dev/ai-coding-dictionary/model)只是小提升，这是有意的。至少一位读者预计模型改善后它会完全成为无效操作。

**应避免并行代理碰同一文件吗？**

通常不用。按文件分区成本比收益大，因为代理解决合并冲突的能力使权衡没那么严峻。值得保留的纪律是先做大重构。十个分支已分出后再落地大重命名仍昂贵。

并行 worktrees 的报告提供一个例外：兄弟[会话](https://www.aihero.dev/ai-coding-dictionary/session)各自构建工单后，最好让作者会话合回，因为最懂意图。最后由一名代理解决所有人冲突，会丢失[上下文](https://www.aihero.dev/ai-coding-dictionary/context)，本 skill 第 2 步又得重建。

**为何绝不 `--abort`？**

中止丢弃解决工作，下次尝试仍面对原冲突。skill 针对合并确定要发生的情况。不该合并的决策要在调用前做，而非循环里的分支。

## 正常工作的表现

- 解决时引用提交消息、PR 或 issue，而不只差异块。
- 每块保留双方行为，或明确记录舍弃什么、为何。
- 结果没有原本两边都不存在的内容。
- 提交*之前*找到并通过类型、测试、格式检查，而不是发现损坏后才跑。
- 最后树干净、操作完成，包括多提交 rebase 的全部剩余提交。

## 它在流程中的位置

随时可用的独立工具，不依赖其他 skill；Git 停顿时开始，树干净且提交完成时结束。唯一真正邻居是 [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs)，在冲突解决干净、合并代码行为却错误时接手，这是诊断而非冲突问题。它在想法到交付主流程之外，[ask-matt](https://aihero.dev/skills-ask-matt) 提供前后步骤地图。
