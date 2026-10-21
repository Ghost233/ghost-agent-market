# Ghost Agent Market

DSH（DeepSeek Harness）安装包见 [Ghost Matt DSH Bundle](dsh-market/ghost-matt-skills/README.md)：包含 27 个 Matt 中文原版技能和使用原生 agent team 的 DSH 专用 `spec-delivery`，附独立的安装与加载验证。

这是一个 agent marketplace 工作区，包含 Claude Code / Codex 可安装插件，并以 Git submodule 跟踪 Matt Pocock skills。

`ghost-agent-skills` 内置普通 skill：

- `git-commit`：在单个隔离 executor 中检查改动，并通过 Python 3 安全脚本创建规范的中文 Git 提交
- `git-merge-conflict`：在修改冲突文件前先用只读 Bash 脚本锁定 merge/rebase/cherry-pick 三方和有界历史，再按考古证据解决高风险冲突
- `configure-gh-account`：配置 Git 本地身份与 HTTPS 认证，复用 gh 登录为项目的 `.codex/config.toml` 配置独立账号目录，支持多个仓库并行操作 GitHub
- `spec-delivery`：按任务规模选择实施流程，协调单仓或多仓 spec 的开发、审查、验收和交付；依赖 `mattpocock-skills-zh` 插件
- `container-dev-workflow`：使用项目现有容器入口，按输入变化准备依赖、构建、验证和更新产物
- `apple-container`：使用 Orchard、Apple container 和原生 Compose 操作本机容器，核验运行时、网络和作业结果
- `zh-tech-writing`：编写和修改中文技术文档，检查句子、结构、排版和 AI 腔；引自 [leter/zh-tech-writing](https://github.com/leter/zh-tech-writing)，采用 MIT 许可

`mattpocock-skills-zh` 是 Matt Pocock《Skills for Real Engineers》的非官方中文翻译版，收录上游发布的 27 个稳定 skill，包括 `implement-spec`、`pr` 和 `retro`。推荐整包安装这个 plugin，无需逐个复制 skill 目录。

当前翻译同步至上游 [49dd158](https://github.com/mattpocock/skills/commit/49dd158d1076134a641b33efb035946536778336)（1.3.1）。本轮更新审查、故障诊断、工单和 tracker、寻路、交接、教学及 wizard 模板；正式发布清单保持 27 项。

[相关资料中文译文](docs/mattpocock-skills-zh/README.md)包含上游使用与维护说明，实验和未发布 skills 保留原状态，不加入安装插件。版本差异、覆盖范围、审查和验证见 [更新记录](docs/mattpocock-updates/20261013T164044Z-24fe0ef-49dd158.md)。

后续在本仓库调用 `$update-mattpocock-skills`，执行[专用更新流程](.agents/skills/update-mattpocock-skills/SKILL.md)。

上游子模块：

- `upstream/mattpocock-skills/`：`mattpocock/skills`

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

## 目录结构

```text
ghost-agent-market/
├── upstream/mattpocock-skills/
├── .claude-plugin/
│   └── marketplace.json
├── claude-code-market/
│   ├── .claude-plugin/marketplace.json
│   └── plugins/
│       ├── ghost-agent-skills/
│       │   ├── .claude-plugin/plugin.json
│       │   └── skills/
│       │       ├── apple-container/
│       │       ├── configure-gh-account/
│       │       ├── container-dev-workflow/
│       │       ├── git-commit/
│       │       ├── git-merge-conflict/
│       │       ├── spec-delivery/
│       │       └── zh-tech-writing/
│       └── mattpocock-skills-zh/
│           └── skills/
└── codex-market/
    ├── .agents/plugins/marketplace.json
    └── plugins/
        ├── ghost-agent-skills/
        │   ├── .codex-plugin/plugin.json
        │   └── skills/
        └── mattpocock-skills-zh/
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
```

安装或更新 `mattpocock-skills-zh` 后，请新开一个 Claude Code 会话或 Codex 任务，让 27 个 skill 重新加载。

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```

## 安装 ZCode Marketplace

ZCode 兼容读取 Claude 格式的 marketplace 与插件清单，无需单独维护 ZCode 副本。在 ZCode 客户端打开 **Settings → Plugin Management → Discover**，点击 **`+`** 添加 GitHub 仓库 `Ghost233/ghost-agent-market`，然后在 Discover 列表中安装 `ghost-agent-skills` 与 `mattpocock-skills-zh`。

如果添加或安装时克隆、下载失败，先为 ZCode 设置代理环境变量 `ZCODE_HTTP_PROXY=http://host:port`（裸 `http_proxy` 不会被读取），再重试。
