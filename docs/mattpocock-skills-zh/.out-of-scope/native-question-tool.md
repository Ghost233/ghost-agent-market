# 通过代理运行环境的原生问题工具进行 grilling

Grilling 会话（`/grilling`、`/grill-me`、`/grill-with-docs`，以及其他 skills 内的 grilling）通过普通聊天文本提问。要求使用运行环境内置的问题 UI，不属于维护范围，包括 Claude Code 的 `AskUserQuestion`、宿主的问题工具，以及结构化或批量问卷模式。

## 不属于维护范围的原因

这些 skills 是跨运行环境的文本，可运行在 Claude Code、Codex、Copilot、Cursor，以及 skills.sh 支持的任何环境。每个环境的问题工具不同，也可能没有。Skill 点名某个环境的工具，就意味着每个 grilling skill 都要增加平台分支，或只在某个环境中正常工作。

问题 UI 也会改变 grilling。结构化选项界面会推动模型提出带预设答案的选择题，而 grilling 需要用户用自己的话回答开放式问题，一次解决决策树的一个分支。我试过 `AskUserQuestion` UI，不希望把它放进这些 skills。

若你喜欢所在环境的问题工具，在自己的 `CLAUDE.md` / `AGENTS.md` 中说明，例如“grilling 时，通过 AskUserQuestion 提问”。这是一句用户个人偏好，共享 skill 无需知道。

## 既往请求

- #19：“grill-me：并不总是使用问题工具”。
- #643：“提议：grilling 会话中通过 AskQuestion 取得结构化输入”。
- #840：“在 grilling 会话中使用宿主的问题工具”。
- #1107：“Grilling 开箱即用时未使用代理原生 QA 工具”。
- #1152：“提议：实验性的 HTML 问卷模式，支持批量 grilling”。
