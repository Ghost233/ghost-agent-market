## 它的作用

`codebase-design` 固定设计模块时使用的词语：**模块（module）**、**接口（interface）**、**深度（depth）**、**接缝（seam）**、**适配器（adapter）**、**杠杆作用（leverage）**、**局部性（locality）**。它精确定义各词，禁止宽泛替代词（“component”“service”“API”“boundary”），并列出由此推导的少量原则。

它是参考，而不是流程。不运行循环、不产生工件，也不会停下提问。所有涉及设计的其他 skills 都使用其词汇。单独调用时，它给出词语后就停止。调用前应清楚这一点。如果把[会话](https://www.aihero.dev/ai-coding-dictionary/session)交给一个没有流程和停止规则的 skill，只说“开始”，代理就会编造流程。下面的问题展示其后果。

## 何时使用

输入 `/codebase-design`，或设计任务适合时，由代理自动使用。

已经知道要重设计哪段代码，需要思考其形状时使用：接缝放在哪里、接口能有多小、抽取是否减少调用者的复杂度。也可用来厘清设计词语含义的争论。

几个 skills 与它相近，按问题选择：

| 问题 | skill |
|---|---|
| 一个模块的形状：接口、接缝、深度 | `codebase-design` |
| *领域用词*：“account”有三种含义，两人对“cancellation”理解不同 | [domain-modeling](https://aihero.dev/skills-domain-modeling) |
| 尚不知道该重设计*哪个*模块 | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture)，调查并寻找候选 |
| 希望质疑设计，而不只为它命名 | [grilling](https://aihero.dev/skills-grilling) |
| 要实现具体行为，希望测试经得起重构 | [tdd](https://aihero.dev/skills-tdd) |

## 词汇

术语表就是这个 skill。它参照其他词定义每个词，并给出替代的旧称。

| 术语 | 含义 | 不要称作 |
|---|---|---|
| **模块（Module）** | 任何具有接口与实现的东西。有意不限定规模：函数、类、包、跨层切片。 | unit、component、service |
| **接口（Interface）** | 调用者为正确使用而必须知道的一切：类型签名、不变量、顺序约束、错误模式、必需配置、性能特征。 | API、signature |
| **深度（Depth）** | 接口的杠杆作用：调用者或测试每学习一单位接口，可执行多少行为。**深**：小接口后藏着大量行为。**浅**：接口几乎和实现一样复杂。 | 无 |
| **接缝（Seam）** | Michael Feathers 的术语：无需编辑该位置，就可改变行为的位置。它是接口的*位置*；放在哪里是一项独立决策，与其后放什么分开。 | boundary |
| **适配器（Adapter）** | 在接缝处满足接口的具体东西。描述角色，而非事物种类：内存 fake 与 Postgres repository 都是适配器。 | 无 |
| **杠杆作用（Leverage）** | 调用者从深度得到的好处：每学习一单位接口，获得更多能力。 | 无 |
| **局部性（Locality）** | 维护者从深度得到的好处：变更、缺陷、验证留在一处，一次修复覆盖所有调用者。 | 无 |

skill *没有*采用 Ousterhout 的“实现行数与接口行数之比”作为深度定义。该指标奖励填充实现，因此这里用杠杆作用定义深度。

## 四项原则

- **深度是接口的属性，而非实现的属性。** 深模块内部可由小而可替换的部分构成，调用者看不到它们。模块可有自身测试使用的内部接缝，以及位于接口处的一个外部接缝。
- **删除测试。** 想象删除模块。若复杂度消失，它只是透传层；若复杂度重新出现在 N 个调用者中，它隐藏了真实复杂度。
- **接口就是测试面。** 调用者与测试跨越相同接缝。如果想测到接口*后面*，模块形状就不正确。
- **一个适配器表示假想接缝，两个表示真实接缝。** 在接缝两侧确有变化之前，不要切出接缝。单适配器接缝只是间接层。

两个支持文件进一步说明，skill 按需读取，而不预先全部加载。[DEEPENING.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DEEPENING.md) 将候选依赖分为四类（进程内、本地可替代、远程但自有、真正外部），因为类别决定如何跨接缝测试深化后的模块。[DESIGN-IT-TWICE.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DESIGN-IT-TWICE.md) 启动并行[子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)，为同一模块生成至少三个截然不同的接口，再按深度、局部性与接缝位置比较。

## 常见问题

**实际如何在 TypeScript 构建深模块？**

这是最常见的问题，但 skill 不回答。它定义深模块*是什么*，没有说明如何阻止意外导入绕过接口。[Issue #458](https://github.com/mattpocock/skills/issues/458) 直言：即使满意接口、细节也已隐藏，如何强制执行？没有 lint 或明确护栏，人类与 LLM 都会逐渐把它搞乱。帖子答复给出三项：用类或 IIFE 包裹并接受巨大类；做成 monorepo 中的包并接受其工具链；用 [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 等 linter 禁止绕过接口的导入。这些机制中 Effect 最好，dependency-cruiser 其次。仓库 `in-progress/` 中有 `setup-ts-deep-modules`，规定 `src/packages/<name>/index.ts`，但它处于 beta 渠道，没有文档页，也不附带 lint 规则。

**我把会话指向它，它花了十万 [tokens](https://www.aihero.dev/ai-coding-dictionary/token) 重设计我没要求的东西。**

这是 [issue #449](https://github.com/mattpocock/skills/issues/449) 记录的已知问题。skill 由模型调用，自称词汇参考，却没有硬性阻止代理将它当作可运行流程。收到“在 /codebase-design 中继续并推动未决事项”后，代理选择最像流程的部分：`DESIGN-IT-TWICE.md` 的并行子代理。它重新探索前一会话已映射的代码，工作很久才提问。因为是参考，它没有驱动型 skill 的护栏（检查点、一次一个问题、禁止自动推进）。绕过办法是调用驱动型 skill（`/grill-with-docs`、`/improve-codebase-architecture` 或 `/tdd`），让 `codebase-design` 提供词汇。issue 仍未关闭。

**`design-an-interface` 去哪里了？有 `/interface-design` 吗？**

本 skill 替代了 `design-an-interface`，接收全部内容，没有遗漏。其“设计两次”技巧（来自 Ousterhout，用并行子代理生成截然不同设计）以 `DESIGN-IT-TWICE.md` 发布。另有多人要求专门体现深模块与薄接口理念的 `/interface-design`；这里已覆盖该理念，不计划另设 skill。寻找这两个名称时，就是本页。

**它是否是文件结构惯例，例如目录、barrel files、功能切片？**

不是。人们多次质疑，skill 没有改变。[Issue #95](https://github.com/mattpocock/skills/issues/95) 提议用正式的分形树文件结构具体实现深模块；答复是两者独立：深模块关乎接口设计与通过严格接口访问，文件系统什么样都可以；这种文件结构也完全可能产生浅模块。#458 同样指出，不应把模块概念过度绑到文件系统；文件系统可提示模块形状，但构建深模块不必依赖它。术语表有意把**模块**定义为不限规模。

**`tdd` 真会使用这套词汇吗？**

现在会，过去很长时间不会。v1.0 从 `tdd` 移除内联深模块说明，改用共享 skill，却未补链接，于是 `tdd` 自行定义“seam”，不引用任何东西。现在 `tdd` 已有链接；开放问题在接口形状而非测试时，代理会跟随链接。`tdd` 仍负责作为*测试*边界的“seam”，这里负责其后的模块形状。

**设计两次模式在 Claude Code 之外可用吗？**

不够顺畅。`DESIGN-IT-TWICE.md` 写着“使用 Agent 工具并行派发至少 3 个子代理”，而“Agent”是 Claude Code 的[工具](https://www.aihero.dev/ai-coding-dictionary/tool)名。仓库为包括 Codex 的其他[运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)提供元数据，但那些框架可能没有此名工具。因此并行设计阶段的可移植性低于元数据给人的印象。[Issue #564](https://github.com/mattpocock/skills/issues/564) 正在跟踪，尚未关闭。

**能添加自己的概念，如 connascence、模块秘密、[渐进披露](https://www.aihero.dev/ai-coding-dictionary/progressive-disclosure)吗？**

已有提议。[Issue #180](https://github.com/mattpocock/skills/issues/180) 附可用差异，加入 Parnas 的模块秘密与 Page-Jones 的 connascence，为跨接缝泄漏的*内容*命名；[issue #303](https://github.com/mattpocock/skills/issues/303) 提议实现内部的渐进披露，让公共接口深的模块内部也有结构。两者均未关闭、未合并。已发布术语表有意保持小规模；skill 说明，语言一致是全部目的，一个无人一致使用的词比没有词更糟。

## 正常工作的表现

- 设计讨论停止使用“component”“service”“boundary”，开始使用“module”“interface”“seam”。
- 有人能明确判断抽取建议是否通过删除测试。
- 提议接缝时同时指出第二个适配器，而不只第一个。
- 接口讨论涵盖不变量、顺序与错误模式，而不只类型签名。
- 调用它不会开始工作会话。代理仅凭 `/codebase-design` 就读文件、提议重构时，是把参考当成了驱动工具。

## 它在流程中的位置

`codebase-design` 是**随时可用的独立工具**，处于工程 skills 的底层词汇层，而不是某条链的一步。最近的邻居是 [domain-modeling](https://aihero.dev/skills-domain-modeling)，它为*问题领域*的用词而非模块形状提供并列参考。通常两者一起需要，因为给深模块取好名字需要双方。[improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 是另一个邻居：它寻找深化候选，并用本术语表描述每个候选，因此它找到模块，你用这里的词设计模块。不确定哪个 skill 或流程适合时，[ask-matt](https://aihero.dev/skills-ask-matt) 为你路由。
