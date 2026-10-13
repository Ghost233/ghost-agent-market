## 它的作用

`implement-spec` 接收[规格](https://www.aihero.dev/ai-coding-dictionary/spec)及其[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)，一次完成全部工作。编排[代理](https://www.aihero.dev/ai-coding-dictionary/agent)把每张工单交给独立 Git worktree 中的实施[子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)，将完成分支汇入一个**集成分支**，对结果运行 [code-review](https://aihero.dev/skills-code-review)，并解决工单。

它把工单读作**任务图**而非列表。阻塞边决定何时可开始，因此随时都有一个**就绪前沿**，其中工单的阻塞项均已落地，所有前沿工单同时运行。这与逐张执行不同；节奏取决于图的形状，而非跟踪器中的顺序。

## 何时使用

输入 `/implement-spec` 调用，代理不会自行使用。

| 你的情况 | 使用什么 |
| --- | --- |
| 已按阻塞边拆成工单的规格，希望一次落地 | `/implement-spec` |
| 在自己的[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)逐张执行，工单间[清空](https://www.aihero.dev/ai-coding-dictionary/clearing) | [implement](https://aihero.dev/skills-implement) |
| 规格尚未拆为工单 | 先 [to-tickets](https://aihero.dev/skills-to-tickets) |
| 小工作，没有真实任务图 | 直接 [implement](https://aihero.dev/skills-implement) |

## 前提条件

- **工单跟踪器。** 从 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 配置的跟踪器读取、解决工单。未配置时停下要求先配置，不猜测。
- **带阻塞边的工单**，如 [to-tickets](https://aihero.dev/skills-to-tickets) 的产物。没有边则图平坦，所有工单一起启动。
- **能后台运行子代理并给每个分配 Git worktree 的[运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)。** 目的就是同时执行；只能逐个子代理的框架上，它只是更慢的 `implement`。

## 集成分支

全部落在一个分支。每个实施者：

1. 开始前确认 worktree 基于集成分支。
2. 使用 [tdd](https://aihero.dev/skills-tdd)，逐切片红绿循环构建工单。
3. 报告完成前把集成分支最新提交合入自身分支，确保落地时可 fast-forward。

是否创建 PR 由跟踪器决定。如果通过 PR 关闭工作，或你明确要求，首次合并后开 draft PR，结束时标为 ready。否则运行在集成分支结束，用跟踪器的方式解决全部工单；本地 Markdown 跟踪器可完全离线运行。

实施者通过[上下文指针](https://www.aihero.dev/ai-coding-dictionary/context-pointer)（规格、工单、共享探索笔记、先前提交）与编排者沟通，而非粘贴摘要。这缩小子代理提示，给编排者窗口中的任务图留空间。

## 常见问题

**与自己逐张运行 `/implement` 有何不同？**

这正是 skill 的目的。发布前用户不断自建版本，一位用户希望由子代理实施工单，不必在规格可能超过五张工单时逐个新建会话再指示实施。使用 `implement` 时你是派发者：每张一[会话](https://www.aihero.dev/ai-coding-dictionary/session)、中间清空、自行跟踪已解除阻塞的工单。`implement-spec` 把工作交给一个编排会话。代价是落地时不逐张阅读，最后审查集成分支。开始时清空上下文，输入 `/implement-spec` 与规格指针（issue 编号或文件路径）。小变更没有真实图时，直接用 `implement`。

**需要 GitHub 吗？我想停在分支。**

现在不需要。一位喜欢试验版的用户抱怨，它最后创建 PR，要求 GitHub 等在线仓库，希望离线完成并停在合并全部工作的分支。现在运行结束于集成分支，只有配置跟踪器通过 PR 关闭工作或你要求时才开 PR。本地 Markdown 跟踪器中，全部工单解决、工作合在分支后结束。

**审查与修复循环持续几小时，或一直“修复”尚未构建的工单。**

都是 `code-review` 在指定位置之外运行的结果。它对照完整规格，因此只适合所有工单落地后；中途运行会把未构建工单都视为失败，代理构建它，又触发审查。最后 skill 只运行一次 `code-review`，把发现交给一个修复子代理，但未说明修复后何时停。一位用户的五工单功能“审查与修复约四小时”。看到第二次广泛审查启动时，让它针对已修复发现做定向检查并停下。首次审查预计会找出真实问题；运行产出是需审查补完的草稿，不应直接交付。

**会像 implement 一样驱动 tdd 吗？**

现在会，最初不会。试验版用户发现实施子代理没有继承 `/tdd`，扩大到完整规格后红绿循环便停止。现在每个实施者用 `tdd`。仍没有像 `implement` 会话那样交互式确认接缝的步骤；想固定接缝，就写进规格或工单。

**并行实施者撞到同一文件，或为同一事物取不同名称。**

Worktree 不消除冲突，只把它延后至合并。基于工单文字写的阻塞边，是对各自涉及文件的猜测；“不同代码区域”的工单仍可能共享消息目录、配置注册表或类型。实施者只看到自身工单与共享笔记，看不到其他未完工作，因此有人网页与移动端把同一字符串分别写为 `blockedSince`、`blockedOn`。两个前沿工单涉及共享文件时，加阻塞边让它们顺序运行，或在探索笔记固定双方新增的准确名称。

**阻塞工单即使阻塞项已合并也不启动。**

GitHub 上这是已知问题。blocked-by 计数只在阻塞项*关闭*时减少，工单通常到运行结束、PR 合并才关闭。跟踪器适合提供初始图，但运行中可能过期。让编排者自己记录哪些已合入集成分支，据此计算前沿。

**取代 Sandcastle 或 AFK 脚本吗？**

不。有人因 skills 开始涉及实施而询问 Sandcastle 是否仍有用。`implement-spec` 在一个框架会话内让代理负责编排，不需基础设施，可观察与引导。真正[无人值守](https://www.aihero.dev/ai-coding-dictionary/afk)的工作，确定性循环（[Sandcastle](https://github.com/mattpocock/sandcastle)、Shell 脚本、CI 作业）更快、更便宜、更可靠，因为没有代理做编排决策。

**工单关键测试在 worktree 内被跳过，却报告绿灯。**

Worktree 只含 Git 跟踪内容。依赖 gitignored 固定数据、本地数据库或凭据的测试可能悄悄跳过。验证依赖未跟踪资料时，让编排者在主 checkout 运行。

## 正常工作的表现

- 任务图允许时，多名实施者同时运行，而非逐个。
- 最后一个阻塞项落到集成分支就启动工单，而非等整轮结束。
- 每张执行记录显示 `tdd`，先有失败测试再有代码。
- 合入集成分支使用 fast-forward，而非冲突解决。
- 最后全部工单解决、成果位于一个分支，只有跟踪器要求时才有 PR。

## 它在流程中的位置

`implement-spec` 是主链的构建步骤，作为逐张运行 [implement](https://aihero.dev/skills-implement) 的并行替代：

```txt
grill-with-docs → to-spec → to-tickets → implement-spec → retro
```

邻居是声明任务图阻塞边的 [to-tickets](https://aihero.dev/skills-to-tickets)，以及结束前对集成分支运行的 [code-review](https://aihero.dev/skills-code-review)。不确定流程时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
