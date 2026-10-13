# 工程

我日常用于代码工作的 skills。

## 用户调用型

只有你输入名称时才能触达（Claude Code：`disable-model-invocation: true`；Codex：`agents/openai.yaml` 中的 `policy.allow_implicit_invocation: false`）。

- **[ask-matt](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/ask-matt/SKILL.md)**：询问哪种 skill 或流程适合当前情况。本仓库用户调用型 skills 的路由入口。
- **[grill-with-docs](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-with-docs/SKILL.md)**：在 grilling 会话中构建项目领域模型，打磨术语，并边做边更新 `GLOSSARY.md` 和 ADR。
- **[triage](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/triage/SKILL.md)**：通过 triage 角色的状态机推进 issues。
- **[improve-codebase-architecture](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/improve-codebase-architecture/SKILL.md)**：扫描代码库中可深化的模块，用 HTML 可视化报告展示，再针对你选择的机会展开 grilling。
- **[setup-matt-pocock-skills](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/setup-matt-pocock-skills/SKILL.md)**：为本仓库配置工程类 skills，包括 issue tracker、triage 标签和领域文档布局。每个仓库运行一次。
- **[to-spec](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-spec/SKILL.md)**：将当前对话转为 spec，发布到 issue tracker。
- **[to-tickets](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-tickets/SKILL.md)**：将任意计划、spec 或对话拆成一组曳光弹 tickets。每个 ticket 都明确阻塞关系，以本地文件文本或实际 tracker 中的原生阻塞链接表达。
- **[implement](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/implement/SKILL.md)**：构建 spec 或 tickets 描述的工作，在事先约定的接缝执行 `/tdd`，提交前以 `/code-review` 收尾。
- **[implement-spec](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/implement-spec/SKILL.md)**：在一个集成分支实现完整 spec。将 tickets 作为任务图，在所有已就绪的任务上并行派发实现子代理，最后以 `/code-review` 收尾。
- **[wayfinder](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/wayfinder/SKILL.md)**：为超出单个代理会话容量的大块工作规划 issue tracker 上共享的决策 tickets 地图，逐项解决，直到通往目标的路径清楚。
- **[retro](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/retro/SKILL.md)**：会话后建议改进编码代理的环境，包括导航、自动检查、编码规范、引导文件和工具，按严重程度排序。

## 模型调用型

模型或用户均可触达，丰富的触发条件措辞让模型能够自主使用。

- **[prototype](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/prototype/SKILL.md)**：构建一次性原型以回答设计问题：状态或逻辑使用一个可分享的 HTML 文件，UI 使用多种可切换方案。
- **[diagnosing-bugs](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/diagnosing-bugs/SKILL.md)**：针对棘手缺陷和性能回退的诊断循环：构建能因该缺陷变红的反馈循环 → 缩减 → 提出假设 → 添加观测 → 修复 → 回归测试。
- **[research](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/research/SKILL.md)**：对照高可信的一手来源调研问题，将发现保存为仓库中带引用的 Markdown 文件，以后台代理运行。
- **[tdd](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/tdd/SKILL.md)**：以红—绿—重构循环进行测试驱动开发，一次用一个纵向切片构建功能或修复缺陷。
- **[domain-modeling](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/domain-modeling/SKILL.md)**：通过质疑术语、情景压力测试，以及边做边更新 `GLOSSARY.md` 和 ADR，主动构建并打磨项目领域模型。
- **[codebase-design](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/codebase-design/SKILL.md)**：设计深模块的共享方法和词汇：小接口、清晰接缝、可通过接口测试。
- **[code-review](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/code-review/SKILL.md)**：审查从固定点以来的 diff，两个并行子代理分别检查 **Standards**（仓库编码规范加 Fowler 坏味道基线）和 **Spec**（是否忠实实现来源 issue/spec）。
- **[pr](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/pr/SKILL.md)**：PR 正文的结构：用能说明变化的最小可视化概述，提供前后证据证明有效，并判断合并风险，包括单向门或双向门以及影响范围。
- **[wizard](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/wizard/SKILL.md)**：生成交互式 Bash 向导，引导人类完成只有其本人能执行的步骤：准备基础设施、配置凭据或 CI secrets、使用陌生的第三方控制台，或执行一次性迁移、切换。
