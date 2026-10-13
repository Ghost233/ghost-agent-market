# 编写文档页面

`engineering/` 和 `productivity/` 中的每个 skill，都有一份面向人类的**文档页面**，位于 `docs/<bucket>/<skill-name>.md`。文档目录与 `skills/` 下这两个分类目录对应，发布到 `https://aihero.dev/skills-<skill-name>`。无论分类是什么，URL 始终是 `skills-<skill-name>`，文档路径只用于组织仓库。页面本身不是 skill，也不是 `SKILL.md` 的副本。只有这两个分类正式发布；其余分类（`misc/`、`in-progress/`、`deprecated/`）不提供文档页面。

这些 skills 大多是**用户调用型**：代理不会替你触发它们，所以**你**充当索引，记住它们的存在和适用时机。这种记忆属于**认知负载**。文档页面的工作是减轻负载：帮助一个读者理解一个 skill，记得它何时有用，并知道它在系统中的位置。所有页面共同构成分布式路由，每个页面是其中一个节点。

正式发布的 skill 新增、改名或行为变化时，都要创建或重新同步它的文档页。改名时也移动文件（`docs/<bucket>/<old>.md` → `docs/<bucket>/<new>.md`），因为发布 URL 跟随名称。Skill 在 `engineering/` 和 `productivity/` 之间移动时，文档也移动到对应目录。`misc/`、`in-progress/` 和 `deprecated/` 中的 skills 不提供页面，因为这些分类均未正式发布。从其中一个分类移入 `engineering/` 或 `productivity/` 的 skill，要增加页面；反向移动时则移除页面。已正式发布的 skill 若彻底删除，其页面以**归档页**保留：正文维持原样，开头增加引用块（`> **Archived.** ...`），写明在哪个版本移除，以及替代 skill，确保发布 URL 仍可访问。

这些页面发布在 `aihero.dev`，因此**所有链接都使用绝对 URL**，不能使用仓库相对路径。指向其他 skill 的链接为 `https://aihero.dev/skills-<name>`；指向仓库内容的链接使用完整的 `https://github.com/mattpocock/skills/...` URL。在仓库中可用的相对链接，发布后会失效。

页面没有 H1，发布页面从 slug 取得标题。

## 页面结构

按以下模板填写，保持顺序。每个页面都包含**固定框架**（`## What it does`、`## When to reach for it`、`## Where it fits`）。`## Prerequisites` 和自由编排的实质内容，只保留该 skill 需要的部分，删去其余部分。

四个章节让页面值得阅读：`What it does`、`When to reach for it`、`Common questions`、`It's working if`。前两节帮助读者理解用途；后两节使页面从概述 skill 转向回答读者自身的处境。后两节各有下面说明的标准。两者都未达到标准的页面，应视为未完成，而不是已完成但简短。

**页面不包含安装命令。** ai-hero 的页面模板会在正文上方渲染安装组件，包括复制按钮、单 skill 命令、整套安装命令和更新说明。页面再写这些内容，会让读者看到两次相同命令，也会造成两份内容漂移：每页手写的命令对曾经落后于旁边的组件。安装用语属于网站，而非页面。需要变更时，修改 ai-hero；统一措辞保存在[安装说明块](./install-block.md)。

<page-template>

## What it does

一至两段普通说明。开头用一句话说明 skill 的工作，再写明**决定其行为的约束**：让它的行为区别于通常默认做法的唯一事实。例如 `to-spec` 不再次采访用户，而是综合已经知道的内容。写成普通陈述句，不用“定义性约束：”或“关键点：”这类带标签的插入说明，这种公式像填充文字。这句话是全页最有价值的一句，绝不能省略。

## When to reach for it

说明如何、何时使用该 skill，分为两个几乎总要出现的部分：

