# AGENTS.md

## Git 身份

这个仓库里的所有提交都必须使用下面这组本地 Git 身份：

- 名称：`Ghost233`
- 邮箱：`only.yesc@gmail.com`

设置：

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

## Marketplace 同步规则

修改插件目录、版本或 marketplace 元数据时，必须同步更新所有发布同一插件的 `marketplace.json`。Claude Code 同步 `.claude-plugin/marketplace.json` 与 `claude-code-market/.claude-plugin/marketplace.json`；Codex 同步 `.agents/plugins/marketplace.json` 与 `codex-market/.agents/plugins/marketplace.json`。每个 `source` 必须按所在 marketplace 根目录指向实际插件目录；存在 `version` 时，必须与对应 `plugin.json` 一致。全部清单校验通过后才算完成。

## Python 脚本兼容性

本仓库自行设计和维护的 Python 脚本必须以 Python 3.9 为最低运行版本，并使用 Python 3.9 支持的语法和标准库 API。除非脚本明确检测并选择了更高版本的解释器，不得依赖 Python 3.10 或更高版本独有的语法或 API；兼容实现应能继续在 Python 3.10 及更高版本运行。

与这些脚本相关的测试必须在 Python 3.9 下可加载并通过。测试或脚本启动 Python 子进程时，应优先使用当前解释器（`sys.executable`），不得假设环境中的 `python3` 高于 Python 3.9。

## 文档同步

本仓库根目录有两份对等的指引文档：`CLAUDE.md`（Claude Code）与 `AGENTS.md`（通用 agent）。

修改其中任一文件后，**必须把改动同步到另一份**，保持两者内容一致（除标题外应逐字相同）。不得只改一份而让另一份过期。

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
