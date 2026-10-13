## 它的作用

`pr` 定义 PR 正文形状：展示变更的 **Summary**、证明工作的 **Evidence**、判断落地风险的 **Merge Danger**。它是格式参考，不是工作流，不推分支、不开 PR、不决定范围。它告诉[代理](https://www.aihero.dev/ai-coding-dictionary/agent)编写时正文应怎样。

摘要是视觉表达，而非段落。默认正文用文字描述差异，这里选择能说明关键点的**最小视图**（伪代码、调用树、组件树、文件树、Mermaid 图或有结构的差异），周围文字保持短。审查者已打开差异，正文应在阅读前展示形状。

## 何时使用

输入 `/pr`，或代理编写 PR 正文时自动使用。

| 你的情况 | 使用什么 |
| --- | --- |
| 分支就绪，需要可快速浏览的正文 | `pr` |
| 代码已写，尚无人审查 | 先 [code-review](https://aihero.dev/skills-code-review)，再 `pr` |
| PR 已开，正在收到审查评论 | 本套暂无对应工具；`pr` 仅写正文 |

## 模板

按序三个部分：

- **Summary**：一个或多个小视图，各自紧邻所支持的短文字。通常一个、有时几个、很少全用，只留审查者所需调用、文件、props、边界。
- **Evidence**：前后对比。视觉变更且[环境](https://www.aihero.dev/ai-coding-dictionary/environment)能截图时，截图证据最强；否则用先失败后通过的具体测试（以伪代码表示），或变化的控制台输出。
- **Merge Danger**：**单向门**或**双向门**，及**影响范围**。双向门易撤销；单向门（破坏性迁移、公共 API 移除、难撤销决策）不易。影响范围指出出错会破坏什么：布局偏移、API 消费者、移动响应式。

门的判断是核心：把“合并安全吗”从直觉变成可被审查者质疑的明确主张，也告诉他们[人工审查](https://www.aihero.dev/ai-coding-dictionary/human-review)应投入何处。双向门、影响小可快看；单向门慢读。

## 常见问题

**能相信代理自己的门判断吗？**

不能盲信，明确陈述正为此。作者也是评分者，因此“可逆、影响小”最应怀疑。差异常隐藏能否撤销：用户说“回滚提交不能撤回批量邮件”，带开关发布也只在首次新格式写入之前可逆。skill 给定义（破坏性动作与难撤销决策属于单向门），不是清单，应最仔细检查 Merge Danger。两点有帮助：让代理面前有[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)或[规格](https://www.aihero.dev/ai-coding-dictionary/spec)，不只有差异；把仓库始终视为单向的变更（模式迁移、任何向外发送或删除）写到代理判断前会读的地方。

**会替我开 PR 吗？**

不会，仅正文。[implement](https://aihero.dev/skills-implement) 最后提交当前分支；开 PR 的 skill 或选项（`/to-pr`、`implement` 开 PR 而非提交）仍是未关闭提案。一位用户用一句本地覆盖，让 `implement` 开 PR。[implement-spec](https://aihero.dev/skills-implement-spec) 是例外：跟踪器通过 PR 关闭或你要求时开 draft。`pr` 可模型调用，因此你要求开 PR 时代理会采用 `pr` 的格式。

**会不会又是一大堆文字和图？**

设计为防止这样，但仍可能。用户一贯抱怨摘要过长，只想知道变更、验证、可能损坏内容、合并是否安全。skill 要求跳过前言、文字短、最小视图，通常一个，很少全用。若仍堆图，是代理忽略要求。正文因差异巨大而巨大时，问题在 PR 大小，`pr` 不会替你拆。

**仓库已有 PR 模板，谁优先？**

默认没有优先级。`pr` 自带模板，不寻找 `.github/pull_request_template.md` 等。多人要求使用仓库模板，不处理就有两套冲突指令。应在代理文档解决，例如填写仓库模板，并在其下放 Summary、Evidence、Merge Danger。

**输出 HTML 吗？为何 Mermaid 不渲染？**

输出 Markdown 正文，不是 HTML 页。GitHub、GitLab 会渲染描述中的 Mermaid，终端不会，因此本地显示像原始文字。CLI 用户用 ASCII Mermaid 渲染器，或要求 PR 附 HTML 版。Mermaid 是六种视图之一，调用树、文件树、结构化差异在各处阅读一致。

**能整理收到的审查评论吗？**

不能，写正文后停止。用户多次要求分诊开发者或审查 bot 的评论，区分值得处理与非问题，本 skill 不做。

**PR 改变时持续更新正文吗？**

不会，它在一个时间点写正文，审查中改动会使正文过期。大改后让代理重写，再次写正文便用同样形状。

**无 UI，Evidence 放什么？**

除了截图的其他证据。截图仅在视觉变更最强。迁移、后台任务、重构用之前失败现在通过的具体测试，或变化的控制台输出。单说“测试绿了”是主张，不是前后对比。

**能标明 LLM 编写吗？**

不会自行标。有人在仓库代理文档设置长期规则：代理写的每个 issue、评论、PR 都以披露行结束。规则应在仓库覆盖所有发布内容，而非一类文档的模板。

## 正常工作的表现

- 打开差异前，仅看 Summary 视图就知道变更。
- 无前言，直接从 Summary 标题开始。
- Evidence 展示前后，而不只是声明通过。
- 每个 PR 都说明门与影响范围，单向门会让你慢下来。

## 它在流程中的位置

通过 PR 交付时，`pr` 位于审查与复盘之间：`to-spec → to-tickets → implement → code-review → pr → retro`。模型可调用，也会在链外编写 PR 正文时触发。

- [code-review](https://aihero.dev/skills-code-review) 在前，正文应描述已审查的差异。
- [implement](https://aihero.dev/skills-implement) 产生正文描述的提交。

不确定情况需要哪个 skill 时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
