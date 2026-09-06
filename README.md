# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

`ghost-agent-skills` 内置普通 skill：

- `git-commit`：在单个隔离 executor 中检查改动，并通过 Python 3 安全脚本创建规范的中文 Git 提交
- `git-merge-conflict`：在修改冲突文件前先用只读 Bash 脚本锁定 merge/rebase/cherry-pick 三方和有界历史，再按考古证据解决高风险冲突
- `compile-feature-knowledge`：把确认结论与验收证据合并为长期维护的 OKF 功能档案
- `implement-spec`：将已批准的 spec 显式委派给实施子智能体，并由主线程独立审查

`mattpocock-skills-zh` 是 Matt Pocock《Skills for Real Engineers》的非官方中文翻译版，收录上游发布的 25 个稳定 skill。推荐整包安装这个 plugin，无需逐个复制 skill 目录。

上游子模块：

- `SkillOpt/`：`microsoft/SkillOpt`

Codex hook 插件：

- `rtk-hook`：基于 `Ghost233/rtk-hook` 的 PreToolUse hook，通过 `rtk rewrite` 透明改写 RTK 支持的 shell 命令，不支持的命令原样放行

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

## 目录结构

```text
ghost-agent-market/
├── SkillOpt/
├── .claude-plugin/
│   └── marketplace.json
├── claude-code-market/
│   ├── .claude-plugin/marketplace.json
│   └── plugins/
│       ├── ghost-agent-skills/
│       │   ├── .claude-plugin/plugin.json
│       │   └── skills/
│       │       ├── compile-feature-knowledge/
│       │       ├── git-commit/
│       │       ├── git-merge-conflict/
│       │       └── implement-spec/
│       └── mattpocock-skills-zh/
│           └── skills/
└── codex-market/
    ├── .agents/plugins/marketplace.json
    └── plugins/
        ├── ghost-agent-skills/
        │   ├── .codex-plugin/plugin.json
        │   └── skills/
        ├── mattpocock-skills-zh/
        └── rtk-hook/
            ├── .codex-plugin/plugin.json
            ├── hooks/
            ├── scripts/
            └── rules.json
```

## 安装 Claude Code Market

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market
```

这是 Claude Code 会话内的斜杠命令，不要追加终端 CLI 使用的 `--sparse` 参数。

安装插件：

```text
/plugin install ghost-agent-skills@ghost-agent-market
/plugin install mattpocock-skills-zh@ghost-agent-market
```

## 安装 Codex Marketplace

把远程 marketplace 添加到 Codex：

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse .agents --sparse codex-market
```

如果 `ghost-agent-market` 已经添加，不要重复执行 `marketplace add`；先刷新现有 Git marketplace：

```bash
codex plugin marketplace upgrade ghost-agent-market
```

安装插件：

```bash
codex plugin add ghost-agent-skills@ghost-agent-market
codex plugin add mattpocock-skills-zh@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装或更新 `mattpocock-skills-zh` 后，请新开一个 Claude Code 会话或 Codex 任务，让 25 个 skill 重新加载。

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```

## 安装 ZCode Marketplace

ZCode 兼容读取 Claude 格式的 marketplace 与插件清单，无需单独维护 ZCode 副本。在 ZCode 客户端打开 **Settings → Plugin Management → Discover**，点击 **`+`** 添加 GitHub 仓库 `Ghost233/ghost-agent-market`，然后在 Discover 列表中安装 `ghost-agent-skills` 与 `mattpocock-skills-zh`。

如果添加或安装时克隆、下载失败，先为 ZCode 设置代理环境变量 `ZCODE_HTTP_PROXY=http://host:port`（裸 `http_proxy` 不会被读取），再重试。
