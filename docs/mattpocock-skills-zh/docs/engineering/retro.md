## 它的作用

`retro` 回顾编码[会话](https://www.aihero.dev/ai-coding-dictionary/session)，提议改善代理的**[环境](https://www.aihero.dev/ai-coding-dictionary/environment)**，让下次更顺。读取会话记录，默认当前会话，也可指向日志中的某次，找代理受阻时刻，按严重度列候选修复。

`retro` 改环境，不改代码。无论代理交付的缺陷、找文件花了二十次[工具调用](https://www.aihero.dev/ai-coding-dictionary/tool-call)，还是审查漏规则，都不直接修。它问仓库什么条件允许这些发生，提议下次可预防的检查、指针、规范。也只提议，你选中候选前没有变更。

## 何时使用

输入 `/retro`，代理不会自行使用。

在比应有难度更难的会话结束时使用：搜索太久、犯工具能捕获的错、需要却无法获取信息。顺利会话没多少经验，发现来自困难会话。想评价产出代码，用 [code-review](https://aihero.dev/skills-code-review)。

## 发现落在哪里

每个候选属于一类，决定修复位置：

| 会话中出了什么问题 | 修复方式 |
| --- | --- |
| 找文件或事实很久 | 从已读取文件加**导航指针** |
| 犯工具能捕获的错 | **[自动检查](https://www.aihero.dev/ai-coding-dictionary/automated-check)**：lint、类型、测试、pre-commit hook、CI 作业 |
| 审查者漏掉依赖判断的错 | 写入 `CODING_STANDARDS.md` 供审查代理使用 |
| `AGENTS.md` 或 `CLAUDE.md` 太大 | 把引导内容移到规范或检查 |
| 工具调用成本高、收益小 | 精简或替换工具 |
| 引导文件充满无作用的行 | 删除**无效操作（no-ops）** |
| 代理需要无法访问的信息 | 扩大访问：开发日志 tee 到文件、服务只读访问 |

核心是规范属于**审查者**，而非实施者。实施代理要探索、写代码、调试，上下文压力最大；审查者只拿差异。因此新规则放到有空间应用的位置，即审查。绝不放 [AGENTS.md](https://www.aihero.dev/ai-coding-dictionary/agents-md)，因为它无论相关与否都会加载进每个会话的[上下文窗口](https://www.aihero.dev/ai-coding-dictionary/context-window)。

`retro` 写规则前先分类。**机械**违规（禁止 API、导入形式、文件位置）用确定检查，因为检查能失败，规范文字不能。只有 linter 无法执行的真实判断才写文字。仓库完全没有护栏（无 pre-commit，也无运行 lint、类型、测试的 CI）时，单独报告这一发现。

## 常见问题

**会自己写 lint 还是等同意？能每会话后自动跑吗？**

等待。`retro` 只提议，选择前不手工编辑、不自动装 hook。有意如此：一位用户被阻止正常变更的自动 hooks 坑过，要求保留判断。决定什么值得永久检查需要人，因此让 `retro` 保持[人参与](https://www.aihero.dev/ai-coding-dictionary/human-in-the-loop)，仅用户调用。有人每次实施后运行，但顺利会话很少经验，每次跑大多产生不需要的规则。没有 dry-run 模式。检查也是代码，允许阻止合并前先在仓库试。

**lint 会无限堆积吗？会建议删除吗？**

部分会，这是弱点。它能删除文字：引导中的无效项，以及 `AGENTS.md`、`CLAUDE.md` 中应移到规范或检查的内容。文件大时标记删除，但只依据一个会话，视为删除测试候选，不是定论。`retro` 不审计上月提议的 lint、hook、CI，无法判断规则如今触发过多或原缺陷已消失。仍需自己删检查。规则不断拦好代码就是删除信号。

**会为填类别发明通用建议吗？**

这是最强批评。有用户发现结束后 AI 忘了中途挣扎，为满足类别编造泛化建议。每个候选必须来自会话记录，使建议具体，也有成本：虽少编无关内容，却可能过度重视这一会话主题。无法追溯具体时刻就舍弃。严重度排序也只是初稿，安静但昂贵的错可能排在响亮但便宜的错后面。

**会话很长，现在跑还是新会话？**

默认 `retro` 审查当前会话，困难仍在窗口，是最好情况。已离开[高效上下文区](https://www.aihero.dev/ai-coding-dictionary/smart-zone)时，[清空](https://www.aihero.dev/ai-coding-dictionary/clearing)，新 `/retro` 指向日志中的旧会话。

**代理总犯同样错误，要往 `CLAUDE.md` 加一行吗？**

通常不要，这是 `retro` 最常反对的做法。`CLAUDE.md` 每行加载所有会话、降低其他内容权重、随代码变化过期。机械错用能失败的检查；判断错放审查者读取的编码规范。`AGENTS.md`、`CLAUDE.md` 几乎只用导航指针。同理`retro` 不是[记忆系统](https://www.aihero.dev/ai-coding-dictionary/memory-system)，不储存经历，而改环境阻止重犯。

**配置提 `CODING_STANDARDS.md`，但我没有，它从哪来？**

没有 skill 附带该文件。首次会话发现审查者需要的判断规则时，`retro` 提议创建。接受后 [code-review](https://aihero.dev/skills-code-review) 读取。已有 `CONTRIBUTING.md` 等规范文档也可。

**与 `improve-codebase-architecture` 区别？**

输入不同。[improve-codebase-architecture](https://aihero.dev/skills-improve-codebase-architecture) 只需代码，找结构改善；`retro` 需会话历史，改善代理环境而非代码。两者都用，互不替代。

## 正常工作的表现

- 每项候选指向会话具体时刻，不是泛化最佳实践。
- 重复错误变成失败检查，`AGENTS.md` 随时间缩短。
- 已有检查未接入时，发现是接入，不新建。
- 下次同类任务更快找到所需。

## 它在流程中的位置

`retro` 是主链最后一步，回顾流程：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review → retro
```

值得学习的构建之后，同会话运行或指向日志。顺利构建可跳过。

- [code-review](https://aihero.dev/skills-code-review) 是它最常调整的审查代理，新规范放到 Standards 维度能读的位置。
- [writing-for-agents](https://aihero.dev/skills-writing-for-agents) 规定提议的引导文件与 skill 文风，`retro` 开始前加载。

不确定情况需要哪个 skill 时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
