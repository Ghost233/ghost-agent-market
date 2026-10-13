## 它的作用

`tdd` 测试先行地建功能或修缺陷：一个失败测试、刚好足够通过的代码、下一个行为。`tdd` 规定值得保留的测试循环标准：什么是好测试、放哪里、mock 用途，以及让套件无价值的三种反模式。

未先确认接缝就不写测试。任何测试出现前，指出准备测试的公共边界，停下等待确认。测试精力有限，此步投入关键路径而非所有边缘情况。`tdd` 也是**参考**，不是驱动工具：包含循环规则，由你或 [implement](https://aihero.dev/skills-implement) 运行应用规则的[会话](https://www.aihero.dev/ai-coding-dictionary/session)。

## 何时使用

输入 `/tdd`，或任务适合时[代理](https://www.aihero.dev/ai-coding-dictionary/agent)自动使用：测试先行建功能、修缺陷，或说“red-green-refactor”。

有输入与可观察输出的具体行为，想测试经得起重构时使用。

| 情况 | 去哪里 |
| --- | --- |
| 有定义输入输出的行为（业务逻辑、请求响应契约、变换、验证） | `tdd` |
| 行为尚未确定 | [to-spec](https://aihero.dev/skills-to-spec)，也在代码前确认接缝 |
| 问题在接口形状，而非测试 | [codebase-design](https://aihero.dev/skills-codebase-design) |
| 已有[规格](https://www.aihero.dev/ai-coding-dictionary/spec)或[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)，想执行整个构建 | [implement](https://aihero.dev/skills-implement)，逐张驱动 `tdd` |
| 配置、接线、胶水、类型注解、直接 CRUD 委派 | 没有特别适合的 skill，见下面缺口 |

最后一行是真实缺口：决定接缝*在哪里*，不决定变更*是否*值得循环。没有独立真值来源的变更会产生重述实现的测试，从另一方向进入 skill 警告的同义反复。[Issue #746](https://github.com/mattpocock/skills/issues/746) 尚未关闭，当前需自行判断，或把规则写入 `CLAUDE.md`。

## 前提条件

需要安装 [codebase-design](https://aihero.dev/skills-codebase-design)。过去自带深模块与接口设计说明，v1.0 删除改用共享 skill，现在采用其接口词汇。除此无要求；它[无状态](https://www.aihero.dev/ai-coding-dictionary/stateless)，不写自身文件。

## 循环与接缝

三个术语构成基础。

**红绿。** 先写失败测试，再只写足够通过的代码，不为再下一个测试写代码。没有重构阶段。2026 年 6 月删除，因为代理几乎不执行，审查与实施分会话更好。重构属于 [code-review](https://aihero.dev/skills-code-review)。

**纵向切片。** 一个接缝一个测试、最小实现、重复。首轮是 **tracer bullet**，证明单路径端到端。反面是水平切片：先全部测试，再全部代码。批量测试验证*想象*行为，检查形状而非用户行为，在理解实现前固定测试结构。

**预先约定接缝。** 接缝是不深入内部就能观察行为的公共边界。`tdd` 的规则无例外，不在未确认接缝写测试。完整链中由 [to-spec](https://aihero.dev/skills-to-spec) 提前确认：“`/tdd` 只工作于预先约定测试接缝，`/code-review` 检查是否只用了约定接缝。”单独调用时 `tdd` 直接问你。

要预防三种反模式：

| 反模式 | 表现 |
| --- | --- |
| 与实现耦合 | 行为未变，重命名内部函数却破测试。Mock 内部协作者、断言调用次数、用数据库查询代替接口验证。 |
| 同义反复 | 期望值按代码同样方式计算，因构造而通过。应来自别处：已知正确字面值、算过的例子、规格。 |
| 水平切片 | 实现前先落一批测试。 |

Mock 只用于系统边界：外部 API、时间、随机性，有时文件系统或数据库。绝不 mock 自己模块。

## 常见问题

**描述说“red-green-refactor”，为何不重构？**

步骤删除，描述没改。这是有意删除：代理几乎不做，实施与审查分会话更好。是否仍算教科书 TDD 不如代码是否更好重要。[Issue #589](https://github.com/mattpocock/skills/issues/589) 记录触发短语与正文不符，仍开放，因此该短语继续触发；得到的是红绿，重构在 [code-review](https://aihero.dev/skills-code-review)。

**它让我选测试接缝，我不知道怎么选。**

这是报告最多的摩擦（[issue #607](https://github.com/mattpocock/skills/issues/607)）。提示仅列名称，不解释各自能抓或漏什么，等于在标签间选择。尚无发布修复。先要求权衡再答：组件级漏而集成能抓什么，慢多少。这也解释为什么链在 `to-spec` 先确认，此时能看完整功能而不只一个提示。

**明明要求红先，它却先写实现。**

会发生。有人质问[模型](https://www.aihero.dev/ai-coding-dictionary/model)，得到坦白：知道一测试一轮、看正确失败、读过指令，却回到平常习惯。skill 接受这一点；没有指令能百分百保证，强化措辞收益小却限制创造力。即使不严格，总体结果更好，循环仍值得。如果某切片必须严格，观察执行，别仅信 skill。

**应先浏览器或端到端测试吗？**

通常不，skill 也不阻止。有人先写 Playwright，然后长循环重跑，把尚不存在功能的*测试*判为损坏。浏览器太慢，红绿收益消失。在仓库 `CLAUDE.md` 说明行为工作之后才做浏览器测试。

**替代 `/implement` 或课程 `/do-work` 吗？**

不。`/tdd` 记录方法；`/tdd` 不驱动会话，`/implement` 是工作→反馈→提交循环，直接替代 `/do-work`。课程单步现拆为 `/implement`、`/tdd`、`/code-review`，共同取代 `/do-work`。面对工单该调用哪一个，几乎总是 `/implement`。

**深模块与接口设计说明去哪了？**

v1.0 移到 [codebase-design](https://aihero.dev/skills-codebase-design)，泛化供多 skills 共享。`refactoring.md` 同时移除；重构现归 [code-review](https://aihero.dev/skills-code-review)，带 Fowler 异味基线。

**知道其他工单吗？**

不知道。对一张运行时会建议属于兄弟工单的工作，因为不见整个图（[issue #129](https://github.com/mattpocock/skills/issues/129)）。这不是 `tdd` 的职责。工单连规格一起提供有帮助，一开始适当定大小更有帮助。

## 正常工作的表现

- 测试文件出现前，停下指出接缝并等待。
- 一个测试出现、变红、最小代码使绿，然后下一个，而非测试一批、代码一批。
- 名字像能力（“用户能用有效购物车结账”），而非内部实现（“checkout 调用 paymentService.process”）。
- 期望值是可追溯规格的字面值，不重复代码计算。
- 内部函数重命名不破测试。
- Mock 只在支付 API、时钟等外部边界，不在自己模块。

## 它在流程中的位置

`tdd` 在主链构建步骤内部，不是单独一步：

```txt
grill-with-docs → to-spec → to-tickets → implement → code-review → retro
```

[to-spec](https://aihero.dev/skills-to-spec) 先确认接缝，[implement](https://aihero.dev/skills-implement) 逐张驱动，[code-review](https://aihero.dev/skills-code-review) 之后检查仅使用约定接缝，并负责不再由 `tdd` 执行的重构。另一邻居是共享接缝与深模块词汇的 [codebase-design](https://aihero.dev/skills-codebase-design)。有具体行为、无完整规格时也可单用 `tdd`。不确定情况适合哪个时，[ask-matt](https://aihero.dev/skills-ask-matt) 路由。
