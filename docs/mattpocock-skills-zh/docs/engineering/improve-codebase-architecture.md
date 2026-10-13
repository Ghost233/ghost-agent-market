## 它的作用

`improve-codebase-architecture` 调查代码库中的**深化机会**：浅模块（接口几乎与所隐藏的内容同样复杂）可以成为深模块的位置。它写成自包含 HTML 报告，再对你选中的一项进行[追问](https://www.aihero.dev/ai-coding-dictionary/grilling)。

它从不改代码。整轮产生对话和操作系统临时目录中的一个 HTML 文件。之后在独立[会话](https://www.aihero.dev/ai-coding-dictionary/session)通过正常构建流程重构。因此它是调查工具，而非重构工具，可以用于尚不准备修改的代码库。

两项筛选防止报告变成通用清理建议。首先每个候选必须通过**删除测试**：删除模块后，复杂度会移到更小接口后面，还是散布到调用者？只有前者得到卡片。其次除非指定区域，它先读近期提交历史，重点扫描频繁变动路径。没人碰的代码深化不会收回重构成本。

## 何时使用

输入 `/improve-codebase-architecture`；[代理](https://www.aihero.dev/ai-coding-dictionary/agent)不会自行使用。

它不属于主构建循环。定期运行，把改善代码库的工作排入队列。常见四种情况：

| 情况 | 用法 |
| --- | --- |
| 日常维护 | 每几天或空闲时运行，避免功能之间结构退化。 |
| 大规模构建前 | 指向[规格](https://www.aihero.dev/ai-coding-dictionary/spec)，问“怎样让这次变更容易？”这是最有效的提示。 |
| 已有项目审计 | 对大型、无结构或[凭感觉编码](https://www.aihero.dev/ai-coding-dictionary/vibe-coding)的仓库运行，了解状态。 |
| 遗留测试工作 | 为无法测试的代码编测试前，寻找缺失接缝。 |

与同类的分界：

- 已选定模块，需要设计它时，用 [codebase-design](https://aihero.dev/skills-codebase-design)。这里寻找模块，`codebase-design` 负责设计。
- 一个会话容不下整个工作时，用 [wayfinder](https://aihero.dev/skills-wayfinder)。
- “这个具体东西坏了”，用 [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs)。发现没有好接缝锁定缺陷时，它会引导你回来。

## 前提条件

没有。已有 `GLOSSARY.md` 或 `docs/adr/` ADR 时，它读取并使用领域名词。候选会写为“深化 Order 接入模块”，而非“重构 FooBarHandler”。

它写入两处。报告在仓库外 `<tmpdir>/architecture-review-<timestamp>.html`。追问期间添加或打磨 `GLOSSARY.md` 术语，不存在则创建。它也提议把被拒候选记录为 ADR，避免下次再次建议。

## 深度与寻找深度的报告

核心是**深度**。深模块在小而稳定接口后藏大量行为；浅模块的接口几乎与内部代码一样宽，暴露实现。报告寻找三种浅层形态：

- 纯粹为可测试性抽出的纯函数，真实缺陷却在调用者用法中（没有**局部性**）。
- 穿过**接缝**泄漏的模块。
- 不打开五个文件就无法理解的概念。

每项都提出能解决问题的深化。

每个候选卡片包含相关文件、阻力、通俗方案、以**局部性**与**杠杆作用**描述的收益、前后图，以及强度标记。

| 标记 | 对你的含义 |
| --- | --- |
| `Strong` | 明确通过删除测试，阻力真实，认真考虑。 |
| `Worth exploring` | 深化合理，但收益取决于代码下一步方向。 |
| `Speculative` | 为完整性纳入，多数可忽略。 |

报告最后给出 **Top recommendation**，即它最先选择的候选。随后停下询问你想探索哪项。此时尚无决策，代码未改变。

## 选中之后

选候选后进入 [grilling](https://aihero.dev/skills-grilling)，讨论约束、接缝后藏什么、哪些测试保留、深化接口形状。产出是决策，不是差异。随后正常流程：决策交 [to-spec](https://aihero.dev/skills-to-spec)，再 [to-tickets](https://aihero.dev/skills-to-tickets)，再 [implement](https://aihero.dev/skills-implement)。

## 常见问题

**它围绕一个想法追问一小时，没有展示选项，能关闭吗？**

可以，调用时说“不要追问，只展示报告”。这是最常见批评。一位用户原本觉得能便捷获得全面改善分析，加追问循环后几乎无法使用：仅一个方案，却问几十上百个问题。设计意图是先报告，仅对你选中候选追问。但较弱[模型](https://www.aihero.dev/ai-coding-dictionary/model)直接采访首个想法，帖中结果随模型差异很大。问题尚未关闭，skill 未提供有文档的免追问模式。

**报告打开成无样式原始 HTML，没有图。**

它从 CDN 加载 Tailwind 与 Mermaid，打开时需联网。脚本被拦就无报错损坏。报告案例中安全 hook 要求 SRI 哈希，代理加了，但 CDN 给浏览器与用于计算哈希的 `curl` 返回不同字节，浏览器因此阻止脚本。离线与严格环境一样有问题。代理没渲染页面，看不到。可要求内联 CSS 与手工 SVG，替代 CDN。此 issue 尚未关闭。

**十二个候选，要同会话做完还是新建？**

每会话一项。同一对话做多项会让[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)同时塞满报告、追问、领域编辑和代码变更。报告只是临时文件，向后传递候选而非文件。选一项、追问、决策交 `/to-spec`；其余变成以后独立处理的[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)。选中改善先写规格，不直接实施。这个问题常被问，skill 没有记录对应工作流。

**该怎样提示？**

结合下一件要构建的东西。大构建前指向规格，问“怎样让这次变更容易？”无提示会自行找热点，适合日常维护，但方向使报告可执行。

**大型遗留代码库可用吗？**

部分可用。对缺乏一致结构的大型现有代码库效果好，也是一次性结构设置后的推荐维护工具。但失控项目用户报告帮助有限、不够解决。一位八年遗留项目开发者说模型绕圈，同样 skill 在整洁仓库能生成清晰图。此情况暂无专门 `/refactor`。无共享词汇时先 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 建立，通常能明显改善结果。

**与 `/codebase-design` 区别？**

`/codebase-design` 是参考，不是会话驱动，提供 module、interface、depth、seam、adapter、leverage、locality 词汇，本 skill 使用它。给新代理直接指定 `/codebase-design` 会产生已知失败：无流程就编造流程、重新探索代码、很久才提问。运行本 skill，让它使用那个。

**它会说代码库没问题吗？**

很少，应事先知道。skill 为输出发现而存在，倾向产生候选，而非结论无问题。用强度标记校正：全是 `Speculative` 就等于没找到问题。

**Codex 或其他运行框架可用吗？**

部分可用。探索步骤直接指定 Claude Code 的 `Agent` 与 `subagent_type=Explore`。没有此工具的[运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)可能跳过并行探索，而不使用自身等价能力。仍能运行，但调查不够全面。框架中立改写已提议，尚未合并。

**实际如何在 TypeScript 实现深模块？**

skill 没提供好答案。人们常要求含具体文件与模块布局的 `TYPESCRIPT.md`，但不存在。它说明深化位置、接缝后内容，包或目录结构需自己转换。

## 正常工作的表现

- 候选以领域概念命名：“Order 接入模块”，而非虚构类名“FooBarHandler”。
- 候选在最近编辑的文件，而非无人触碰的区域。
- 运行中代码未改，唯一新文件是临时目录 HTML 报告。
- 报告后停下问你选哪项，不自动继续。
- 各卡片以局部性或杠杆作用解释收益，说明哪些测试更简单，而不只“更干净”。
- 因长期理由拒绝候选时，提议记录 ADR，免得下次再提。

## 它在流程中的位置

`improve-codebase-architecture` 是**定期维护**。每几天在链外运行，排队工作而非实施。邻居：

- [codebase-design](https://aihero.dev/skills-codebase-design) 拥有候选使用的深度与接缝词汇。
- [grilling](https://aihero.dev/skills-grilling) 在选中后遍历决策树。
- [domain-modeling](https://aihero.dev/skills-domain-modeling) 决策时保持 `GLOSSARY.md`、ADR 最新。

产出是想法，从 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 或 [to-spec](https://aihero.dev/skills-to-spec) 回到主构建流程。主流程尾部对应工具为 [retro](https://aihero.dev/skills-retro)：这里改善代理工作的代码，`retro` 在构建后改善外围环境（检查、规范、引导文件）。不确定用哪个时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
