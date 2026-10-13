## 它的作用

`to-tickets` 把计划、[规格](https://www.aihero.dev/ai-coding-dictionary/spec)或当前对话拆成跟踪器中的一组**[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)**。每张声明**阻塞边**：开始前哪些工单必须完成。

每张是 **tracer bullet**：窄但完整地穿过所有变更层（schema、API、UI、测试），落地即可独立演示。这不同于按层拆、最后集成的直观做法。每张还需适合一个全新[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)，因为从未看过规格的[会话](https://www.aihero.dev/ai-coding-dictionary/session)会接手。

## 何时使用

输入 `/to-tickets`，[代理](https://www.aihero.dev/ai-coding-dictionary/agent)不会自行使用。

| 当前位置 | 运行什么 |
| --- | --- |
| 有规格 issue，跨会话构建 | `/to-tickets` 或 `/to-tickets #<spec_issue>` |
| 计划仅在对话，未成文 | 直接读对话，不需规格 |
| 整个变更适合一窗口 | [implement](https://aihero.dev/skills-implement)，跳过工单 |
| 尚无决策 | [grill-with-docs](https://aihero.dev/skills-grill-with-docs)，再 [to-spec](https://aihero.dev/skills-to-spec) |
| [wayfinder](https://aihero.dev/skills-wayfinder) 地图已清空阻塞 | 先 [to-spec](https://aihero.dev/skills-to-spec) 合并地图，再 `/to-tickets` |

`to-tickets` 生成的工单按构造已适合代理，不要再运行 [triage](https://aihero.dev/skills-triage)。Triage 用于外来工作。

## 前提条件

发布到跟踪器，需要 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 为仓库配置跟踪器与分诊标签词汇。GitHub、Linear 等真实系统或 `.scratch/` 本地 Markdown 都可，后者无需额外配置。

## Tracer bullets，而非分层

**水平**切片只交付一层，全部落地前无法工作，验收必须触及其他工单拥有的内容。**纵向**切片（tracer bullet）同时交付跨所有层的一条窄路径，独立可验收，拥有自己评判的全部内容。

这是最常违反的规则。一个团队把 26 张按层（corpus、producer、aggregator、selector）拆分，每关闭一张约二十次代理运行，四分之三是返工。复盘把所有失败类别归因于水平切片，而非实施。

发布前两件事：`to-tickets` 先找预重构（“先让变更容易，再做容易的变更”），排最前；再给编号拆分并问你粒度、边是否真实、该合并或拆哪些。批准前不发跟踪器，这轮询问正适合质疑。

## 阻塞边

边是工件的重点，按跟踪器有两种方式：

| 跟踪器 | 边的位置 | 执行方式 |
| --- | --- | --- |
| 本地 Markdown | 每张 `.scratch/<feature>/issues/<NN>-<slug>.md` 的文字，按阻塞项优先编号 | 自上而下手动 |
| 真实跟踪器（GitHub、Linear） | 原生阻塞链接，或支持的 sub-issues | 阻塞项已完成的任何工单都在**前沿**，可接手 |

不论如何边都在工单里；跟踪器仅决定是否能并行行动。`to-tickets` 产出工件，逐会话或批量执行是你的工作。

## 大范围重构例外

一种形状不适合 tracer-bullet：**大范围重构**，单个机械变更（列重命名、共享符号改类型）的**影响范围**覆盖全库。一处改动破坏数千调用点，无法绿灯落地纵向切片。

`to-tickets` 改用 **expand–contract** 顺序：

- **Expand**：新形式与旧并存，不破坏。
- **Migrate**：按影响范围（包、目录）分批迁调用点，每批一工单，都被 expand 阻塞。旧形式仍在，CI 保持绿。
- **Contract**：无调用者后删除旧形式，一工单被所有迁移批次阻塞。

若各批也无法独立绿灯，共用集成分支，都阻塞最终集成验证工单；只需最终工单 CI 绿。

## 常见问题

**三行变更生成十二张工单。**
过度拆解是最多报告的问题。[模型](https://www.aihero.dev/ai-coding-dictionary/model)默认原子单位，丢失有意义的分组。询问步骤要求合并即可。也有下限：全部适合一个窗口就别用本 skill，直接 [implement](https://aihero.dev/skills-implement)。

**工单按层，每张分别 schema、API。**
纵向规则就是防这失败，但仍偶尔发生。询问时逐张问“完成能演示什么？”无答案就是水平切片。有人给每张加“demo path”，报告这推动纵向切片。

**GitHub 工单不是规格 issue 的 sub-issues。**
多个模型、十余次运行报告过，[issue #554](https://github.com/mattpocock/skills/issues/554) 最完整。已修：每张作为来源 issue 子项，GitHub 模板提供 `gh issue create --parent <n>`（`gh` 2.94+）。重跑 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 刷新旧 `docs/agents/issue-tracker.md`。

**“Blocked by”只写在正文，不是真实阻塞链接。**
同类问题，[issue #513](https://github.com/mattpocock/skills/issues/513) 中代理甚至说 GitHub 无原生关系。实际有 `gh issue create --blocked-by 12,15`。`to-tickets` 先发布阻塞项，其编号创建时已知。正文仅是无原生边系统的后备，不是默认；原生边时模板现在省略 `## Blocked by`。

**本地工单放哪？v1.1 说根目录 `tickets.md`。**
那是缺陷，共享单文件还引发并行写竞态。现在每张 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，按依赖顺序，与模板布局一致。`NN` 是真实 ID，`/implement 03` 可用，不需重打长标题。

**读取规格不断截断。**
超大规格超过跟踪器完整返回能力，没有本地副本，代理反复[调用工具](https://www.aihero.dev/ai-coding-dictionary/tool-call)取片段却读不完。`/to-spec`、`/to-tickets` 间不要[清空](https://www.aihero.dev/ai-coding-dictionary/clearing)或[压缩](https://www.aihero.dev/ai-coding-dictionary/compaction)，同窗口就无需重新抓取。

**验收条件没检验什么，有些开工前已通过。**
模板只要求条件、不要求可失败，因此会发生。三形态：基线已为真、仅另一工单能满足、重述请求而非从工件推导。纵向切片交付新行为，在基线天然失败，能防多数。仍应手查：每项指出什么观察能证明其为假，确认在实施者起始提交会失败。

**已发布，怎么执行？**
`to-tickets` 止于工件，无自动派发。手动看板、数无开放阻塞项工单、开同数量代理会话。每张新上下文，中间清空。[implement](https://aihero.dev/skills-implement) 在 GitHub 或本地不可靠地关闭或勾工单，因此自行更新状态。

## 正常工作的表现

- 每张可回答“完成能演示什么”，答案是行为，不是层。
- 发布前给编号列表，每张有“Blocked by”。
- 顶部无阻塞，可立即开始。
- 正文无文件路径或行号，除非原型产出的片段。
- 每张像新会话无需你在场即可完成的工作。
- 找到的预重构在最前，不混入功能工单。

## 它在流程中的位置

`to-tickets` 是主构建链步骤：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review → retro
```

上游 [to-spec](https://aihero.dev/skills-to-spec) 提供确定规格，`/to-tickets` 与它留在同一窗口，中间不清空。下游 [implement](https://aihero.dev/skills-implement) 新会话逐张构建，驱动 [tdd](https://aihero.dev/skills-tdd)，以 [code-review](https://aihero.dev/skills-code-review) 收尾。[implement-spec](https://aihero.dev/skills-implement-spec) 是另一条下游：把同样阻塞边读成任务图，在一个集成分支并行构建就绪工单。不确定时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
