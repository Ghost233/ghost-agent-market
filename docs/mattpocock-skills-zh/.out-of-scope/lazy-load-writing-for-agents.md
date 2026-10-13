# 在评判代理文档的 skills 中延迟加载 `writing-for-agents`

`retro` 每次运行都加载 `writing-for-agents`，不只在写作前加载。要求等 skill 编辑 skill、`AGENTS.md`、`CLAUDE.md` 或文档时再加载，不属于维护范围。

## 不属于维护范围的原因

`writing-for-agents` 不只是一份风格指南。它定义什么是空操作指令，以及什么构成好的 skill。`retro` 在写任何内容之前，就用这些定义评判读到的引导文件。只读并报告的 retro 仍需要它。延迟加载，会让 No-ops 和 Skills 候选项缺少判断标准。

## 既往请求

- #1238：“retro：仅在写作前加载 writing-for-agents”（已关闭）。
