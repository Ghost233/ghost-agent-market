> 译者说明：本目录是上游 `59db609eb1e18aaf59b63284d0e52255aff0c63c` 的资料参考快照，供阅读使用。27 个正式中文 skill 位于仓库的插件目录，安装和使用见[根 README](../../README.md)。这里保留的上游维护命令、脚本和机器发布清单按完整上游仓库布局解释；执行维护命令时，请切换到 `upstream/mattpocock-skills/` 子模块。此参考快照中的 `skills/` 仅收录未发布内容及分类说明，机器清单保留原始路径供对照。

<p>
  <a href="https://www.aihero.dev/s/skills-newsletter">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://res.cloudinary.com/total-typescript/image/upload/v1777382277/skills-repo-dark_2x.png">
      <source media="(prefers-color-scheme: light)" srcset="https://res.cloudinary.com/total-typescript/image/upload/v1777382277/skill-repo-light_2x.png">
      <img alt="Skills" src="https://res.cloudinary.com/total-typescript/image/upload/v1777382277/skill-repo-light_2x.png" width="369">
    </picture>
  </a>
</p>

# 面向实际工程工作的 Skills

[![skills.sh](https://skills.sh/b/mattpocock/skills)](https://skills.sh/mattpocock/skills)

这些代理 skills 是我每天做实际工程时使用的工具，而非只凭感觉写代码。

开发真正的应用很难。GSD、BMAD 和 Spec-Kit 等方法尝试接管流程来提供帮助。但这样做也会拿走你的控制权，让流程中的缺陷更难解决。

这些 skills 设计得小、易于调整，并且可以组合。它们适用于任何模型，来自数十年的工程经验。你可以随意修改，让它们适合自己。

如果你想跟进这些 skills 的变更和我新建的 skills，可以加入大约 60,000 名开发者订阅的通讯：

[订阅通讯](https://www.aihero.dev/s/skills-newsletter)

## 安装（30 秒配置）

插件会自动更新。[skills.sh](https://skills.sh/mattpocock/skills) 把可编辑文件复制到项目中，由你手动更新。每个代理选择一种安装方式；同时安装两种，会让每个 skill 出现两次。

### 1. 获取 skills

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude plugin install mattpocock-skills@claude-plugins-official
```

默认自动更新。

</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex plugin marketplace add mattpocock/skills
codex plugin add mattpocock-skills@mattpocock
```

启动时自动更新。

</details>

<details>
<summary><strong>GitHub Copilot</strong>（CLI 和 VS Code）</summary>

```bash
copilot plugin marketplace add mattpocock/skills
copilot plugin install mattpocock-skills@mattpocock
```

然后在 `~/.copilot/settings.json` 中添加一次：

```json
{
  "extraKnownMarketplaces": {
    "mattpocock": { "source": { "source": "github", "repo": "mattpocock/skills" }, "autoUpdate": true }
  }
}
```

在 VS Code 中运行 **Chat: Install Plugin From Source**，输入 `https://github.com/mattpocock/skills`。每天自动更新。

</details>

<details>
<summary><strong>Gemini CLI</strong>（手动更新）</summary>

```bash
gemini skills install https://github.com/mattpocock/skills.git --path skills/engineering
gemini skills install https://github.com/mattpocock/skills.git --path skills/productivity
```

重新运行两条命令即可更新。

</details>

<details>
<summary><strong>其他代理，或可编辑文件</strong>（手动更新）</summary>

```bash
npx skills@latest add mattpocock/skills -a <agent>  # cursor、opencode、devin、windsurf、amp、pi；省略 -a 可交互选择
```

安装器询问选择哪些 skills 时，包含 `setup-matt-pocock-skills`。更新时运行 `npx skills@latest update`，再运行一次 `add` 以获取新 skills。

</details>

### 2. 运行 `/setup-matt-pocock-skills`

在代理中，每个仓库运行一次。它会：

- 询问你使用哪个问题跟踪器（GitHub、GitLab、本地文件，或你描述的其他系统）。
- 询问你分诊工单时使用什么标签（`/triage` 使用标签）。
- 询问你希望把创建的文档保存在哪里。

### 3. 现在可以开始使用

## 为什么创建这些 skills

我创建这些 skills，是为了解决 Claude Code、Codex 和其他编码代理中常见的失败方式。

### 1：代理没有做我想要的事

> “没有人确切知道自己想要什么。”
>
> David Thomas 与 Andrew Hunt，[《程序员修炼之道》](https://www.amazon.co.uk/Pragmatic-Programmer-Anniversary-Journey-Mastery/dp/B0833F1T3V)

**问题**：软件开发最常见的失败是理解不一致。你以为开发者知道你想要什么。看到他们做出的东西时，才意识到他们完全没理解你的意思。

在 AI 时代也是如此。你与代理之间有沟通上的缺口。解决方式是一次**深入追问会话**，让代理针对你要构建的东西提出详细问题。

**解决方式**是使用：

- [`/grill-me`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-me/SKILL.md)：用于非代码场景。
- [`/grill-with-docs`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-with-docs/SKILL.md)：与 [`/grill-me`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-me/SKILL.md) 相同，并增加一些能力，见下文。

这是我最受欢迎的 skills。它们帮助你在开始前与代理达成一致，也让你深入思考要作出的变更。*每次*想做变更时都使用它们。

### 2：代理太啰嗦

> 使用通用语言时，开发者之间的对话和代码表达都源自同一个领域模型。
>
> Eric Evans，[《领域驱动设计》](https://www.amazon.co.uk/Domain-Driven-Design-Tackling-Complexity-Software/dp/0321125215)

**问题**：项目开始时，开发者与软件服务的人（领域专家）通常说着不同的语言。

我与代理之间也有同样的困难。代理通常直接进入项目，边做边理解术语。因此，本来一个词就能说清的事，它会用 20 个词。

**解决方式**是共享语言。一份文档帮助代理理解项目中的术语。

<details>
<summary>
示例
</summary>

这是我的 `course-video-manager` 仓库中的[术语表](https://github.com/mattpocock/course-video-manager/blob/076a5a7a182db0fe1e62971dd7a68bcadf010f1c/CONTEXT.md)示例。这个固定提交中的文件仍叫 `CONTEXT.md`，是在 skills 重命名约定之前。下面哪个更易读？

- **之前**：“课程的某个章节中的一节课变成‘真实的’（也就是在文件系统中有了位置）时出现了问题。”
- **之后**：“物化级联出了问题。”

这种简洁在每次会话中都会带来收益。

</details>

这个能力已经融入 [`/grill-with-docs`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-with-docs/SKILL.md)。它运行深入追问会话，帮助你与 AI 建立共享语言，并把难以解释的决定记录在 ADRs 中。

很难说清它有多大作用。它可能是这个仓库中最有意思的技术。你可以试试看。

> [!TIP]
> 共享语言除了减少啰嗦，还有其他好处：
>
> - **变量、函数和文件使用共享语言保持一致命名**。
> - 因此，代理**更容易在代码库中查找内容**。
> - 代理也**在思考上消耗更少 tokens**，因为它可以使用更简洁的语言。

### 3：代码无法运行

> “始终迈出小而审慎的步骤。反馈速度就是你的速度上限。永远不要接下太大的任务。”
>
> David Thomas 与 Andrew Hunt，[《程序员修炼之道》](https://www.amazon.co.uk/Pragmatic-Programmer-Anniversary-Journey-Mastery/dp/B0833F1T3V)

**问题**：假设你与代理已经就构建内容达成一致。代理*仍然*产出糟糕代码时怎么办？

这时该检查反馈循环。代理如果不知道生成的代码实际如何运行，就无法判断方向。

**解决方式**：你需要常见的反馈循环，包括静态类型、浏览器访问和自动化测试。

对于自动化测试，红 → 绿 → 重构循环至关重要。代理先编写失败测试，再修好测试。持续、稳定的反馈会让代码质量更好。

我创建了一个 **[`/tdd`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/tdd/SKILL.md) skill**，可以放进任何项目。它鼓励红 → 绿 → 重构，也详细指导代理判断好测试与坏测试。

对于调试，我还创建了 **[`/diagnosing-bugs`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/diagnosing-bugs/SKILL.md)**。它把调试实践组织成有纪律的循环，各阶段依次验收。

### 4：我们做出了难以维护的代码库

> “*每天*都要投入系统设计。”
>
> Kent Beck，[《解析极限编程》](https://www.amazon.co.uk/Extreme-Programming-Explained-Embrace-Change/dp/0321278658)

> “最好的模块是深模块。它们通过简单接口提供大量功能。”
>
> John Ousterhout，[《软件设计的哲学》](https://www.amazon.co.uk/Philosophy-Software-Design-2nd/dp/173210221X)

**问题**：多数由代理构建的应用复杂且难以修改。代理大幅加快编码，也加快了软件熵的增长。代码库正以前所未有的速度变复杂。

**解决方式**是 AI 开发中的一种新做法：关注代码设计。

这些 skills 的每一层都包含这种考虑：

- [`/to-spec`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-spec/SKILL.md) 会在创建 spec 前，追问你将触及哪些模块。

还有关键的 [`/improve-codebase-architecture`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/improve-codebase-architecture/SKILL.md)：它调查代码库中的深化机会，把候选项交给你。我建议每隔几天运行一次。它负责调查。对于年代久远的代码库，它会找到真实的候选项，但不会替你理清所有混乱。

### 总结

软件工程基础比以往更重要。这些 skills 是我把基础浓缩为可重复实践的尝试，帮助你交付职业生涯中最好的应用。

## 参考

分类依据只有一个：谁可以调用。**用户调用** skills 只有你输入它们时才能触达，例如 `/grill-me`；它们负责组织流程。**模型调用** skills 可以由你调用，也可以在任务适合时由代理自动使用；它们承载可复用的方法。用户调用 skill 可以调用模型调用 skill，但不能调用另一个用户调用 skill。

### 工程

我每天用于代码工作的 skills。

**用户调用**

- **[ask-matt](../../claude-code-market/plugins/mattpocock-skills-zh/skills/ask-matt/SKILL.md)**：询问哪个 skill 或流程适合你的情况。它是这个仓库中用户调用 skills 的路由器。
- **[grill-with-docs](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-with-docs/SKILL.md)**：运行深入追问会话，同时构建项目领域模型，打磨术语，并直接更新 `GLOSSARY.md` 和 ADRs。
- **[triage](../../claude-code-market/plugins/mattpocock-skills-zh/skills/triage/SKILL.md)**：让 issues 经过分诊角色状态机。
- **[improve-codebase-architecture](../../claude-code-market/plugins/mattpocock-skills-zh/skills/improve-codebase-architecture/SKILL.md)**：扫描代码库中的深化机会，以 HTML 可视化报告呈现，再针对你选中的候选项深入追问。
- **[setup-matt-pocock-skills](../../claude-code-market/plugins/mattpocock-skills-zh/skills/setup-matt-pocock-skills/SKILL.md)**：为工程 skills 配置仓库，包括问题跟踪器、分诊标签和领域文档布局。使用其他工程 skills 前，每个仓库运行一次。
- **[to-spec](../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-spec/SKILL.md)**：把当前对话整理为 spec，发布到问题跟踪器。它直接综合已经讨论的内容，不另作访谈。
- **[to-tickets](../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-tickets/SKILL.md)**：把计划、spec 或对话拆成一组曳光弹工单，每项声明阻塞关系。本地文件中以文字记录，真实跟踪器中使用原生阻塞链接。
- **[implement](../../claude-code-market/plugins/mattpocock-skills-zh/skills/implement/SKILL.md)**：实施 spec 或工单集合中的工作，在预先约定的接缝处驱动 `/tdd`，并在提交前用 `/code-review` 收尾。
- **[implement-spec](../../claude-code-market/plugins/mattpocock-skills-zh/skills/implement-spec/SKILL.md)**：在一条集成分支上实施整个 spec。把工单视为任务图，在就绪前沿上运行实施子代理，以获得最大并发，再用 `/code-review` 收尾。
- **[wayfinder](../../claude-code-market/plugins/mattpocock-skills-zh/skills/wayfinder/SKILL.md)**：把单个代理会话容纳不下的大规模工作，规划为问题跟踪器中共享的决策工单地图。逐项解决，直到通向目的地的路线清楚。
- **[retro](../../claude-code-market/plugins/mattpocock-skills-zh/skills/retro/SKILL.md)**：会话结束后，对编码代理的环境提出改进建议，包含导航、自动化检查、编码标准、引导文件和工具。最严重的问题排在前面。

**模型调用**

- **[prototype](../../claude-code-market/plugins/mattpocock-skills-zh/skills/prototype/SKILL.md)**：构建一次性原型来回答设计问题。状态或逻辑问题使用单个可分享的 HTML 文件；UI 问题使用可从同一路由切换的几个差异明显的方案。
- **[diagnosing-bugs](../../claude-code-market/plugins/mattpocock-skills-zh/skills/diagnosing-bugs/SKILL.md)**：棘手缺陷和性能回退的诊断循环：建立会因该缺陷变红的反馈循环 → 最小化 → 提出假设 → 埋点 → 修复 → 回归测试。
- **[research](../../claude-code-market/plugins/mattpocock-skills-zh/skills/research/SKILL.md)**：通过高可信一手来源调查问题，把发现保存为仓库中带引用的 Markdown 文件，由后台代理执行。
- **[tdd](../../claude-code-market/plugins/mattpocock-skills-zh/skills/tdd/SKILL.md)**：使用红 → 绿 → 重构循环做测试驱动开发。逐个垂直切片构建功能或修复缺陷。
- **[domain-modeling](../../claude-code-market/plugins/mattpocock-skills-zh/skills/domain-modeling/SKILL.md)**：主动构建并打磨项目领域模型，对照术语表质疑术语，以边界场景作压力测试，并直接更新 `GLOSSARY.md` 和 ADRs。
- **[codebase-design](../../claude-code-market/plugins/mattpocock-skills-zh/skills/codebase-design/SKILL.md)**：设计深模块的共享方法与词汇。把大量行为放在小接口后面，位于清晰的接缝处，并可通过接口测试。
- **[code-review](../../claude-code-market/plugins/mattpocock-skills-zh/skills/code-review/SKILL.md)**：从固定点开始，沿两个轴审查 diff：**Standards**（是否遵循仓库编码标准，并满足 Fowler 坏味道基线）和 **Spec**（是否忠实实现来源 issue/spec）。两个轴由并行子代理审查，避免互相影响。
- **[pr](../../claude-code-market/plugins/mattpocock-skills-zh/skills/pr/SKILL.md)**：定义 PR 正文的形式。用能说清变更的最小可视化作摘要，展示运行有效的前后证据，判断合并危险程度（单向门或双向门，以及影响范围）。
- **[wizard](../../claude-code-market/plugins/mattpocock-skills-zh/skills/wizard/SKILL.md)**：生成交互式 Bash 向导，引导人类执行只有人类能做的步骤：准备基础设施、设置凭据或 CI secrets、操作陌生第三方控制台，或执行一次性迁移与切换。

### 效率工具

通用工作流工具，不限于代码。

**用户调用**

- **[grill-me](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-me/SKILL.md)**：针对计划或设计持续深入追问，直到设计树中的每个分支都已解决。
- **[handoff](../../claude-code-market/plugins/mattpocock-skills-zh/skills/handoff/SKILL.md)**：把当前对话压缩成交接文档，让另一个代理继续工作。
- **[teach](../../claude-code-market/plugins/mattpocock-skills-zh/skills/teach/SKILL.md)**：在多次会话中教你新的技能或概念，以当前目录作为保存状态的教学工作区。
- **[to-questionnaire](../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-questionnaire/SKILL.md)**：把你无法独自回答的决策整理为 Markdown 问卷，交给能够回答的那个人。可以异步填写，也可开会时一起回答。它追问发送安排（发给谁、希望获得什么），不追问主题本身。
- **[wait-what](../../claude-code-market/plugins/mattpocock-skills-zh/skills/wait-what/SKILL.md)**：消息没听懂时立即调用。代理会补足缺失背景，用清楚的中文重新解释，并使用 `GLOSSARY.md` 中的词汇。

**模型调用**

- **[grilling](../../claude-code-market/plugins/mattpocock-skills-zh/skills/grilling/SKILL.md)**：针对计划、决策或想法持续追问，直到设计树中的每个分支都已解决。它是 `grill-me`、`grill-with-docs`、`triage`、`wayfinder` 和 `improve-codebase-architecture` 背后的可复用访谈原语。
- **[writing-for-agents](../../claude-code-market/plugins/mattpocock-skills-zh/skills/writing-for-agents/SKILL.md)**：为代理编写文档，包括 skills、AGENTS.md/CLAUDE.md，以及代理通过指针触达的任何文档。
