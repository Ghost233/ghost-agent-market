## 它的作用

`research` 阅读掌握答案的来源，回答问题，并在仓库留下带引用的 Markdown 文件。只使用**[一手来源](https://www.aihero.dev/ai-coding-dictionary/primary-source)**：官方文档、源码、规格、第一方 API。它把每项主张追溯到掌握该信息的来源，因此 API 官方文档可访问时，不复述博客的二手描述。

它不在对话里回答。产出是文件，写在仓库已有的笔记位置，每项主张带链接。你得到可回应、交给另一代理或丢弃的文档，而非[会话](https://www.aihero.dev/ai-coding-dictionary/session)结束就消失的答案。

## 何时使用

输入 `/research`，或任务转为资料阅读时[代理](https://www.aihero.dev/ai-coding-dictionary/agent)自动使用。

下一步是从工作目录之外*查明事实*（第三方 API 行为、规格内容、版本主张是否成立），且不想自己的对话停下来读资料时使用。按需要选择：

| 需要什么 | 使用什么 |
| --- | --- |
| 决策等待的外部事实 | `research` |
| 通过采访*与你一起*做决策 | [grilling](https://aihero.dev/skills-grilling) |
| 写入 `GLOSSARY.md` 与 ADR 的持久架构决策 | [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |
| 查某办法在代码库是否可行 | [prototype](https://aihero.dev/skills-prototype) |
| 一个会话容不下的计划 | [wayfinder](https://aihero.dev/skills-wayfinder) |

`research` 与 `grill-with-docs` 的界线是**产出的保质期**。调研产生短期事实，如本周库的认证机制；ADR 记录长期保留的决策。产出是决策而非事实时，是[追问](https://www.aihero.dev/ai-coding-dictionary/grilling)，不是调研。

## 委派资料工作

阅读由**后台代理**执行。它追溯一手来源、写一个 Markdown 文件、汇报，你继续工作。调研是委派资料工作，不是外包思考。你依据文档追问、规划、设计，仍自己决策。

没有机制阻止后台代理再次派发后台代理。这是记录最充分的问题。

文件位置由仓库惯例决定，不由 skill 决定。没有笔记惯例时选合理位置并告知。每次运行一个文件。

## 常见问题

**它派发第二个调研代理，正常吗？**

不正常。这是 [issue #530](https://github.com/mattpocock/skills/issues/530) 记录的开放缺陷。skill 要求调用者启动后台代理，却不限制类型；调用者生成拥有 `Agent` 工具、相同指令的 `general-purpose` 代理，于是再次委派。一位报告者测得三个重叠运行，一个调研任务约四十五万 [tokens](https://www.aihero.dev/ai-coding-dictionary/token)，重复代理在用户看不到的地方半小时后才结束。Claude Code 之外也有，Codex 与 GPT-5.6-sol 用户确认相同嵌套。没有发布修复。用户本地追加“已是[子代理](https://www.aihero.dev/ai-coding-dictionary/subagent)时自行执行”，有所帮助，但只是指令，不是结构修复。调用后查看后台任务列表，停止重复任务。

反向失败也发生：全局指引禁止再次委派时，后台代理拒绝任务，skill 不做任何事也不告诉你。

**文件放哪，要提交吗？**

skill 放在已有笔记位置，没有更多意见。社区大致共识是保留 ADR，而非调研文件。Discord 帖明确指出：ADR 保留，其他完成后归档或删除；否则成为杂物，偏离规格或调研后可能污染未来仓库阅读。调研记录写作当天事实，过期比没有更糟。总体不属于 Git，也无标准位置。用户用 Obsidian、独立知识仓库或跟踪器。

**什么算“高可信”一手来源，谁决定？**

[模型](https://www.aihero.dev/ai-coding-dictionary/model)决定。skill 列来源*类别*（官方文档、源码、规格、第一方 API），无允许列表、域名门禁或验证步骤。提出时最强质疑是，五个指向垃圾来源的子代理只会更快给五个自信错误答案，如何判断可信？尚无公开答复。唯一保护是逐主张引用。跟随两三条；若落到对事物的摘要而非事物本身，运行失败。

**后续会话会复用之前发现吗？**

不会。没有自动加载旧文件的机制，文件留着直到人或 skill 指向它。早期最强质疑认为，价值在 Markdown 被后续代理重读成上下文，而不是抓取；写一次就死的文件只是花哨搜索。发布版未解决。实际需自行交给下一步：附规格、引用到追问会话、让[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)指向它。

**为何不直接让代理读文档？**

可以，两行提示本来就是被本 skill 替代的习惯。它增加两点：后台运行，保持会话[上下文](https://www.aihero.dev/ai-coding-dictionary/context)干净；一手来源约束与引用文件产出每次一致，不依赖提示措辞。与[运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)自带深度调研模式相比，差别是文件与一手来源规则，而非搜索。小问题两行提示足够就用它。

**何时停止阅读？**

没有停止准则。因此出现看似相反、同因的两种批评：深入太多，或广泛覆盖却漏唯一关键细节。有人说深度调研 skills 有时太深，让代理调研却常漏重要细节。你必须定范围。狭窄可答的问题（一个 API、一个行为、一个版本主张）比“调研 X”好得多。

**`/wayfinder` 创建调研工单，要我自己解决吗？**

现在会替你启动。v1.1 之后尚未发布的变化中，制图会话每张调研工单派发一个 `/research` 子代理并行运行。各自把发现记录在一次性 `research/<name>` 分支，工单有[上下文指针](https://www.aihero.dev/ai-coding-dictionary/context-pointer)。调研工单是 wayfinder 每会话一工单的唯一例外，因为它们是[无人值守](https://www.aihero.dev/ai-coding-dictionary/afk)工作，无需等你。已知问题：之后删除分支会断开工单指针。

## 正常工作的表现

- 你的会话继续工作。如果坐着看它阅读，委派没发生。
- 恰好一个新后台任务。第二个近似名称是嵌套缺陷。
- 仓库惯用笔记目录出现一个 Markdown，代理告知路径。
- 每项主张带链接，随机两条落到官方文档、规格、源码本身，而非二手文章。
- 只靠文件即可做此前卡住的决策，不必自己重读来源。

## 它在流程中的位置

`research` 是随时可用的独立工具，为思考 skills 提供资料，不属于构建链。把文件带*入*流程。[grilling](https://aihero.dev/skills-grilling)、[grill-with-docs](https://aihero.dev/skills-grill-with-docs) 已知事实时问题更精确，[to-spec](https://aihero.dev/skills-to-spec) 可据此综合。[wayfinder](https://aihero.dev/skills-wayfinder) 是唯一直接调用者，通过 `/research` 子代理解决每张调研工单。整套地图见 [ask-matt](https://aihero.dev/skills-ask-matt)。
