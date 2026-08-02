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
- `zcode-market/`：ZCode 独立插件与 skill 副本
- `marketplace.json`：ZCode 根 marketplace 入口，指向 `zcode-market/plugins/`
- `SkillOpt/`：`microsoft/SkillOpt` Git submodule

## Skill 同步规则

更新两端共有的 skill 内容时，必须按其所属插件同步 Claude Code 和 Codex 对应内容。

工作流 skill：

- Claude Code：`claude-code-market/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-workflow/skills/<skill>/`

普通 skill：

- Claude Code：`claude-code-market/plugins/ghost-agent-skills/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-skills/skills/<skill>/`

ZCode 独立副本：

- 工作流：`zcode-market/plugins/ghost-agent-workflow/skills/<skill>/`
- 普通 skill：`zcode-market/plugins/ghost-agent-skills/skills/<skill>/`

ZCode 副本初始从 Claude Code skill 复制，但之后允许单独修改，不自动同步回
Claude Code 或 Codex。每个 ZCode 副本的 `SKILL.md` 都必须保留独立
演进说明，以明确这是用户要求的单端差异。

ZCode plugin-level agent 位于各插件的 `agents/` 目录，并与同名 skill 一一对应；
agent 必须先加载对应 skill，只执行一个明确 action，不创建、等待或转发给其他
agent。workflow 统一入口位于 `zcode-market/plugins/ghost-agent-workflow/commands/parallel-workflow.md`；
状态仍只能由 `scripts/` 下的 runtime 管理，不得手写替代状态文件。

## ZCode 在线连接规则

ZCode 只能通过在线 GitHub marketplace 连接：

- `Ghost233/ghost-agent-market`
- `https://github.com/Ghost233/ghost-agent-market`

禁止使用 `git clone`、本地仓库路径、本地目录、本地 `marketplace.json`、`file://`
或其他离线方式作为 ZCode 的安装、部署或更新来源。修改完成后必须推送到在线
marketplace，再让 ZCode 从在线来源刷新。

只有用户明确要求单端差异化实现时，才允许某个平台的内容与共享版本不同；这种差异必须在对应 skill 中写清平台原因。
