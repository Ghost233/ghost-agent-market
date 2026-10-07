# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目：

- `ghost-agent-skills`
- `mattpocock-skills-zh`

`ghost-agent-skills` 包含三个独立 skill：

- `git-commit`
- `git-merge-conflict`
- `configure-gh-account`：配置项目的 Codex GitHub 账号环境，复用已有 gh 登录并验证身份

`mattpocock-skills-zh` 是 Matt Pocock《Skills for Real Engineers》的非官方中文翻译版，收录上游发布的 27 个稳定 skill，包括 `implement-spec`、`pr` 和 `retro`。安装一个 plugin 即可加载整批 skill。

独立 `ghost-agent-skills` 插件中的 `git-commit` 在单个隔离 executor 中检查改动，并通过 Python 3 安全脚本创建规范的中文 Git 提交；`git-merge-conflict` 在修改冲突文件前先用只读 Bash 脚本锁定 merge/rebase/cherry-pick 三方和有界历史，再按考古证据解决高风险冲突；`configure-gh-account` 配置项目的 Codex GitHub 账号环境，复用已有登录并验证身份。

## 安装

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse .agents --sparse codex-market
codex plugin marketplace upgrade ghost-agent-market
codex plugin add ghost-agent-skills@ghost-agent-market
codex plugin add mattpocock-skills-zh@ghost-agent-market
```

安装或更新后，请新开一个 Codex 任务加载新增 skill。
