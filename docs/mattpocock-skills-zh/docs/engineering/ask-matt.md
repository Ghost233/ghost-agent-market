## 它的作用

`ask-matt` 是本仓库 skills 的路由器。你描述自己所处的情况（有个想法却无从开始、收到一堆缺陷报告、某个[会话](https://www.aihero.dev/ai-coding-dictionary/session)已经持续很久），它会指出合适的 skill 或 skill 顺序，以及其中哪些地方需要人来决策。

它给出建议后就停下。它不会追问、编写[规格](https://www.aihero.dev/ai-coding-dictionary/spec)、打开文件，或启动刚刚推荐的 skill；你得到的是下一条要输入的内容，并由你亲自输入。它也是本仓库 skills 的人工维护地图，而不是已安装内容的扫描结果，因此不会推荐你自己的 skills 或其他作者的 skills。

## 何时使用

输入 `/ask-matt` 来调用它；代理不会自行使用它。

| 你的情况 | 路由器返回什么 |
| --- | --- |
| 有想法，却不知道从何开始 | 主流程的起点，以及构建是否足够小、可以跳过规格 |
| 收到其他人的缺陷和请求 | [triage](https://aihero.dev/skills-triage) 入口，以及为何你自己生成的[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)不该经过它 |
| 两个 skills 看起来可以互换 | 两者的边界，通常是一个具体判断条件，而不是个人偏好。[grill-me](https://aihero.dev/skills-grill-me) 与 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 的区别在于是否身处工作目录；[grill-with-docs](https://aihero.dev/skills-grill-with-docs) 与 [wayfinder](https://aihero.dev/skills-wayfinder) 的区别在于这项工作能否在一个会话内完成 |
| 会话很长，需要决定如何处理[上下文](https://www.aihero.dev/ai-coding-dictionary/context) | 阶段边界上五个选项的有序决策树 |
| 已经选好了 skill | 没有什么有用内容。直接调用那个 skill。 |

## 前提条件

路由器只指出 skills，不会安装它们。它指向的内容必须已经安装，建议才可执行；它只知道本仓库中正式发布的 skills。

依赖工单跟踪器的路线（triage、`to-spec`、`to-tickets`、`implement`）假定 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 已在仓库配置好跟踪器。尚未完成配置时，路由器仍会推荐它们。

## 关注流程，而不只是 skills

这个 skill 的核心词是**流程**：穿过多个 skills 的路径，而不是某一个 skill。你描述情况时，路由器会把你放到某条流程的一步上。这与“这是匹配你关键词的 skill”是不同的答案。路线有五种，skill 本身完整说明了它们：

- **主流程**，从想法到交付。追问、规格、工单、实施（逐张工单，或用 [implement-spec](https://aihero.dev/skills-implement-spec) 并行执行整个任务图）、审查，然后 [retro](https://aihero.dev/skills-retro)，把构建过程中的经验反馈进代理环境。它有两个分支：一条是原型支线，用于必须靠可运行代码才能回答的问题；另一条是规格与工单的拆分，只有构建跨越多个会话时，额外成本才值得。
- **入口支线**，用于会产生工作、随后汇入主流程的情况：收到缺陷报告、某处损坏，或工作太模糊且太大，一个会话容不下。
- **代码库健康**，维护而不是功能开发。[improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 检查代码中的深化机会，发现的每个机会都以想法的形式重新进入主流程。
- **独立工具**，位于所有流程之外，单独使用：原型、问卷、调研。
- **底层词汇层**，当问题在于词语而非流程时，其他 skills 会加载的两个参考 skill。

## 阶段边界

另一个关键概念是**阶段边界**。阶段是会话中的一段工作（[追问](https://www.aihero.dev/ai-coding-dictionary/grilling)、实施、QA）；只有两个阶段之间的边界，才适合问“该怎么处理这些上下文？”。阶段中间没有这项决策：继续，或者把剩余工作拆给[子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)。

| 选项 | 何时选择 |
| --- | --- |
| **继续** | 下一阶段需要本阶段的完整原文，或者还剩[高效上下文区](https://www.aihero.dev/ai-coding-dictionary/smart-zone)。这是唯一能把会话保留为[一手来源](https://www.aihero.dev/ai-coding-dictionary/primary-source)的做法，因此先判断能否采用它 |
| **`/clear`** | 之前的一切都可丢弃。成本最低，但判断错了就无法撤销 |
| **[handoff](https://aihero.dev/skills-handoff)** | 有东西必须转移：新的[运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)、新目录、同事，或阶段中途分出的支线任务 |
| **子代理** | 任务范围足够明确，能在你[离开键盘](https://www.aihero.dev/ai-coding-dictionary/afk)时运行 |
| **`/compact`** | 以上都不适用。它是默认选项，决策树常在此结束 |

人们经常误解其中两项，所以路由器给出顺序，而不只是列表。`/handoff` 看起来像在上下文窗口之间切换的通用办法，但它只提供可迁移性。`/compact` 位于决策树最后，而不是最前，因为前面的四项都更便宜或更精确。

## 常见问题

**不能直接列出按正确顺序排列的 skills 吗？**

README 中不断有人提出这个要求。这个 skill 就是那份列表。静态表会写成 `wayfinder → to-spec → to-tickets → implement → code-review → retro`，但对大多数情况都不正确。重点在分支：有没有代码库、构建是否跨会话、谈话能否解决问题。代价是路由器靠人工维护，因此落后于仓库。`/grilling` 发布很久之后，路由器才提到它。

**它说有一半 skills 没安装。**

这是已知且尚未修复的缺陷。路由器推荐的大多数 skills 设置了 `disable-model-invocation: true`，运行框架因此不会把它们放进注入代理上下文的 skill 列表。代理误把列表当作完整清单，报告这些 skills 缺失。一次报告的会话中，它宣称整条规格与工单流程都不存在，改走单独的 `/grilling` 和 `/tdd`。插件二十七个 skills 中有十六个带此标记，因此这是常见情况。它们已经安装。照常输入斜杠命令，或查看作为权威清单的 `.claude-plugin/plugin.json`。

**它描述了某个 skill 的行为，但该 skill 并不会这样做。**

这也是真实且尚未修复的缺陷。路由器依据自己给每个 skill 写的一行摘要回答，而不是读取 skill。一个详细报告在同一会话追踪到三次，其中包括仅凭“把对话转成规格”的摘要，就建议跳过 [to-spec](https://aihero.dev/skills-to-spec)。路由器从未打开 `to-spec/SKILL.md`。每次都是用户质疑后才验证，没有一次主动验证。那次跳过 `to-spec` 漏掉了真正的模块接缝检查，生成的工单低估了工作量。当路由器对另一个 skill 做出你准备据此行动的判断时，让它先打开该 `SKILL.md`。对于地图完全没有覆盖的问题也一样，例如是否使用[计划模式](https://www.aihero.dev/ai-coding-dictionary/agent-mode)：答案是[模型](https://www.aihero.dev/ai-coding-dictionary/model)的推断，不是这里记载的内容。

**为何用散文，而不是编号清单？**

这个批评合理。一个未关闭的 issue 指出，大部分路由是确定性的，叙述让它难以快速浏览。你可以要求压缩形式：“只给我顺序”就会得到顺序。散文承载条件部分：分支、何处需要人决策、步骤之间何时清空或压缩上下文。扁平清单恰好会丢掉这些。

**能推荐我自己的 skills 或其他作者的 skills 吗？**

不能。已有三个独立提案要求路由器读取本地 `skills/` 目录，并从已安装内容中推荐。`ask-matt` 并非如此。它是人工维护的一组 skills 地图，不知道你编写或从其他地方安装的 skills。

**它让我编辑 SKILL.md。**

建议通常正确，但编辑很少持久。有人询问怎样让 [implement](https://aihero.dev/skills-implement) 关闭工单，得到的建议是在 skill 加一行，随即发现问题：`npx skills update` 会覆盖文件，插件安装目录也只读。把长期行为写进自己的 `CLAUDE.md` 或 `AGENTS.md`，或写在调用提示里。提示中的改动能经受更新。用户通过这种方式把流程指向 Linear 而不是 GitHub，或询问哪些未关闭工单可以并行运行。

**它提到了我没有的 skill，或漏掉了我有的 skill。**

先检查 changelog 中是否有重命名。`writing-great-skills` 改名为 [writing-for-agents](https://aihero.dev/skills-writing-for-agents)，没有别名；`to-prd` 改为 [to-spec](https://aihero.dev/skills-to-spec)；`pathfinder` 改为 [wayfinder](https://aihero.dev/skills-wayfinder)。四个 skills 直接退役，其职责并入其他 skills：`ubiquitous-language`、`design-an-interface`、`qa` 和 `request-refactor-plan`。如果漏掉你拥有的 skill，那就是前述路由器自身的滞后。

## 正常工作的表现

- 最后指出该输入什么并就此停止，而不是亲自开始工作。
- 返回的路线包含何时清空或压缩上下文，以及何时需要你审查，而不只是 skill 名称。
- 两个 skills 相近时，说明该选哪个，以及另一个为何不适合你的情况。
- 对另一个 skill 行为的任何判断，都能在执行记录中看到它读取了该 skill 的 `SKILL.md`。
- 你能在结果中认出自己的情况，而不是最接近的泛化场景。

## 它在流程中的位置

`ask-matt` 是覆盖整套 skills 的**独立路由器**。它从不作为流程中的一步。它指向每条流程，其他文档页都链接回来，因此不必各自重画流程图。你通常会从这里进入主流程起点 [grill-with-docs](https://aihero.dev/skills-grill-with-docs)，或接收外来工作入口 [triage](https://aihero.dev/skills-triage)。

它是所描述 skills 的[二手来源](https://www.aihero.dev/ai-coding-dictionary/secondary-source)。路由器与 `SKILL.md` 不一致时，以 `SKILL.md` 为准。
