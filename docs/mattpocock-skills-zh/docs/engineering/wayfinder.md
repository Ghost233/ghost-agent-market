## 作用

`wayfinder` 处理大到无法容纳在单个代理[会话](https://www.aihero.dev/ai-coding-dictionary/session)中的工作：你能说出**目的地**，却还看不到路线。它在 issue tracker 上绘制一张由**决策 tickets**组成的共享**地图**，再逐项解决，直到路线清楚。

它做规划，不做构建。每个 ticket 提出一个问题，答案是一项决策，而非构建切片。构建前所有待决定事项都已解决，地图才算完成。这条规则区分 wayfinder ticket 和普通实现 [ticket](https://www.aihero.dev/ai-coding-dictionary/ticket)，也是代理最常违反的规则。地图清楚后，wayfinder 交接，不继续写代码。

## 使用时机

输入 `/wayfinder` 来调用，[代理](https://www.aihero.dev/ai-coding-dictionary/agent)不会自主使用它。

它是整套中最重的流程，所以触发范围很窄：工作必须超出单个代理会话的容量，而且通往目的地的路线必须尚不清楚。区别在于会话数量：单会话规划用 `/grill-with-docs`，多会话规划用 `/wayfinder`。

| 当前情况 | 使用入口 |
| --- | --- |
| 范围清楚的功能，一次就能讨论明白 | [grill-me](https://aihero.dev/skills-grill-me)，有代码库时用 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |
| 新项目，或需要很多会话的构建，路线尚不清楚 | `/wayfinder` |
| 对话中的决策已经完成 | [to-spec](https://aihero.dev/skills-to-spec)，直接跳过地图 |
| Wayfinder 地图已经清楚 | [to-spec](https://aihero.dev/skills-to-spec)，再用 [to-tickets](https://aihero.dev/skills-to-tickets) 和 [implement](https://aihero.dev/skills-implement) |
| 现有会话已变得过大 | 说“交接给 `/wayfinder`”；[handoff](https://aihero.dev/skills-handoff) 可接入地图，也可从地图接出 |

不要求是新项目。人们也经常用于旧代码库和开发了一半的项目，甚至在这些场景更有用，因为很多迷雾是“这里已经有哪些事实”，而非“应该做什么”。

## 前提

地图和 tickets 保存在仓库 issue tracker 上，所以 wayfinder 需要 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 配置 tracker。该步骤写入“Wayfinding operations”一节，说明如何在 GitHub、GitLab 或本地 Markdown 中表达地图、子 tickets、阻塞关系和边界查询。Wayfinder 通过 `CLAUDE.md` / `AGENTS.md` 中的指针找到文档，不使用固定路径。没有配置 tracker 时，回退到本地 Markdown 文件。

Tracker 承担实际工作：原生阻塞链接会在其 UI 中显示边界。没有原生依赖链接的 tracker，例如自托管 Gitea，wayfinder 从地图文本推断阻塞关系。它仍可工作，但需要你更仔细监督。

## 地图、迷雾和边界

**地图**是标记 `wayfinder:map` 的单个 issue，tickets 是它的子 issues。它是**索引，不是资料库**。决策只存在于其 ticket 中，地图仅提供一句摘要和链接。会话低分辨率加载地图，按需打开具体 tickets，让地图持续增长，而无需每次加载完整历史。

地图有四节：

- **目的地。** 地图终点是什么样。在任何 ticket 创建前先明确，因为目的地决定范围，也决定每个 ticket 如何衡量。
- **已有决策。** 每个已关闭 ticket 一行，链接到细节所在位置。
- **尚未明确。** 这里是**战争迷雾**：能看出即将到来的决策，却还无法精确提问。判断是迷雾还是 ticket，取决于**现在**能否准确说明问题，而非能否回答。解决 ticket 后，前方迷雾散开，已能描述的内容升级为新 ticket。
- **范围之外。** 超出目的地的工作。迷雾只向**目的地**聚集，范围外的工作保持关闭，永不升级。

**边界**是未关闭、未阻塞且未认领 tickets 的集合，即已知区域的边缘。会话在做任何工作前，先将 ticket 指派给自己以认领。受指派者**就是**认领标记，并发会话因此跳过该 ticket。叙述中通过名称指代 tickets，绝不用裸 `#42`，因为一墙 issue 编号难以阅读。

## 四种决策 ticket 类型

每个 ticket 带 `wayfinder:<type>` 标签。每个 ticket 都属于 **[HITL](https://www.aihero.dev/ai-coding-dictionary/human-in-the-loop)**，由能表达自身想法的人类共同处理；或属于 **[AFK](https://www.aihero.dev/ai-coding-dictionary/afk)**，由代理独立推进。HITL ticket 只能通过实时交流解决。代理自行回答自己的 [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) 问题，就违反了要求。

| 类型 | 模式 | 适用情况 | 解决方式 |
| --- | --- | --- | --- |
| `grilling` | HITL | 默认类型，可通过讨论解决问题。 | 在新会话中使用 [grilling](https://aihero.dev/skills-grilling) 和 [domain-modeling](https://aihero.dev/skills-domain-modeling) |
| `prototype` | HITL | “应该是什么样”或“应该怎样表现”，讨论无法解决。 | 使用 [prototype](https://aihero.dev/skills-prototype)，从 ticket 链接到构建的产物 |
| `research` | AFK | 工作目录之外的某个事实阻碍决策。 | 绘制地图时启动 [research](https://aihero.dev/skills-research) [子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)，在 `research/<name>` 分支并行运行 |
| `task` | 两者均可 | 无需决策，但手动工作阻碍某个决策，例如开通访问、注册服务，或移动数据以查看结构。 | 代理能独立做就独立做，否则给人类一份精确检查清单 |

`task` 是唯一执行工作而非作出决策的类型。它进入地图，只因为能解除某个决策的阻塞，绝不是因为交付目的地的一部分。这种类型在实践中最容易出错：代理把它看成实现步骤，在地图内开始编写产品代码。

Research 是**每个会话一个 ticket**的唯一例外。

## 常见问题

**与 `/grill-with-docs` 有什么不同？应该先用哪个？**

区别在会话数量，而非项目规模。`/grill-with-docs` 是单会话规划，wayfinder 是多会话规划。整个问题能放进一次对话时，grilling 成本更低、效果更好，wayfinder 在这种情况下更慢、更密集。社区的简短说法是：只有工作装不进一个会话，wayfinder 才有意义。这远远是最常见的 wayfinder 问题。用户反复询问，是因为 skill 描述没有告诉你，自己的任务位于界线哪一侧。会话数量需要你自己判断。

**它问“目的地”时，指本次会话结束，还是全部工作结束？**

指整张地图的终点，不只是第一次会话。问题措辞有歧义，但 wayfinder 按定义是多会话工具，所以把答案限于一个会话从来不合适。常见目的地包括用于交接的 [spec](https://www.aihero.dev/ai-coding-dictionary/spec)、规划前需要锁定的决策、概念验证，或数据迁移这类原地修改。

**地图已经清楚，wayfinder 不是已经写了 spec 和 tickets 吗？为什么仍需 `/to-spec` 和 `/to-tickets`？**

没有。Wayfinder 的 tickets 是决策 tickets，地图关闭时它们也都已关闭。剩下的是一张满是决策链接的地图，不是构建计划。[to-spec](https://aihero.dev/skills-to-spec) 将这些关联决策收拢为一份 spec（`/to-spec #<map_issue>`），[to-tickets](https://aihero.dev/skills-to-tickets) 再将其拆成曳光弹实现 tickets。直接从地图跳到 [implement](https://aihero.dev/skills-implement)，会跳过收拢步骤，丢失链接中的细节。只有工作最终很小时，才直接实现。有些人采用较短流程，并报告可行。多出的两步能得到审查者或同事可读的明确 spec，多人协作时更重要。

**代理在 wayfinder 会话途中开始写生产代码。**

这是此 skill 最常收到报告的失败，原因是 skill 确实存在缺口。地图的 **Notes** 可覆盖 wayfinder“规划，不执行”的默认行为。但 Notes 由代理写入，所以约束和例外都在受约束代理拥有的文件中。有用户看到代理在自己的 Notes 中写“这张地图包含执行”。后续会话把它重新读作授权，直接在运行中的服务器构建。Skill 没有硬性机制保证“我指的是默认行为”。修复之前，阅读任何非亲自绘制地图的 Notes，将实现放在独立会话中，任何像构建切片的 `wayfinder:task` 都视为类型标错。

**我规划了 27 个 tickets，做到第十三个时，剩下的都不再合理。**

这个问题原封不动来自用户报告，其他人也报告了同样结果。Wayfinder 默认做完整规划。后续 tickets 建立在被前面 tickets 推翻的假设上时，地图就落入批评者指出的瀑布陷阱。两件事有帮助。首先，将地图限定于有边界的目的地，不覆盖整个产品。用户反馈，一个明确 epic 的地图比庞大的“实现 V1”更有效。目标是交付小增量，而非规划大项目。其次，积极构建[原型](https://www.aihero.dev/ai-coding-dictionary/prototyping)。低成本、具体的产物在实现依赖不确定性之前将其暴露，让路线保持有效。Wayfinder 追求“尽量多做原型”，而非“尽量多做计划”。

**能并行处理多个 tickets 吗？**

边界显示哪些 tickets 可接手，阻塞关系理论上保证并行安全。实践中，一次一个 ticket 是更稳妥的默认方式。同时处理两个 grilling tickets 时，一个会话可能问你刚在另一个会话回答过的问题，因为两者不共享[上下文](https://www.aihero.dev/ai-coding-dictionary/context)。Prototype tickets 也有已知缺口。有用户报告，代理做了三种 UI 方案，自己选一种并关闭 ticket。选择权属于你，而 skill 尚未说得足够清楚。确实要并行时，先自己检查依赖图。

**必须使用 GitHub Issues 吗？**

不用，任何 issue tracker 都可工作。GitHub 支持最好，因为原生 sub-issues 和阻塞关系让边界无需打开地图就可见。用户也采用 GitLab、Linear、Jira 和本地 Markdown。有两个注意点：tracker 没有原生阻塞时，wayfinder 从文本推断依赖图，需要你手动修正；本地 Markdown 把产物存进仓库，不推荐，因为仓库内的材料容易意外长期保留。开源维护者遇到相反问题，即公开 tracker 被代理生成的规划 tickets 填满，因此仍常选择本地 Markdown。

**Grilling 太累，每个问题都有三段长。**

这是对 wayfinder 最直接的未解决投诉，尚无人修复。有用户指出，冗长本身导致决策疲劳，也隐藏代理**为什么**提问，地图增大时，你会失去决策之间的联系。冗长看起来更像当前[模型](https://www.aihero.dev/ai-coding-dictionary/model)的特点，而非 skill 的特点。用户尝试两种缓解方式：降低[推理强度](https://www.aihero.dev/ai-coding-dictionary/effort)，以及在全局 `CLAUDE.md` 中用普通语言明确要求。仍要预期投入大量思考。Wayfinder 要求你思考很多，这正是它的大部分用途，不是缺陷。

**已关闭的决策后来证明错误，编辑旧 ticket 还是新建？**

没有官方指引，代理默认行为也没有帮助。它往往绕着错误决策设计，而不是质疑，因此你需要主动引导。有效方式是明确告诉 wayfinder 哪些情况改变，它会更新地图、修改受影响 tickets，并评论已关闭的 tickets。地图途中范围改变，可以恢复；但若你**设计**地图时就预期它不断改变，说明范围不合适。

**`decision-mapping` 去哪里了？**

就是这个 skill。v1.1 将它改名为 `wayfinder`，通过 `/wayfinder` 调用。“Decision map”属于术语，也不准确，因为四种 ticket 类型只有一种本身是决策。新名称让 skill 使用一致词汇，即目的地、战争迷雾、边界和地图，避免再叠一层自造术语。工作单位仍保留“决策”一词：wayfinder ticket 是**决策 ticket**，防止被误读为实现 ticket。

## 生效迹象

- 任何 ticket 创建前，目的地已写下并达成一致。
- 每个未关闭 ticket 都像一个问题。写着“构建 X”的 ticket，要么类型标错，要么属于地图之后的工作。
- 原生阻塞显示边界，你只看 tracker，无需打开地图，就能知道哪些 tickets 可接手。
- 一个会话解决一个 ticket，用解决评论发布答案、关闭，再在地图的**已有决策**增加一行。然后停止。
- **尚未明确**随着时间缩小。迷雾升级为 ticket 后，从该节移除，不同时出现在两处。
- 开头的广度优先 grilling 没发现任何迷雾时，skill 停止，并告诉你工作足够小，可以跳过地图。
- 完成地图的会话将你引向 spec，而非 PR。

## 所处位置

`wayfinder` 是**特定情况的工作入口**，不是默认起点。大多数工作仍从以 grilling 为起点的“想法 → 交付”流程开始。想法太大，单个会话装不下时，才使用 wayfinder。地图清楚后交接、不做构建，所以它在 [to-spec](https://aihero.dev/skills-to-spec) 重新进入主流程。

多数工作由 wayfinder 安排的其他 skills 完成。[grilling](https://aihero.dev/skills-grilling) 和 [domain-modeling](https://aihero.dev/skills-domain-modeling) 解决默认 ticket 类型，[prototype](https://aihero.dev/skills-prototype) 解决讨论无法确定的 tickets，[research](https://aihero.dev/skills-research) 作为子代理运行，将阅读留在当前会话之外。[handoff](https://aihero.dev/skills-handoff) 负责移入和移出：从过大的对话进入地图，或会话途中出现支线时移出地图。其他情况由 [ask-matt](https://aihero.dev/skills-ask-matt) 路由整套 skills。
