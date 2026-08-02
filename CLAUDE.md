# CLAUDE.md

## Git 身份

在这个仓库工作时，所有提交的作者和提交者都必须是：

- 名称：`Ghost233`
- 邮箱：`only.yesc@gmail.com`

提交前设置或修正本地仓库身份：

```bash
git config user.name Ghost233
git config user.email only.yesc@gmail.com
```

不要使用其他名称或邮箱创建提交。

## 仓库用途

这个仓库用于维护本地 agent marketplace 相关内容：

- Claude Code 本地插件入口：`claude-code-market/`
- Codex 本地 marketplace/plugin 入口：`codex-market/`
- ZCode 独立插件与 skill 副本：`zcode-market/`
- ZCode 根 marketplace 入口：`marketplace.json`，指向 `zcode-market/plugins/`
- Microsoft SkillOpt 上游子模块：`SkillOpt/`

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

ZCode role agent 模板位于 `zcode-market/agent-templates/`，与同名 skill 一一对应；
通过 `zcode-market/install-agents.py` 从在线 GitHub raw 文件安装到用户级
`~/.zcode/agents/`。安装后的 agent 必须先加载对应 skill，只执行一个明确 action，
不创建、等待或转发给其他 agent；每个用户级 Markdown 都可以单独设置 `model:`。
ZCode 的 `/sync-zcode-agents` 位于
`zcode-market/plugins/ghost-agent-workflow/commands/sync-zcode-agents.md`，只做全局
用户级安装；默认不覆盖已有内容，只有用户明确要求时才传 `--force`。workflow 统一入口位于
`zcode-market/plugins/ghost-agent-workflow/commands/parallel-workflow.md`；
状态仍只能由 `scripts/` 下的 runtime 管理，不得手写替代状态文件。

## ZCode 在线连接规则

ZCode 只能通过在线 GitHub marketplace 连接：

- `Ghost233/ghost-agent-market`
- `https://github.com/Ghost233/ghost-agent-market`

禁止使用 `git clone`、本地仓库路径、本地目录、本地 `marketplace.json`、`file://`
或其他离线方式作为 ZCode 的安装、部署或更新来源。修改完成后必须推送到在线
marketplace，再让 ZCode 从在线来源刷新。

只有用户明确要求单端差异化实现时，才允许某个平台的内容与共享版本不同；这种差异必须在对应 skill 中写清平台原因。
