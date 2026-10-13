# 生产力

通用工作流工具，不限于代码工作。

## 用户调用型

只有你输入名称时才能触达（Claude Code：`disable-model-invocation: true`；Codex：`agents/openai.yaml` 中的 `policy.allow_implicit_invocation: false`）。

- **[grill-me](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/grill-me/SKILL.md)**：针对计划或设计接受持续追问，直到设计树的每个分支都解决。
- **[handoff](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/handoff/SKILL.md)**：将当前对话压缩成交接文档，让另一个代理继续工作。
- **[teach](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/teach/SKILL.md)**：跨多个会话教授新技能或概念，使用当前目录作为有状态的教学工作区。
- **[to-questionnaire](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/to-questionnaire/SKILL.md)**：将你无法独自决定的问题，转成给唯一能回答者的 Markdown 问卷，异步填写或在会议中一起完成。
- **[wait-what](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/wait-what/SKILL.md)**：一条消息没理解时立即调用。代理补上你缺少的背景，使用 `GLOSSARY.md` 的词汇，用简单的英语重新解释。

## 模型调用型

模型或用户均可触达，丰富的触发条件措辞让模型能够自主使用。

- **[grilling](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/grilling/SKILL.md)**：围绕计划、决策或想法持续追问用户，直到设计树的每个分支都解决。
- **[writing-for-agents](../../../../claude-code-market/plugins/mattpocock-skills-zh/skills/writing-for-agents/SKILL.md)**：为代理编写文档，包括 skills、AGENTS.md/CLAUDE.md，以及代理通过指针触达的文档。
