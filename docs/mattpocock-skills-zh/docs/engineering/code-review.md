## 它的作用

`code-review` 沿两个维度审查 `HEAD` 与你指定的固定点（提交、分支、标签、`main`、`HEAD~5`）之间的差异。**Standards（规范）**检查代码是否遵循本仓库的写法。**Spec（规格）**检查代码是否实现来源 issue 或[规格](https://www.aihero.dev/ai-coding-dictionary/spec)的要求。每个维度由独立[子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)执行，互不读取对方的推理。

这个 skill 从不合并两个维度，也不对它们重新排序。报告最后分别给出*每个维度*最严重的问题，不选出跨维度的单一胜者。变更可以通过一个维度而未通过另一个。遵循所有惯例却实现了错误功能的代码通过 Standards、未通过 Spec；完全实现[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)却破坏仓库惯例的代码正好相反。混合结论会让通过的维度掩盖未通过的维度。

## 何时使用

输入 `/code-review`，或在要求审查分支、PR、进行中的工作，或“自 X 以来”的变更时，由代理自动使用。

| 你的情况 | 使用什么 |
| --- | --- |
| 已有差异，需要知道实现是否正确、实现的东西是否正确 | `code-review` |
| 想在差异中寻找缺陷：空值路径、竞态、差一错误 | Claude Code 自带的审查，见下面的命名冲突说明 |
| 尚未编写代码，希望测试先行 | [tdd](https://aihero.dev/skills-tdd) |
| 要实施完整规格，包括审查 | [implement](https://aihero.dev/skills-implement)，它会自行调用本 skill |
| 整个代码库发生偏移，而非单次差异 | [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) |
| 某处损坏，不知道原因 | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |

必须提供固定点。未提供时，skill 会询问，而不猜测。派发前会检查 ref 能否解析、差异是否非空，分支名拼错会直接在你面前失败，而不是在两个子代理内部失败。

## 前提条件

Standards 维度没有前提条件。它读取仓库已有文档（`CODING_STANDARDS.md`、`CONTRIBUTING.md` 等），没有文档时使用内置基线。

Spec 维度要求规格存在且能找到。按以下顺序寻找：

1. 提交消息里的 issue 引用（`#123`、`Closes #45`、GitLab 的 `!67`），通过跟踪器文档获取。
2. 你作为参数传入的路径。
3. `docs/`、`specs/` 或 `.scratch/` 下与分支或功能名匹配的规格文件。
4. 询问你。

第 1 步依赖 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 编写的跟踪器文档。没有它时，传入路径仍可运行。完全没有规格时，跳过 Spec 子代理，报告“没有可用规格”，不会编造需求。

## 两个维度

| | Standards | Spec |
| --- | --- | --- |
| 问题 | 实现方式是否正确？ | 实现的东西是否正确？ |
| 读取 | 仓库成文规范与代码异味基线 | 来源 issue 或规格 |
| 报告 | 成文规范违规（可能是硬性违规），以及异味（始终是判断） | 缺失或部分实现的需求、范围膨胀、错误实现的需求 |
| 每项发现引用 | 规范文件与规则，或异味名称及差异块 | 规格中的具体行 |

这种设计避免了不懂你规范的通用审查 skill。通用审查会把代码库有意采取的设计标为问题，却漏掉它依赖的不变量。因此仓库文档是 Standards 维度的[一手来源](https://www.aihero.dev/ai-coding-dictionary/primary-source)，**始终以仓库为准**。

**异味基线**位于仓库规范之下，采用 Fowler《重构》第 3 章的十二种代码异味：Mysterious Name（神秘命名）、Duplicated Code（重复代码）、Feature Envy（依恋情结）、Data Clumps（数据泥团）、Primitive Obsession（基本类型偏执）、Repeated Switches（重复的 switch）、Shotgun Surgery（霰弹式修改）、Divergent Change（发散式变化）、Speculative Generality（夸夸其谈通用性）、Message Chains（消息链）、Middle Man（中间人）、Refused Bequest（拒绝遗赠）。每种都标为启发式判断（“可能存在 Feature Envy”），绝不当作硬性违规。每种说明异味是什么、如何修复，因此发现附带修复办法，而不只有抱怨。两个维度都跳过 linter 已强制执行的内容。

## 常见问题

**与 Claude Code 自带的 `/code-review` 冲突怎么办？**

这是报告最多、尚未修复的问题。Claude Code 自带 `/code-review` 用于找差异中的缺陷，本 skill 检查规格遵循情况与仓库规范。安装后其中一个会胜出，具体取决于安装方式：

- **插件 marketplace。** 每个 skill 带 `mattpocock-skills:` 前缀，而不带前缀的名字难以访问内置命令。
- **直接安装 skills。** 本地文件优先，本 skill 遮蔽内置命令。

一种办法是彻底移除 Claude Code 内置 skills，可省下大量[上下文](https://www.aihero.dev/ai-coding-dictionary/context)，冲突也不再重要。遮蔽本身也可视为 Claude Code [运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)的缺陷（skill 作者应可自由命名）；另一种办法是重命名本地副本。`npx skills update` 会撤销 frontmatter 修改或目录重命名。用户报告的持久办法是派生一个新名称的 skill，并从托管集合移除 `code-review`。记录派生时的提交，方便手工重新同步。

**它的子代理不断再次调用 `/code-review`，派发更多代理。**

这是尚未关闭的已知缺陷，多人已在多个运行框架复现。Standards 与 Spec 提示不禁止委派，因此子代理能再次发现 skill，再次扩散。一份报告超过 50 个代理。用户在 fork 中采用的修复是给两个子代理任务都追加：“不要调用 `/code-review` 或派发更多代理；直接执行本次审查。”有人更愿意在运行框架层处理，让所有 skills 继承保护。目前发布的 skill 未包含任何一种修复。无人值守运行时，注意代理数量。

**应该在编写代码的同一[会话](https://www.aihero.dev/ai-coding-dictionary/session)运行吗？**

优先使用新会话。一位读者说：“同一上下文审查自身不是审查，而是带斜杠命令的确认偏误。”编写会话内的审查代理拥有形成代码的全部假设，独立审查者没有。这也是有人希望 [implement](https://aihero.dev/skills-implement) 不带内置审查步骤的原因：该步骤在刚写出差异的会话中执行。独立做法是自己从干净会话调用 `/code-review`。

**每张工单之后，还是最后一次？**

两者都可，skill 不替你决定。逐工单审查保持差异足够小，Spec 维度有一份明确规格可比对，这是 `implement` 的模式。在分支末尾批量审查能发现各次逐工单审查漏掉的跨工单相互作用。不确定时，逐工单审查，再以分支起点作一次最终审查。

**可以相信发现的问题吗？**

必须核对。子代理输出是假设，不是证据。一个团队报告，基于文字的审查漏掉了十余项破坏性变更。skill 原样或稍加整理后组合两个报告，不逐项对文件重新验证，因此可能引用错误位置或夸大影响。行动前读取每项引用。skill 要求每项带引用（规范规则、异味及差异块，或规格行），这让发现可以核查。

**为何每次运行都找到新问题？**

每次修复都会加入新代码，而 Standards 维度中依赖判断的部分每次结果不同。一位读者描述：“/code-review 和 /improve-code-architecture 每次都发现新东西。我修复后重跑，又来一遍。”它没有收敛保证。把一次审查当作线索列表，处理有引用规则支持的项，然后停止。不要循环到完全干净，因为永远不会。

**会审查未提交工作吗？**

不会。它比较 `<fixed-point>...HEAD`。三点形式从 merge-base 衡量，排除暂存和工作树变更。`implement` 未做中间提交时，审查看不到即将进入下一次提交的工作。先提交，再审查，然后 amend 或补修复提交。

## 正常工作的表现

- 在派发任何子代理之前，拒绝无效 ref 或空差异。
- 报告分为 `## Standards` 与 `## Spec` 两块，而不是合并列表。
- 每项 Standards 发现指出仓库文件中的规则，或十二种异味之一，并引用差异块；每项 Spec 发现引用规格的一行。
- 结束时分别给出每个维度最严重的问题，不选整体胜者。
- 没有规格时，Spec 块明确说明，而不是列出从代码推断的需求。

## 它在流程中的位置

`code-review` 是构建链尾部的审查步骤：`grill-with-docs → to-spec → to-tickets → implement → code-review → retro`。也可单独用于指定分支或 PR。

- [implement](https://aihero.dev/skills-implement) 是最近的邻居。它推动构建，提交前调用本 skill 作结束审查。[implement-spec](https://aihero.dev/skills-implement-spec) 对整个集成分支执行一次同样的审查。
- [retro](https://aihero.dev/skills-retro) 随后运行并调整它。会话显示审查漏掉一类错误时，`retro` 提议添加检查或 `CODING_STANDARDS.md` 规则，供 Standards 维度读取。
- [pr](https://aihero.dev/skills-pr) 在经过审查的工作上传后编写 PR 正文。
- [to-spec](https://aihero.dev/skills-to-spec) 和 [to-tickets](https://aihero.dev/skills-to-tickets) 生成 Spec 维度对照的文档，因此规格含糊时该维度也含糊。
- [improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 是面向整个代码库的对应工具，本 skill 只看一次差异。

不确定情况需要哪个 skill 时，[ask-matt](https://aihero.dev/skills-ask-matt) 在整套 skills 中路由。
