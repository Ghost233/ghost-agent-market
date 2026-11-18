# Ghost Home Repo for DSH

Home Repo 跨仓库协作 skill，用于管理多个仓库的 feature 开发，协调子代理并行工作。

## 什么是 Home Repo

Home Repo 是一个统一的 git 仓库，用于：
- 存放跨仓库的规范和文档
- 协调跨仓库 feature 的开发
- 作为 agent team 的启动点

## 包含的 Skills

- **home-repo-init**：初始化当前目录为 Home Repo
- **home-repo-coordinate**：协调跨仓库 feature 的开发

## 子仓库 Skill 发现

插件注册的动态 Provider 会在每次编目时扫描会话工作目录的**一层子目录**，
把各成员仓库里的专有 skill 自动带进 catalog：

- 扫描 `<子目录>/.dsh/skills/` 与 `<子目录>/.agents/skills/`（两者都收，.dsh 优先）
- 跳过隐藏目录、`*.worktrees`、`node_modules`
- 注册名为 `<仓库前缀>-<skill名>`，前缀由仓库目录名归一化得到：
  转小写、仅保留小写字母与连字符、合并连续连字符（不分词、不拆驼峰）。
  例：`GhostCodexSentinel/.agents/skills/deploy-release` → `ghostcodexsentinel-deploy-release`
- 菜单描述带 `[仓库名]` 标签，同名 skill 一眼区分归属
- 模型可自动路由调用（各仓库同名的发布类 skill 通过前缀区分）
- 编辑 SKILL.md 零延迟生效；新增/删除 skill 通过文件监听自动刷新 catalog，无需重启

设计决策记录见 [docs/adr/0001-subrepo-skill-discovery.md](docs/adr/0001-subrepo-skill-discovery.md)，
术语见 [docs/GLOSSARY.md](docs/GLOSSARY.md)。

## 安装

在 DSH profile 的 `package.json` 中加入依赖（指向 GitHub release 资产）：

```json
"dsh-ghost-home-repo": "https://github.com/Ghost233/ghost-agent-market/releases/download/dsh-ghost-home-repo-v0.1.1/dsh-ghost-home-repo-0.1.1.tgz"
```

并把 `"dsh-ghost-home-repo"` 加入 `dsh.profile.bundles`，然后 `pnpm install` 并重启 DSH。

## 发布新版本

发布由 GitHub Actions 完成（`.github/workflows/release-dsh-home-repo.yml`），不手动打包上传：

1. 更新 `dsh-market/ghost-home-repo/package.json` 的 `version`
2. 合入 main，打 tag `dsh-ghost-home-repo-v<version>` 并推送
3. CI 自动：冒烟测试 → 打包校验 → 创建 release（带 SHA256SUMS 与下载一致性校验）
4. 更新 profile 里的依赖 URL 版本号，`pnpm install` 后重启 DSH

## 使用

### 初始化 Home Repo

在你想要作为 Home Repo 的目录里：

```
使用 home-repo-init skill
```

### 协调跨仓库 Feature

在 Home Repo 里：

```
使用 home-repo-coordinate skill
```

## 核心概念

### Lead Agent 协调模式

- Lead agent 在 Home Repo 里运行，负责协调
- 每个子代理只负责一个仓库的一个 issue
- 子代理之间不直接通信，所有跨仓库协调通过 lead agent
- 子代理的 prompt 里预先提供所有需要的上下文

### Worktree 隔离

- 每个 feature 在独立的 worktree 里开发
- 子代理只在自己的 worktree 里工作
- 通过 prompt 约定和上下文预提供，避免子代理跑偏

## 文档

- [Home Repo Pattern](https://www.aihero.dev/the-home-repo-pattern)
- [DSH Bundle 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

## 许可

MIT
