## 它的作用

`to-spec` 把刚发生的对话转成**[规格](https://www.aihero.dev/ai-coding-dictionary/spec)**，作为一个 issue 发布到跟踪器。

`to-spec` 不采访。调用时决定已经做完，因此综合已知内容（对话、代码库、`GLOSSARY.md`、ADR），不开始新问题轮次。规格记录已有决策，不是做新决策的地方。

## 何时使用

输入 `/to-spec`；[代理](https://www.aihero.dev/ai-coding-dictionary/agent)不会自行使用。

构建太大、一个代理[会话](https://www.aihero.dev/ai-coding-dictionary/session)容不下，必须跨多个会话时使用。这就是全部触发条件：

| 当前位置 | 运行什么 |
| --- | --- |
| 尚未决定任何事 | 先 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |
| 已决定，一个[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)容得下 | [implement](https://aihero.dev/skills-implement)，跳过规格 |
| 已决定，跨会话 | `/to-spec`，再 [to-tickets](https://aihero.dev/skills-to-tickets) |
| [wayfinder](https://aihero.dev/skills-wayfinder) 地图已清空阻塞 | `/to-spec #<map_issue>` |

## 前提条件

发布为 issue，因此先由 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 配置跟踪器与分诊标签词汇。GitHub 等真实跟踪器或 `.scratch/` 本地 Markdown 均可；后者无需额外配置。

## 规格是决策记录

上下文窗口会结束，所以需要规格。[追问](https://www.aihero.dev/ai-coding-dictionary/grilling)期间确定了方案形状、争论后的选择、有意拒绝内容，都在即将清空的一场对话。规格保存它们。

`to-spec` 不验证也不决定，只用项目词汇记录，让新会话无需你重解释就能接手。规格若陈述你从未说过的内容，就是缺陷。

## 先接缝，后文字

写任何内容前，勾勒测试功能的**接缝**，与你确认。优先已有接缝、选尽可能高的接缝，理想数量为一个。

后续 [tdd](https://aihero.dev/skills-tdd) 只在预先确认接缝工作，[code-review](https://aihero.dev/skills-code-review) 对规格审查，未约定接缝会成为发现。两者都通过本文件连接。因此应在此认真确认，别留给实施。

## 常见问题

**`/to-prd` 去哪里了？**
就是本 skill，在 v1.1 重命名。如今全套统一用 spec，旧 `to-prd` slug 不再有效，要以新名重装。旧词汇由 *spec* 与 *tickets* 替代：规格是终点及固定终点的决策，[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)是抵达步骤。改方向时删除未完工单，保留规格。

**为何规格带 `ready-for-agent`？不想代理直接实施它。**
标签表示无需再分诊，完整到可供代理工作，是输入而非工作命令。但轮询此标签的[无人值守](https://www.aihero.dev/ai-coding-dictionary/afk)代理无法区分，会试图将 `ready-for-agent` 的整份规格一次建完，而不取切片工单。这是报告最多的问题。改变前，在 AFK 提示明确排除父规格，或 `/to-tickets` 运行后移标签。

**为何不从追问直达 `/to-tickets`，跳过规格？**
经常应该跳过。规格仅多会话工作值得，价值在工单可丢弃、规格保留。每张适合新窗口，随后删除或关闭，规格则统一保存理由。单会话没有收益，却增加[模型](https://www.aihero.dev/ai-coding-dictionary/model)可能偏移的综合步骤。追问后直接 `/implement`。

**刚完成 wayfinder 地图，传什么？**
主地图 issue，即 `/to-spec #<map_issue>`，不是单独决策工单。[wayfinder](https://aihero.dev/skills-wayfinder) 的产物是散落地图中的决策，而非交付项，`to-spec` 合成可构建文档。地图直交 `/implement` 会漏掉这步。

**规格给我审查，还是仅给代理？**
主要给代理，因此完整、密集、充满引用。读接缝与范围外部分，这两处现在最便宜捕错、以后最昂贵。有人抱怨整篇阅读，没有摘要模式。但若规格让你意外，是追问太浅，不是规格太长。

**工单启动后冻结规格，还是允许改？**
没有同步机制。它实际是当时知识快照，实施首次教你新东西就过期。交付后视为可丢弃；`GLOSSARY.md` 与 ADR 才应持久。实施学到应长久保留的事写那里，而不是改规格。

**任务是重构或模块边界，不是功能，模板适合吗？**
不太适合，是已知限制。模板强依赖用户故事，架构工作不合，会围绕实际接口与不变量写没人要的故事。改用 implementation-decisions、testing-decisions 部分。持久架构决策经 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 记 ADR，不记规格。

**会搜索相关工单，或引用遵循的 ADR 吗？**
两者都不。读并遵循涉及区域 ADR，但不链接；写前不查重叠 issue，可能重复已有工作且无警告。区域忙时先自行搜跟踪器。

**`/to-tickets` 读规格不断截断。**
跟踪器可能无法完整返回超大规格，没有本地副本。不要在 `/to-spec`、`/to-tickets` 间[清空](https://www.aihero.dev/ai-coding-dictionary/clearing)或[压缩](https://www.aihero.dev/ai-coding-dictionary/compaction)。同窗口运行，`/to-tickets` 就不需重新获取规格。

## 正常工作的表现

- 开始编写，而不重新提一轮问题。
- 写前展示接缝，尽可能少。
- 使用项目名词，不用泛化产品管理套话。
- 每项决策你都记得做过，不为填部分而编造。
- 范围外列真实内容；拒绝的事通常最有价值。

## 它在流程中的位置

`to-spec` 是主构建链的一步，但仅在多会话分支：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review → retro
```

上游 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 做决策，这里仅记录；完成的 [wayfinder](https://aihero.dev/skills-wayfinder) 地图从这里汇入。下游 [to-tickets](https://aihero.dev/skills-to-tickets) 切成 tracer-bullet 工单供 [implement](https://aihero.dev/skills-implement) 构建。不确定 skill 或流程时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
