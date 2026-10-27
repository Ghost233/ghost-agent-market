## 它的作用

`domain-modeling` 在设计期间建立并打磨项目的**通用语言**。它质疑与术语表冲突的词，在你用词模糊时要求精确词语，用具体场景检验关系，直到边界准确。

它是**主动**约束，而非被动参考。任何 skill 都能读 `GLOSSARY.md` 借用词汇；本 skill 用于*改变*模型，所以会打断你。它在词语确定的当下、对话中途写入 `GLOSSARY.md`，而非最后输出整齐术语表。最后才写的术语表是[会话](https://www.aihero.dev/ai-coding-dictionary/session)摘要；即时写入的版本是会话产出。

## 何时使用

输入 `/domain-modeling`，或任务适合时代理自动使用。实际中自动调用是最弱的一环。`grill-with-docs` 或 `wayfinder` 要求加载时，[模型](https://www.aihero.dev/ai-coding-dictionary/model)经常只加载 `grilling` 而跳过它。一次[追问](https://www.aihero.dev/ai-coding-dictionary/grilling)结束后 `GLOSSARY.md` 没变化，就意味着发生了这种情况。与另一个 skill 一起明确点名调用。

当问题在*词语*时使用：

| 情况 | 做法 |
| --- | --- |
| 两人对“cancellation”理解不同 | `domain-modeling`：选标准词，把另一个列入 `_Avoid_` |
| “Account”在三个文件承担三个职责 | `domain-modeling`：拆为 Customer 和 User |
| 刚做出难以撤销的架构选择 | 达到门槛时，`domain-modeling` 提议写 ADR |
| 问题在模块*形状*：接缝位置、接口深度 | [codebase-design](https://aihero.dev/skills-codebase-design) |
| 构建前希望盘问整个计划 | [grill-with-docs](https://aihero.dev/skills-grill-with-docs)，在底层驱动本 skill |
| 只想查询词，而非改变 | 无需 skill。读取 `GLOSSARY.md`，它就是一个文件。 |

## 前提条件

无需预先准备。skill 写入两处，按需创建：

- 仓库根的 **`GLOSSARY.md`**。首个词确定时创建。有根目录 `GLOSSARY-MAP.md` 时，写入其指向的各上下文 `GLOSSARY.md`。
- **`docs/adr/`**。首个达到门槛的 ADR 出现时创建。

开始前不用已有文件，skill 也不预先创建。

## 两种工件、两种门槛

术语表与 ADR 门槛不同。多数问题来自混淆两者。

| | `GLOSSARY.md` | `docs/adr/NNNN-slug.md` |
| --- | --- | --- |
| 内容 | 词语。一两句说明事物**是什么**，被舍弃的同义词放在 `_Avoid_` | 一项决策，一至三句：背景、选择、理由 |
| 写入门槛 | 模糊词成为标准词 | **三项同时满足**：难以撤销、缺少背景时令人意外、真实权衡的结果 |
| 写入时间 | 词确定时即时写入 | 提议，而非擅自假定 |
| 绝不放入 | 实现细节、[规格](https://www.aihero.dev/ai-coding-dictionary/spec)、草稿笔记、一般编程概念 | 本会话所有选择的日记 |

ADR 三项测试缺任何一项都不写。容易撤销的选择直接撤销即可；不意外的选择没人会问；没有真实替代方案，只是在记录显然该做的事。

`GLOSSARY.md` 规则最重要，因为实际经常失守。**它只是一份术语表。** 不加约束时，模型把“写入 `GLOSSARY.md`”当作保存你每个回答的许可，文件会变成持续增长的规格。这是跨模型报告最多的问题。

## 交叉核对的范围

你说明行为时，skill 检查代码并指出矛盾。*“代码取消整个 Order，但你刚说允许部分取消，哪个正确？”* 修改任何一方之前，它先公开让语言与代码达成一致。

它只核对**代码**与已提交的 `GLOSSARY.md`、ADR，不搜索工单跟踪器。如果团队数月前已在关闭 issue 里解决命名冲突，它会当作新问题再次提出。[相关请求](https://github.com/mattpocock/skills/issues/717)尚未关闭。暂时可把要求写进 skills 已会读取的 `docs/agents/domain.md`。

## 常见问题

**我的 `GLOSSARY.md` 有 500、1,000、3,000 行，怎么办？**
体积是症状，原因是混入了实现细节与不属于术语表的决策。直接要求：`/grill-with-docs make my GLOSSARY.md more concise and remove any implementation details from it`。大部分膨胀内容会移除。只有文件已精简、仍涵盖读者不愿同时记住的两个领域时，才用 `GLOSSARY-MAP.md` 拆分。拆膨胀文件只会得到多个膨胀文件。skill 目前指引不足以预防增长，跟踪 issue 仍未关闭。

**为何叫 `GLOSSARY.md` 而不是 `CONTEXT.md`？**
在 1.3.0 之前，它叫 `CONTEXT.md`（及 `CONTEXT-MAP.md`）。文件只是一份术语表，`GLOSSARY.md` 更准确；一位读者说，“对 AI 代理，一切都是[上下文](https://www.aihero.dev/ai-coding-dictionary/context)”。如果仓库仍有 `CONTEXT.md`，重新运行 `/setup-matt-pocock-skills`：它会提议用 `git mv` 重命名，并更新 `docs/agents/domain.md`。整套 skills 都查找 `GLOSSARY.md`，保留旧名称就需要逐一修改。

**`/ubiquitous-language` 去哪里了？**
它被移除，而非弃用。职责进入 `domain-modeling`，持续维护完整模型，而不从一次对话导出术语表。词汇约束如今更重要。在追问、分诊、映射底层运行，不再是要另外记得执行的步骤。

**没有术语表的代码库怎样获得一份？**
明确提出，不要等它积累。文档给出的路线是 `/grill-with-docs help me scaffold my existing repo with a GLOSSARY.md`。预期会有很长的盘问；一位用户报告超过 50 个问题。偶尔使用在已有代码库上积累得太慢。

**能保留领域模型、使用自己的 ADR 格式吗？**
目前不顺畅。术语表与 ADR 在同一个 skill，已有 ADR 惯例的团队（不同模板、位置、命名）会遇到与自身风格冲突的指令。只能复制 skill 到本地修改，或在仓库代理文档覆盖 ADR 惯例。[拆分请求](https://github.com/mattpocock/skills/issues/557)仍未关闭。

**术语表值得维护吗？它多了一份要审查且可能过期的工件。**
有时不值得。DDD 越接近实现越不实用；收益在前端命名与概念对齐，而非聚合和分层仪式。同义词控制在命名边界很重要：模块名、表名、状态枚举、issue 标题、CLI 命令；普通文字中则小得多。还有反对意见认为，领域术语压缩了共享理解的人类*之间*的沟通，代理对普通语言说明反应一样。如此，术语表的价值是让你与审查者理解代理在做什么，而非增强代理。一天的构建可跳过。未经审查、代理编写的术语表比没有更糟：它充满自信断言，后续会话当作真相。

**能替我把模糊提示转成领域语言吗？**
不能，也不计划开发这样的 skill。自己不懂的领域语言，写下来也无意义。它在你理解之后要求精确，不发明你没有的词汇。另一陷阱是不建模就使用领域词：错误概念加正确名词会让输出看似正确，实则不然。

## 正常工作的表现

- 话说一半就打断，询问两种含义是哪种，而不自行选择继续。
- `GLOSSARY.md` 在对话**期间**变化，而非最后集中写入。
- 对明天就能撤销的选择拒绝写 ADR，并说明哪项测试未通过。
- 新条目用一两句定义事物*是什么*，在 `_Avoid_` 列出放弃的词。
- 代码与你的话不一致时，引用代码指出。
- `GLOSSARY.md` 缩短的频率与增长一样高。

## 它在流程中的位置

`domain-modeling` 是**模型调用的参考 skill**，通常在其他 skills *底层*运行，多于单独运行。[grill-with-docs](https://aihero.dev/skills-grill-with-docs) 在追问期间驱动它，[wayfinder](https://aihero.dev/skills-wayfinder) 制图时加载它，[triage](https://aihero.dev/skills-triage) 用它让[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)使用项目词汇，[improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 在决策确定时调用。最近的同类是 [codebase-design](https://aihero.dev/skills-codebase-design)：两者构成底层词汇层，这个负责*领域*，另一个负责模块*形状*。也可直接调用，获得这项约束而不进入通常加载它的 skill 流程。不确定时，[ask-matt](https://aihero.dev/skills-ask-matt) 为你路由。
