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
- Kimi Code 本地 marketplace/plugin 入口：`kimi-market/`
- ZCode 独立插件与 skill 副本：`zcode-market/`
- ZCode 根 marketplace 入口：`marketplace.json`，指向 `zcode-market/plugins/`
- Microsoft SkillOpt 上游子模块：`SkillOpt/`

## Skill 同步规则

更新三端共有的 skill 内容时，必须按其所属插件同步 Claude Code、Codex 和 Kimi Code 对应内容。

工作流 skill：

- Claude Code：`claude-code-market/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-workflow/skills/<skill>/`
- Kimi Code：`kimi-market/plugins/ghost-agent-workflow/skills/<skill>/`

普通 skill：

- Claude Code：`claude-code-market/plugins/ghost-agent-skills/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-skills/skills/<skill>/`
- Kimi Code：`kimi-market/plugins/ghost-agent-skills/skills/<skill>/`

ZCode 独立副本：

- 工作流：`zcode-market/plugins/ghost-agent-workflow/skills/<skill>/`
- 普通 skill：`zcode-market/plugins/ghost-agent-skills/skills/<skill>/`

ZCode 副本初始从 Claude Code skill 复制，但之后允许单独修改，不自动同步回
Claude Code、Codex 或 Kimi Code。每个 ZCode 副本的 `SKILL.md` 都必须保留独立
演进说明，以明确这是用户要求的单端差异。

ZCode plugin-level agent 位于各插件的 `agents/` 目录，并与同名 skill 一一对应；
agent 必须先加载对应 skill，只执行一个明确 action，不创建、等待或转发给其他
agent。workflow 统一入口位于 `zcode-market/plugins/ghost-agent-workflow/commands/parallel-workflow.md`；
状态仍只能由 `scripts/` 下的 runtime 管理，不得手写替代状态文件。

只有用户明确要求单端差异化实现时，才允许某个平台的内容与三端共享版本不同；这种差异必须在对应 skill 中写清平台原因。
