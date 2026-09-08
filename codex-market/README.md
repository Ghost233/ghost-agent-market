# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目：

- `ghost-agent-skills`
- `mattpocock-skills-zh`
- `rtk-hook`

`ghost-agent-skills` 包含八个独立 skill：

- `git-commit`
- `git-merge-conflict`
- `compile-feature-knowledge`
- `ghost-matt-spec`：规划规格、模块合同与验收标准
- `ghost-matt-ticket`：拆解任务、依赖与并行边界
- `ghost-matt-implement`：当前分支并行开发、整轮验收与批量修复
- `ghost-matt-run-test`：单独执行指定测试，主线程分析原因
- `ghost-matt-test-report`：只读汇总覆盖、通过情况与缺口

`mattpocock-skills-zh` 是 Matt Pocock《Skills for Real Engineers》的非官方中文翻译版，收录上游发布的 25 个稳定 skill 与实验性 `implement-spec`。安装一个 plugin 即可加载整批 skill。

独立 `ghost-agent-skills` 插件中的 `git-commit` 在单个隔离 executor 中检查改动，并通过 Python 3 安全脚本创建规范的中文 Git 提交；`git-merge-conflict` 在修改冲突文件前先用只读 Bash 脚本锁定 merge/rebase/cherry-pick 三方和有界历史，再按考古证据解决高风险冲突；`compile-feature-knowledge` 把确认结论与验收证据合并为长期维护的 OKF 功能档案；五个 `ghost-matt-*` 工作流独立运行，主线程协调当前分支共享工作区，先收齐整轮测试再批量修复；需要子代理时保留 `gpt-5.6-terra/xhigh`。此版先在 Codex 试用，Claude/ZCode 待用户验证后同步。`rtk-hook` 通过 `rtk rewrite` 透明改写 RTK 支持的 shell 命令，不支持的命令原样放行，也不再阻断后要求重试。

## 安装

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse .agents --sparse codex-market
codex plugin marketplace upgrade ghost-agent-market
codex plugin add ghost-agent-skills@ghost-agent-market
codex plugin add mattpocock-skills-zh@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装或更新后，请新开一个 Codex 任务加载新增 skill。

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。
