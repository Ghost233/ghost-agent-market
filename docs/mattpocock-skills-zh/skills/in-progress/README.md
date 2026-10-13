# 开发中

Beta。这些 skills 刻意公开，欢迎试用并告诉我哪里出问题。进入稳定分类前，它们不包含在插件和顶层 README 中，没有文档页面，可能在无预告的情况下改变或消失。

插件不会提供这些内容。直接安装单个 skill：

```bash
npx skills@latest add mattpocock/skills --skill=<name>
```

- **[loop-me](./loop-me/SKILL.md)**：跨多个会话通过 grilling 将工作流打磨为可实现的 specs，使用当前目录作为有状态工作区。用户调用型。
- **[writing-beats](./writing-beats/SKILL.md)**：以自选冒险的方式，把文章组织成叙事节拍的旅程。选起始节拍，只写它，再转向下一个，直到文章自然结束。
- **[writing-fragments](./writing-fragments/SKILL.md)**：通过 grilling 从你身上挖掘写作碎片，也就是不同类型的写作素材，将其追加到一个文档，为未来文章提供原料。
- **[writing-shape](./writing-shape/SKILL.md)**：将原始素材的 Markdown 文件逐段塑造成文章，每一步讨论表达形式的选择。
- **[claude-handoff](./claude-handoff/SKILL.md)**：通过 `claude --bg`，将当前对话的交接摘要传给新的后台代理，立即接续工作。用户调用型。
- **[setup-ts-deep-modules](./setup-ts-deep-modules/SKILL.md)**：在 TypeScript 仓库配置 dependency-cruiser，让每个 package 成为深模块。实现隐藏在子目录，只能通过入口文件访问，测试也通过入口检查行为。用户调用型。
