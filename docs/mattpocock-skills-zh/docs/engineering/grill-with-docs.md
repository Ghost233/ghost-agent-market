## 它的作用

`grill-with-docs` 就计划或设计采访你，直到你与[代理](https://www.aihero.dev/ai-coding-dictionary/agent)拥有一致理解，并在过程中把词汇与困难决策写入仓库。采访与 [grill-me](https://aihero.dev/skills-grill-me) 相同：一轮问题、等待、下一轮，只是这里指向代码库。

它是**[有状态的](https://www.aihero.dev/ai-coding-dictionary/stateful)**。其他追问 skills 把[会话](https://www.aihero.dev/ai-coding-dictionary/session)留在你的脑中，这个留下磁盘文件。词语确定后立即写入 `GLOSSARY.md`，不是结束时批量写入。决策通过三道门槛就写 ADR。区别仅在此，也造成多数问题。工件是真实仓库中的真实文件，因此可能没有如期出现，多人编写时也可能偏移。

## 何时使用

输入 `/grill-with-docs` 调用，代理不会自行使用。

身处仓库、变更刚开始、计划仍模糊、用词尚未确定时使用。它是单会话工具，选择哪个追问 skill 取决于手头情况：

| 手头有什么 | 使用什么 |
| --- | --- |
| 完全不在工作目录中 | [grill-me](https://aihero.dev/skills-grill-me) |
| 一个仓库，以及一个会话能确定的变更 | `grill-with-docs` |
| 一个会话容不下的工作，如新项目、大功能 | [wayfinder](https://aihero.dev/skills-wayfinder) |
| 没有领域文档的仓库，也没有特定功能目标 | 针对仓库而非变更使用 `grill-with-docs` |
| 决策卡在别人脑中的知识 | [to-questionnaire](https://aihero.dev/skills-to-questionnaire) |

与 wayfinder 的分界在会话数量：单会话规划用 `/grill-with-docs`，多会话规划用 `/wayfinder`。

## 前提条件

skill 会写仓库，因此所在位置必须适合写入。确定的词进入根目录 `GLOSSARY.md`，若根目录 `GLOSSARY-MAP.md` 表明有多个上下文，就进入相关上下文的 `GLOSSARY.md`。决策进入 `docs/adr/`。均按需创建，首个词或决策确定前什么都不会出现，不需预先设置。

还需另外两个 skills，因为自身 `SKILL.md` 只有一行委派。[grilling](https://aihero.dev/skills-grilling) 提供采访，[domain-modeling](https://aihero.dev/skills-domain-modeling) 提供写入。只安装 `grill-with-docs` 无法工作。

## 书面记录

一次会话产生三类内容，彼此不同。

| 确定的内容 | 去处 |
| --- | --- |
| 词语：项目对事物的称呼 | 当下即时写入 `GLOSSARY.md` |
| 难以撤销、缺少背景令人意外、涉及真实权衡的决策 | `docs/adr/` 中的 ADR |
| 其他所有决定 | 只在对话里 |

第三行经常出乎预料。`GLOSSARY.md` 只放术语，不放实现细节、[规格](https://www.aihero.dev/ai-coding-dictionary/spec)、草稿。ADR 必须同时满足三条件，所以多数决策不符合，多数会话没有 ADR。会话使术语表更精确却没有 ADR，符合设计；但多数共识只在达成它的[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)中。把同一对话交给 [to-spec](https://aihero.dev/skills-to-spec)，别[清空](https://www.aihero.dev/ai-coding-dictionary/clearing)。

术语表是主要输出。本 skill 建立领域语言：项目自己的用词，一次达成共识，你、代理、同事便无需重新推敲。并非所有人认同这改善代理表现。最有力的反对意见是术语与其普通语言展开对[模型](https://www.aihero.dev/ai-coding-dictionary/model)效果一样，词汇主要缩短共享它的人类沟通。如此术语表仍有价值，但收益在人类。

## 常见问题

**该用它还是 `/wayfinder`？**
范围决定。一个会话可确定的事用这里；太大则用 [wayfinder](https://aihero.dev/skills-wayfinder)，先把工作画成决策[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)地图。Wayfinder 更慢、更密集，用于明确功能是常见误用。它不取代本 skill，也可对地图中适合的部分开启追问。

**它运行了，却没生成 `GLOSSARY.md` 或 ADR。**
有两种已知原因。首先是没有合格内容：ADR 要三道门槛，没有新词汇的变更也无词可写。其次是真实缺陷：在其他编排层（规格驱动开发包装器、多代理框架、把它作为流水线一步的规则）内运行时，用户报告采访仍执行，文件写入却悄悄消失。缺陷已报告但未修复。这种配置下，相信产出前先检查工作目录。

**它一次问完，没有建议，也没提 `GLOSSARY.md`。**
两个依赖没加载。`SKILL.md` 是一行委派，未加载 [grilling](https://aihero.dev/skills-grilling) 与 [domain-modeling](https://aihero.dev/skills-domain-modeling) 的代理只好猜追问含义，结果没有结构、一次抛出全部问题。部分加载更迷惑：加载 `grilling`、漏掉 `domain-modeling`，采访很好却无记录。发生率取决于模型与[思考力度](https://www.aihero.dev/ai-coding-dictionary/effort)，这是报告最多的问题。怀疑时直接问代理加载了哪些 skills。

**其他决策去哪了？**
只在对话里。这是最严重的未解决批评。术语表不是规格，多数回答不足以写 ADR，没有记录把每个确定回答连接到规格、工单与测试。后续步骤把精确回答（顺序保证、禁止要求、数字默认值）软化成弱文字，结果看似完整却漏掉决策。当前应保留会话，直接交给 [to-spec](https://aihero.dev/skills-to-spec)，再对照自己的回答重读规格，别假定已全收录。

**能对完全没有文档的现有仓库使用吗？**
可以。没有 ADR、领域语言、设计原则的代码库适合它：调用并说“帮我给仓库写文档”。用户常搭配 [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 建立或修复 `GLOSSARY.md`。需要你引导：它读代码、按发现提问，由你决定已有用词哪些正确。

**会话结束后该做什么？**
结束消息经常开放式，这是已知问题。主流程中是在同一对话调用 [to-spec](https://aihero.dev/skills-to-spec)。变更足够小可立即构建时，直接 [implement](https://aihero.dev/skills-implement)。

**为何叫这个名字？**
没人满意。有人建议改名 `grill-domain-model`，更准确描述行为，尚无进展。若将来重命名，文档页与 URL 也会变化。

## 正常工作的表现

- `GLOSSARY.md` 在会话*期间*逐词变化，而非最后整块出现。
- 术语表只含项目词汇与紧凑定义，没有实现细节或规格式文字。
- 代码库能回答的问题通过读代码解答，而不是问你。
- ADR 很少或没有；已有 ADR 都是你不愿再次争论的决策。
- 它质疑你用的词，因为现有术语表有不同定义。

## 它在流程中的位置

`grill-with-docs` 位于主构建链起点：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review → retro
```

它在写成规格前运行，产生共享理解与确定词汇，由 [to-spec](https://aihero.dev/skills-to-spec) 综合而不重新采访。近邻是无仓库、无文件的同类采访 [grill-me](https://aihero.dev/skills-grill-me)，以及它驱动的术语表与 ADR 约束 [domain-modeling](https://aihero.dev/skills-domain-modeling)；两者都用 [grilling](https://aihero.dev/skills-grilling) 采访原语。上游 [wayfinder](https://aihero.dev/skills-wayfinder) 映射一个会话容不下的工作，可把部分地图交回这里。不确定时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
