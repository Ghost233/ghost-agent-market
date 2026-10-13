## 它做什么

`grilling` 在行动前，用访谈循环对计划、决策或想法作压力测试。它把主题建模为一棵**设计树**：每个决策衍生出依赖它的其他决策，再逐分支追问，直到所有假设都已说明。

它按轮次提问。每个**轮次**覆盖整个**前沿**：所有前置条件已经确定的决策，除此之外不问。两个问题中一个依赖另一个时，不能放在同一轮。依赖尚未得到答案的问题，留到后续轮次。你的回答确定决策，前沿向外移动，下一轮询问新解锁的内容。13 个问题通常分为约三轮，而非 13 轮。

## 何时使用

可以输入 `/grilling`，也可以由[代理](https://www.aihero.dev/ai-coding-dictionary/agent)在任务适合时自行使用。它是追问家族中唯一由模型调用的 [skill](https://www.aihero.dev/ai-coding-dictionary/skill)，因此你很少需要输入它。通常是你调用的另一个 skill 替你运行它。

直接输入 `/grilling`，只运行普通访谈。需要更多能力时：

| 你的情形 | 使用 |
| --- | --- |
| 不在工作目录中 | [grill-me](https://aihero.dev/skills-grill-me)：相同[会话](https://www.aihero.dev/ai-coding-dictionary/session)，但代理永远不会自行触发这个名称 |
| 在工作目录中 | [grill-with-docs](https://aihero.dev/skills-grill-with-docs)：相同会话，同时写入 `GLOSSARY.md` 和 ADRs |
| 工作规模超出单次会话 | [wayfinder](https://aihero.dev/skills-wayfinder)：绘制地图，在决策工单内深入追问 |
| 谈话无法确定外观或感受 | [prototype](https://aihero.dev/skills-prototype)：构建一次性版本，再回来回答 |
| 你自己的 skill 需要访谈 | 从中调用 `/grilling`，复用已有访谈 |

## 轮次、前沿与决策归属

Skill 基于三个概念。

**设计树**是主题的模型：决策上挂着其他决策。**前沿**是所有前置条件已经确定的决策集合，也就是代理当前能问的问题。一个**轮次**完整询问一个前沿，并完整获得回答。

每轮中的问题都有固定格式：以 `❓` 开头，后接编号和标题，再接正文，最后独占一行 `➡️` 给出代理推荐的答案。你可以按编号回答一轮，例如“1 是，2 第二项，3 否，原因是……”，无需复制问题。这个格式有一个已知问题：推荐答案有时会反对问题原来的措辞，因此同意推荐意味着对问题回答“否”。遇到这种情况，回答推荐项，并明确说明。

设计的另一部分是区分事实与决策。事实由 skill 自己查明。前沿问题需要[环境](https://www.aihero.dev/ai-coding-dictionary/environment)可以确定的信息时，代理派发[子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)查找，无需问你。本轮继续进行，只有依赖调研的问题等待。决策归你作出，代理必须等待答案。运行 `grilling` 的代理自行作出决策，就违反了 skill。前沿清空时，会话结束。随后代理等待你确认已达成共同理解，才执行双方同意的内容。

前沿有一个限制：代理凭判断选择，并不通过图计算。所以可能把两个问题放进同一轮，之后才发现一个答案本该影响另一个问题。唯一的防护是告诉它。下一轮会重新打开受影响的分支。

## 原语与包装 skills 的资料分工

本页解释机制。包装 skills 的页面回答用户最常问的问题。

| 问题 | 解答位置 |
| --- | --- |
| 树、前沿、轮次、问题格式、事实与决策的区别 | 本页 |
| 会话应该多长、无法靠谈话回答的问题怎么办、如何避免只顾点头 | [grill-me](https://aihero.dev/skills-grill-me) |
| 什么写进 `GLOSSARY.md`，什么形成 ADR | [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |

## 常见问题

**可以恢复成一次一个问题吗？**
可以，很多用户这样做。在全局 `CLAUDE.md` 中加入：

```
深入追问时，一次只问一个问题。
```

不是所有人都喜欢默认的分轮方式。阅读较慢、使用第二语言，或依靠顺序格式集中注意力的用户，反馈一次一个问题更适合自己。这是受支持的选择，并非临时绕过办法。

**`/batch-grill-me` 去哪了？**
并入了这个 skill。分轮提问曾短暂作为独立 skill 发布，后来移进 `grilling`，因此构建于此原语上的 `grill-me`、`grill-with-docs`、`triage` 和 `wayfinder` 同时获得该能力。不再有 `batch-grill-me` 可安装，也没有独立的顺序提问 skill。上面的 `CLAUDE.md` 指令就是恢复一次一个问题的办法。

**一次问完整轮，会丢掉由前面答案引出的新问题吗？**
这是对分轮方式最常见的质疑，前沿设计回应了它。一轮只包含互不依赖的问题，所以本轮任何答案都不应使本轮其他问题失效。答案仍然影响后续内容，因为代理会重新计算每一轮。确实会损失一些东西，但少于“一次问所有问题”所暗示的程度。参见前沿限制。

**它问完就开始构建了。**
确认门槛就是为此设置的。你说已经达成共同理解时，skill 才完成。较弱、较快的[模型](https://www.aihero.dev/ai-coding-dictionary/model)仍会跳过门槛。低推理投入或非前沿模型中，这类反馈最多：它们把“追问直到达成共同理解”压缩成几个问题加提纲。遇到这种行为，可靠的修复是在自己的 `AGENTS.md` 或 `CLAUDE.md` 中加入一行，要求代理未经许可不得实施。

**它自己回答问题，没有问我。**
这是本次运行的缺陷，也是 skill 文本区分事实与决策的原因。另一个 skill 用 `grilling` 解决工单时最容易发生，代理把这个任务当成继续前进的许可。同一约束也解释了为什么没有异步模式。有人要求一种读取 GitHub issue 后发布统一决策备忘录的变体，但那属于另一个 skill：无人回答的追问会话产出的是代理的意见，而非你的意见。

**可以限制问题数量吗？**
不能，这是有意排除的范围。有些计划需要三个问题，有些需要 50 个。固定上限会截断复杂案例，也会在简单案例中显得任意。预期的控制方式是直接用自然语言说明：让它收尾，或停止并接受当前计划。会话很长，通常是因为范围太大；拆分工作，再逐块追问。

**我单独安装了 `grill-me`，但没有效果。**
`grill-me` 是一行 skill，正文全部是“运行 `/grilling` 会话”，所以必须同时安装这个 skill。`grill-with-docs` 也一样，并额外需要 [domain-modeling](https://aihero.dev/skills-domain-modeling)。安装整套可以避免这个问题；选择安装时也必须安装原语。

**`grill-with-docs` 运行了，却没有加载 `grilling`。**
这是真实且尚未修复的缺陷，用户在不同[代理运行环境](https://www.aihero.dev/ai-coding-dictionary/harness)和模型中都报告过。Skill 提到另一个 skill，并不可靠地触发加载，`grill-with-docs` 提到两个。表现是一次问所有问题，且没有推荐答案。这意味着模型在临时编造访谈，而非运行这里的方法。直接问代理是否加载了 `grilling` 和 `domain-modeling`，通常可以恢复。

## 有效运行的表现

- 每轮是编号列表，每个问题的推荐独占一行 `➡️`，你可以按编号回答整轮。
- 本轮没有任何问题需要先回答本轮另一个问题。
- 后续轮次询问第一轮还不能询问的内容。
- 它会查明事实，包括读文件、派发子代理，而非问你它本可查明的内容。
- 后台调研不阻塞整轮，只有依赖调研的问题等待。
- 结束时停止并请求确认已达成共同理解，再开始工作。
- 问题总数保持较高，轮数保持较少。

## 在流程中的位置

`grilling` 是一个**原语**，而非安排执行的某个阶段。它是访谈技术的单一事实来源，保存在一个位置，让所有需要访谈的 skills 使用它。[grill-me](https://aihero.dev/skills-grill-me) 与 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 是两个用户调用入口。`grill-with-docs` 是主要构建流程的起点，位于 [to-spec](https://aihero.dev/skills-to-spec) 之前。[wayfinder](https://aihero.dev/skills-wayfinder) 用它解决决策工单，[triage](https://aihero.dev/skills-triage) 用它把模糊报告问成可实施的报告，[improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 在选定深化候选项后，用它走遍设计树。不确定哪个入口合适时，[ask-matt](https://aihero.dev/skills-ask-matt) 会帮你选择。
