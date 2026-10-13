## 它的作用

`implement` 构建已经决定的工作。你指向[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)、[规格](https://www.aihero.dev/ai-coding-dictionary/spec)，或刚在对话达成的计划，它写代码、在接缝驱动 [tdd](https://aihero.dev/skills-tdd)、过程里检查类型、最后运行 [code-review](https://aihero.dev/skills-code-review)，并提交到当前分支。

它不重开计划讨论，没有采访、澄清回合或另提方案。上游确定的内容就是输入，全部职责是转成提交。这与向新[代理](https://www.aihero.dev/ai-coding-dictionary/agent)说“构建这个”不同，后者常边构建边重设计。

## 何时使用

自己输入 `/implement`，代理不会自行使用。它设置 `disable-model-invocation: true`，因此其他 skill 也不能调用。[ask-matt](https://aihero.dev/skills-ask-matt) 或 [to-tickets](https://aihero.dev/skills-to-tickets) 写“随后逐工单 `/implement`”时，是给你的指示，不是代理会擅自执行的动作。

工作当前在哪里，决定是否适合：

| 工作状态 | 使用什么 |
| --- | --- |
| 跟踪器中的工单 | `/implement #42`，每[会话](https://www.aihero.dev/ai-coding-dictionary/session)一张，中间[清空](https://www.aihero.dev/ai-coding-dictionary/clearing) |
| 尚未拆分、构建跨会话的规格 | 先 [to-tickets](https://aihero.dev/skills-to-tickets)，再逐张 `/implement` |
| 小规模规格 | 直接对规格 `/implement` |
| 仅在刚才对话中，规模仍小 | 在同一窗口立即 `/implement` |
| 尚未写在任何地方 | [grill-with-docs](https://aihero.dev/skills-grill-with-docs)，无代码库则 [grill-me](https://aihero.dev/skills-grill-me) |
| 无规格，想测试先行实现一个具体行为 | 直接 [tdd](https://aihero.dev/skills-tdd) |
| 已构建，想检查 | 直接 [code-review](https://aihero.dev/skills-code-review) |

同会话情况值得单独说明，因为 skill 首行没覆盖。`SKILL.md` 写“规格或工单”，使[模型](https://www.aihero.dev/ai-coding-dictionary/model)寻找不存在的文件。计划只在对话时，调用中明确说明。

## 前提条件

`implement` 提交到当前分支，不创建分支，也不询问。开始前确认你位于希望接收工作的分支。

工单来自 [to-tickets](https://aihero.dev/skills-to-tickets) 时，[setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 已配置所在跟踪器。结束时 `code-review` 读取同一配置寻找来源规格。

## 一次运行做什么

按顺序五步：

1. 读取工单或规格，确定接缝。
2. 在预先约定接缝驱动 [tdd](https://aihero.dev/skills-tdd)，逐切片红绿循环。
3. 经常检查类型，途中运行单个测试文件。
4. 最后运行一次完整测试套件。
5. 运行 [code-review](https://aihero.dev/skills-code-review)，随后提交到当前分支。

一次覆盖一张工单。[to-tickets](https://aihero.dev/skills-to-tickets) 产物是 tracer-bullet 纵向切片，大小适合一个新的[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)，预期节奏为清空、实施一张、提交、再次清空。每张自包含，因此可以丢弃前一张的上下文。

## 预先约定的接缝

核心概念是**接缝**：无需深入内部就能观察行为的公共边界。测试位于接缝。代码出现前就约定接缝，测试才能长久，底层实现可重写而不改测试。

“预先约定”重要，也是最弱之处。`implement` 内没有确认接缝的过程。`tdd` 会询问，且拒绝在未确认接缝写测试。因此实际约定在上游规格或首轮交互中发生。都没有发生时，运行会变成“只写代码”，没有警告。在规格命名接缝可阻止这一点。

## 常见问题

**它结束了，但工单仍开着，验收条件没勾。**

符合预期。`implement` 没有完成收尾步骤，止于提交，不触碰工作项。GitHub Issues 与本地 Markdown 跟踪器都一样，不是集成问题。`implement` 也不处理 `code-review` 的发现，不勾来源 issue 的 `- [ ]`。自行关闭工单、核对条件。依赖链上尤其重要，因为 `to-tickets` 把所有阻塞项关闭的工单定义为前沿；不关闭就永远不会显式解除阻塞。

**能一次指向全部工单，或并行多张吗？**

`/implement` 不行，一次调用一张。完整规格一次运行用 [implement-spec](https://aihero.dev/skills-implement-spec)，它把就绪前沿每张交给独立 worktree [子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)，汇入一个集成分支。单 checkout 并行多个 `/implement` 会话，问题比不支持更严重。一个实地报告中，同一下午三个 issues 出现一会话 `git commit --amend` 改到另一会话提交、stash 从 `refs/stash` 消失、提交落错分支。会话共用目录、索引、HEAD。用户用 worktree 绕过，但 `refs/stash` 在 worktrees 之间也共享，因此仍不解决 stash 问题。

**能开 PR 而不是直接提交吗？**

没有内置支持。它直接提交到当前分支。有人觉得太急，因为验证能运行之前代码已落地。没有配置开关或 PR 模式。可在调用里覆盖（“提交到分支并开 PR”），或修改本地副本。代理写 PR 时由 [pr](https://aihero.dev/skills-pr) 塑造正文。

**`code-review` 说看不到变更。**

它审查 `git diff <fixed-point>...HEAD`，不含暂存与工作树。`implement` 在提交前调用，未有中间提交则 `code-review` 比较的差异中没有可审查内容。多人报告，双方均未修复。先提交，再对分支起点审查。

另有人不希望内置审查，因为刚写代码的代理偏向自己方案。新会话对固定点运行 [code-review](https://aihero.dev/skills-code-review) 是有效替代。同一偏差也解释该 skill 为何用两个独立子代理审查两维度。

**一张工单用了十五万 tokens，是我用错了吗？**

大概没有，工单更可能太大。运行包括探索、每接缝红绿循环、完整套件、审查；非平凡工单超过十万 [tokens](https://www.aihero.dev/ai-coding-dictionary/token) 并不罕见，不代表损坏。修复在上游：[to-tickets](https://aihero.dev/skills-to-tickets) 适当定大小，确保每张适合一个新窗口。一张反复超出时拆分，而非提高[思考力度](https://www.aihero.dev/ai-coding-dictionary/effort)。

**新会话 `/implement #2` 做了完全无关的事。**

代理对照上下文的其他编号列表（todo 或清单）解析 `#2`，而非配置跟踪器。现在会从跟踪器获取引用，开始前说明标题，歧义时询问。核对标题；传 issue URL 或 `owner/repo#2` 可完全消除歧义。

## 正常工作的表现

- 开始时读取工单或规格、复述要构建什么，而不是问你构建什么。
- 记录中能看到真实 `tdd` Skill 工具调用，而不只是差异里有测试。
- 过程重复类型检查与单测试文件，尾部完整套件一次。
- 不需你催促继续，最终在当前分支产生提交。
- 差异是一张工单的规模：贯穿所有层的纵向切片，而非多张合在一起。

## 它在流程中的位置

`implement` 是主链构建步骤：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review → retro
```

邻居是生成工单、声明顺序阻塞边的 [to-tickets](https://aihero.dev/skills-to-tickets)，在各接缝内部驱动的 [tdd](https://aihero.dev/skills-tdd)，以及提交前运行的 [code-review](https://aihero.dev/skills-code-review)。它在规划 skills 下游，信任其产物，不重新验证形状，因此错误地图或水平分层工单会照样构建。

这种信任使 [wayfinder](https://aihero.dev/skills-wayfinder) 从 [to-spec](https://aihero.dev/skills-to-spec) 汇入主链，而不把地图直接交给 `implement`。只有工作最终很小时，才从地图直达 `implement`。

不确定流程时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