- **调用方式。** 说明是你输入名称，还是代理触发。用户调用型 skill：“输入 `/<name>` 来调用，代理不会自主使用它。”模型调用型 skill：“输入 `/<name>`，或在任务符合时由代理自动使用。”
- **触发边界。** 索引条目：“……时使用”。若容易与相邻 skill 混淆，再写出另一侧：“需要 <X> 时，改用 [<sibling>](https://aihero.dev/skills-<sibling>)。”

## Prerequisites

可选：只有 skill 必须先准备某些条件才能工作时才包含，否则连标题一并省略。涵盖**写入的工作区**，例如有状态的 `grill-with-docs` 写入 `GLOSSARY.md` 和 ADR，`teach` 构建整个目录，所以需说明写什么、写到哪里；也涵盖**前置初始化**，例如 `triage`、`to-spec`、`to-tickets` 需要 `setup-matt-pocock-skills` 配置 issue tracker；以及**仓库特定工具**。无状态、处处可运行的 skill 没有前提，应删除该节。

## <自由编排的中间部分>

一至三个短节，使用 skill **自身的词汇**，让读者理解它。可按 skill 选择标题：执行的循环、生成的产物、采用的分支，或消除的某个反模式。Skills 差异很大，所以不规定统一标题。

唯一不可协商的要求是：**突出 skill 的引导词或定义性概念**，例如 `tight` 反馈循环、`deep module`、用可丢弃代码回答问题、红—绿。它有两次收益：读者理解 skill **是什么**，也学会以后用来想到并**使用**它的词。

## Common questions

读者确实会问的有关此 skill 的问题，每个问题用粗体，答案放在下面。不使用小标题。

观察到的真实问题总比编造的问题好。动笔之前先去查找：

- **Wiki。** 若本机有 `~/repos/matt/personal-wiki`，它是最丰富的来源。其 `wiki/audience/` 按受众想要什么、讨论什么、以及**困惑什么**组织。先读 `wiki/index.md` 的页面登记表，再读与该 skill 有关的页面。每页的 `sources:` 都回链到原始 X、Discord、GitHub 和邮件讨论。Wiki 是二手来源，因此引用提问者自己的问题，而不是 Wiki 的概述。目录不存在时跳过这一项。
- **本仓库 issues。** `gh issue list --repo mattpocock/skills --search "<skill-name>" --state all`。同一个问题被提出两次，页面就应回答它。
- **`CHANGELOG.md`。** 改名、移动或行为变化都会产生“它去哪了？”这类问题，页面必须回答。

找到的问题很少时，本节也可加入读者显然会问的问题，但**数量必须符合证据**。讨论充分的 skill 可以有六个；少有人讨论的 skill 可以只有一两个，甚至一个都没有。给内容稀少的 skill 硬凑问题，以匹配内容丰富的页面，只会填入无人关心的问题；编造的问题不能教给读者任何东西。

按出现频率排序，把最直接的问题放前面。事实不讨喜也要说：grilling 会话很长，通常是范围过大；让模型编写自己的 skill，往往产生冗长内容。没有值得回答的问题时，省略标题。

## It's working if

用几个条目说明 skill 发挥作用时，读者会看到什么。每条的标准是：无需打开 `SKILL.md`，读者就能验证，信号来自自身工作或眼前的执行记录。“文档越完善越短”符合要求；“库章节与 `template.sh` 逐字节相同”是检查 skill 内部合规性的要求，只是套了本节标题。有明确迹象就写；迹象仍含糊时省略标题。

## Where it fits

始终包含此节，用一至两句话说明 skill 在系统中的位置：

- **角色。** 明确命名：**流程步骤**（`grill-with-docs → to-spec → to-tickets → implement → code-review`）、**一次性初始化**（`setup-matt-pocock-skills`）、**定期维护**（`improve-codebase-architecture`，“每隔几天”），或**随时可用的独立工具**（`diagnosing-bugs`、`prototype`、`handoff`）。独立 skill 的位置用一句诚实说明即可，这比省略本节好。
- **相邻工具。** 一两个最相关的同类 skill，分别说明原因，并使用绝对链接。
- **全图。** 链接到整个集合的路由 [ask-matt](https://aihero.dev/skills-ask-matt)，让该页始终只做节点，无需重新画完整关系图。

</page-template>

## 约定

- 解释**为什么**，而非操作过程。页面帮助读者理解并定位 skill，不复述 `SKILL.md` 的步骤，也不整段倾倒模板。选择工具的人不需要操作手册。
- **绝不提作者名称。** 页面是技术文档，不是谁说了什么的记录。“Matt 说”“Matt 自己的回答”“他的立场是”或引用回复都应删去。查找问题所得的结论值得保留，其作者归属不值得保留。直接陈述有关 skill 的内容，例如“修复方式是直接指令：……”或“划分取决于会话数量”，删去引述框架。读者在决定是否使用工具；观点无论由谁提出，分量相同，带归属的观点则在立场改变后立即过时。引用**用户**仍可，例如“有用户报告……”，这是 skill 在实际使用中的证据，并保持匿名。
- 使用 skill 的**引导词**，例如 _seam_、_deep module_、_tracer bullet_，使页面与 skill 使用同一套语言。
- **[AI Coding Dictionary](https://www.aihero.dev/ai-coding-dictionary) 有对应术语时，使用它的术语，并为页面中的首次出现添加链接。** 该词典是 AI 编程的统一词汇来源，例如 _context window_、_subagent_、_harness_、_primary source_、_agent mode_。优先采用词典用词，不自行创造同义词。每个术语首次出现时，链接到 `https://www.aihero.dev/ai-coding-dictionary/<slug>`。Slug 为小写术语，非字母数字字符换成连字符，例如 _context window_ → `context-window`；后续出现不加链接。只有符合词典含义时才链接：领域 _model_、背景 _context_ 或认证 _token_ 恰好同名，却属于不同词义。标题、代码 span 和已有链接内不加链接；指代本仓库某个 skill 名称而非概念的词也不链接。本机若有 `~/repos/ai/ai-coding-dictionary/dictionary/`，在那里读取完整术语表，每词一文件，文件名就是术语；否则读 [mattpocock/dictionary-of-ai-coding](https://github.com/mattpocock/dictionary-of-ai-coding)，它始终是事实来源。
- **分支放进表格或列表，绝不放进段落。** 页面展示选项时，例如可生成的两种产物、四种触发情景、某个边界的五个选择，读者会扫读，寻找符合自身情况的一行。段落会迫使他们读完才能找到。短 Markdown 表格（左列条件、右列动作）或项目列表能让读者一眼找到。所有出现分支的地方都遵循，最常见于 `## When to reach for it` 和自由编排的中间部分。
- 降低页面自身的负载。它介绍的是低认知负载 skills；多余标题、重复链接等装饰，正是它所反对的内容。

## 完成标准

- 页面存在于 `docs/<bucket>/<name>.md`，改名或移动分类后没有旧页面残留。
- 页面没有源码链接，也没有自行编写的安装命令。
- `## What it does` 以普通说明写出定义性约束，而非带标签的旁注。
- 页面不提作者名称、不引用作者，每个论断都独立成立。
- `## When to reach for it` 写明调用方式和触发边界。
- `## Where it fits` 写明角色，并链接 `ask-matt`。
- 有前提时明确说明工作区、前置初始化或工具要求；无前提时省略本节。
- 中间部分突出引导词。
- 页面使用的每个 AI Coding Dictionary 术语都遵循词典拼法，且仅首次出现链接到词条。
- 每个多选分支均用表格或列表表达，不要求读者读完整段。
- 已查找真实问题，包括 Wiki、issues 和 changelog；`## Common questions` 的数量取决于查找结果，不为匹配内容更丰富的页面而填充。
- `## It's working if` 的每个条目都无需打开 `SKILL.md` 就能验证。
- 章节按模板顺序排列。
- 所有链接均为绝对链接，且可访问。
