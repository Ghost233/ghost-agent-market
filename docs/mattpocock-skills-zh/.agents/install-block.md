# 统一的安装说明

安装方式和用语各有一个权威版本。`README.md`、`.changeset/*` 和 `docs/` 下的每个页面都必须使用**这里的**说法。先修改此处，再同步到其他位置。

## 优先使用托管安装

先介绍能自行更新的安装方式。只有代理没有这种方式时，才回退到 skills.sh，并标明“手动更新”。只有无需用户运行命令就能更新的入口，才称为托管安装。一次性启用要求应放在安装命令旁。绝不承诺“即时”更新。

Claude Code 从其官方 marketplace `claude-plugins-official` 安装。其他所有托管入口都从本仓库自己的 marketplace 安装，即 `.claude-plugin/marketplace.json` 和 `plugin.json`。这些入口仅在 `plugin.json` 的 `version` 改变时重新安装。Release 工作流运行 `npm run version`，从 `package.json` 复制该字段，因此“chore: version skills” PR 合并后，用户才能获得发布版本。

| 代理 | 入口 | 自动更新？ |
| --- | --- | --- |
| Claude Code | `@claude-plugins-official` | 是，默认开启 |
| Codex | `@mattpocock` marketplace | 是，默认在启动时更新 |
| Copilot CLI | `@mattpocock` marketplace | 是，需一次性设置 `autoUpdate: true` |
| VS Code | Chat: Install Plugin From Source | 是，默认每天更新 |
| Gemini CLI | `gemini skills install`（复制） | 否。Gemini 扩展需要扁平的 `skills/<name>/` 布局 |
| 其他代理 | skills.sh | 否。运行 `npx skills update`，并为新增 skills 再次运行 `add` |

来源（2026-10-08）：Codex `core-plugins/src/manager.rs`；Copilot [cli-config-dir-reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)；VS Code `pluginAutoUpdate.ts`；Gemini `skillLoader.ts`。

尚无人用 Auggie、Droid、Qwen 或 Goose 验证过本仓库，因此它们继续使用 skills.sh，直到有人实际验证。

## Claude Code

<canonical-block name="claude-code">

```bash
claude plugin install mattpocock-skills@claude-plugins-official
```

默认自动更新。

</canonical-block>

## Codex

<canonical-block name="codex">

```bash
codex plugin marketplace add mattpocock/skills
codex plugin add mattpocock-skills@mattpocock
```

启动时自动更新。

</canonical-block>

## GitHub Copilot（CLI 和 VS Code）

使用 marketplace，不使用 `copilot plugin install mattpocock/skills`。Copilot 已弃用直接安装仓库，而且这种安装方式无法自动更新。`extraKnownMarketplaces` 条目遵循文档中的 schema，但尚无人实际运行验证。

<canonical-block name="copilot">

```bash
copilot plugin marketplace add mattpocock/skills
copilot plugin install mattpocock-skills@mattpocock
```

随后一次性在 `~/.copilot/settings.json` 中添加：

```json
{
  "extraKnownMarketplaces": {
    "mattpocock": { "source": { "source": "github", "repo": "mattpocock/skills" }, "autoUpdate": true }
  }
}
```

在 VS Code 中运行 **Chat: Install Plugin From Source**，输入 `https://github.com/mattpocock/skills`。它每天更新。

</canonical-block>

## Gemini CLI

Gemini 不读取 `.claude-plugin`，`--path` 只接受一个分类。每个正式发布的分类分别安装一次，正好得到全部正式内容（27 个 skills，已于 2026-10-07 验证）。

<canonical-block name="gemini">

```bash
gemini skills install https://github.com/mattpocock/skills.git --path skills/engineering
gemini skills install https://github.com/mattpocock/skills.git --path skills/productivity
```

更新时再次运行这两条命令。

</canonical-block>

## 其他代理，或可编辑文件（skills.sh）

`-a` 预选代理。注释中的每个代理均已于 2026-10-07 实际运行验证。优先使用 skills.sh，而非代理自身的仓库安装器，例如 `amp skill add` 或 `pi install git:…`，因为后两者还会引入 `misc/` 和 `in-progress/`。`npx skills update` 会跳过首次 `add` 后上游新增的 skills，因此说明块要求用户再次运行 `add`。

<canonical-block name="other-agents">

```bash
npx skills@latest add mattpocock/skills -a <agent>  # cursor、opencode、devin、windsurf、amp、pi；省略 -a 可自行选择
```

安装器询问要安装哪些 skills 时，包含 `setup-matt-pocock-skills`。更新时运行 `npx skills@latest update`，再运行 `add` 以取得新增 skills。

</canonical-block>

单独提及某个 skill 时，使用单 skill 的形式。`docs/` 页面不使用这个说明块，因为 ai-hero 会在页面正文上方渲染安装组件。见 [writing-docs.md](./writing-docs.md)。

<canonical-block name="skills-sh-one-skill">

```bash
npx skills@latest add mattpocock/skills --skill=<name>
```

```bash
npx skills@latest update <name>
```

</canonical-block>

所有地方统一使用 `skills@latest` 这一写法。

## 两种入口互斥

插件是订阅式托管的只读集合。skills.sh 写入由你拥有并编辑的文件。两者都安装，会让用户拥有每个 skill 的两份副本。因此始终说明“二选一”。
