# AGENTS.md

## Git 身份

这个仓库里的所有提交都必须使用下面这组本地 Git 身份：

```bash
git config user.name Ghost233
git config user.email only.yesc@gmail.com
```

在暂存或提交之前，先确认：

```bash
git config user.name
git config user.email
```

如果任意一项不是 `Ghost233` 或 `only.yesc@gmail.com`，不要提交。

## 插件版本

修改任一插件后，基础版本每次增加 `0.0.1`。任一段达到 `10` 时向左进位：`0.4.9` -> `0.5.0`，`0.9.9` -> `1.0.0`。基础版本递增后再运行 cachebuster；它只更新 `+codex.<UTC timestamp>` 后缀，不改变基础版本。

## 范围

这个仓库当前包含：

- `claude-code-market/`：Claude Code 本地插件入口
- `codex-market/`：Codex 本地 marketplace/plugin 入口
- `SkillOpt/`：`microsoft/SkillOpt` Git submodule

## Skill 同步规则

更新两端共有的 skill 内容时，必须按其所属插件同步 Claude Code 和 Codex 对应内容。

工作流 skill：

- Claude Code：`claude-code-market/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-workflow/skills/<skill>/`

普通 skill：

- Claude Code：`claude-code-market/plugins/ghost-agent-skills/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-skills/skills/<skill>/`

只有用户明确要求单端差异化实现时，才允许某个平台的内容与共享版本不同；这种差异必须在对应 skill 中写清平台原因。
