---
name: git-commit
description: 自动分析当前仓库未提交代码并直接提交。触发词：/git-commit、"提交代码"、"commit"。Codex 环境下主线程先启动普通 worker 子代理做只读 diff 分析，model 优先使用 gpt-5.3-codex-spark，如果该模型不可用则回退到 gpt-5.4-mini，reasoning_effort=xhigh、fork_context=false；Claude Code 环境不要求使用子代理。主线程负责最终校验、stage 和 commit，并严格按 submodule 到主工程顺序提交（无需确认）。
---

# Git 智能提交

自动分析未提交代码变更，生成提交信息并**直接提交**。

本 skill 在 Codex 环境可使用子代理做只读分析；Claude Code 环境不要求使用子代理。主线程保留所有 git 写操作。

提交顺序是硬约束：

1. 先提交 `git submodule`
2. 再提交主工程

不要反过来提交。

## 主线程与子代理

- **最高优先级：本 skill 在任何环境下都禁止创建 git worktree。**
- **不得调用任何带 `isolation: "worktree"` / `--worktree` / `git worktree` / `EnterWorktree` 的执行方式。**
- 本 skill 必须在当前 checkout / same-directory 中执行；不得复制仓库、不得创建临时 worktree、不得切换到隔离目录。

### Codex 分支

Codex 环境下，主线程必须先启动普通 `worker` 子代理做只读分析，参数必须是：

- `agent_type`: `worker`
- `model`: 优先使用 `gpt-5.3-codex-spark`；如果该模型不可用，回退到 `gpt-5.4-mini`
- `reasoning_effort`: `xhigh`
- `fork_context`: `false`
- 不允许创建 worktree；子代理必须使用当前 checkout / same-directory，不得使用 worktree 隔离

子代理只允许执行只读命令，例如 `git status`、`git diff`、`git diff --stat`、`git submodule status`、`rg`、`sed`、`pwd`。子代理不得执行 `git add`、`git commit`、`git push`、`git pull`、`git merge`、`git rebase`、`git reset`、`git checkout`、`git switch`、`git stash`，不得修改文件。

子代理输出必须聚焦：

- 当前分析范围
- 变更文件列表和风险点
- 是否涉及 submodule / 敏感文件
- 建议提交批次
- 建议中文提交信息

主线程必须复核当前 `git status` / `git diff`，不得只凭子代理结论提交。

### Claude Code 分支

Claude Code 环境下不要求使用子代理。当前主线程直接执行只读 diff / submodule 分析，并保留所有 stage / commit 写操作。

执行前用 `pwd` 确认在仓库根目录，且当前路径不能是 `.claude/worktrees` 或任何 git worktree。不得创建 worktree，不得调用 `git worktree`，不得使用 `EnterWorktree`，不得复制仓库。

## Codex 沙盒权限

主线程最终执行 `git add` / `git commit`（包括 submodule 内提交和主工程提交）时，Codex 环境默认使用 exec `sandbox_permissions: "require_escalated"`，justification: “需要写入 Git index/refs 完成用户要求的提交”。

只读命令如 `git status` / `git diff` / `git submodule status` 不默认提权。

## 并行分析策略

- 普通小改动：Codex 环境启动 1 个 worker 分析整个 dirty tree；Claude Code 环境由主线程直接分析整个 dirty tree。
- 文件很多、目录跨度大、或同时存在多个 submodule：Codex 环境可以启动多个 worker 并行分析不同目录、不同 submodule 或不同提交批次；Claude Code 环境不要求使用子代理，优先由主线程分批处理。
- 多 worker 只能并行做只读分析；最终 staging 和 commit 必须由主线程串行完成。
- 如果子代理结论互相冲突，以主线程重新检查的实际 git 状态为准。

## 工作流程

1. `git status` - 查看主工程未提交文件
2. Codex 环境启动指定模型 worker 子代理做只读 diff / submodule 分析；Claude Code 环境由主线程直接分析
3. 文件过多时，Codex 环境按目录、submodule 或提交批次拆分多个只读 worker 并行分析；Claude Code 环境由主线程分批处理
4. 主线程汇总并复核子代理结论，识别是否存在 submodule 指针变更或脏 submodule
5. 若存在脏 submodule：
   - 进入每个 submodule 查看 `git status` / `git diff`
   - 先在 submodule 内完成提交
   - 如果有嵌套 submodule，按最深层开始逐层向外提交
6. 回到主工程重新检查 `git status`
7. `git diff` - 分析主工程剩余变更（包括新的 submodule 指针）
8. 生成提交信息：`<type>(<scope>): <描述>`
9. **主线程直接执行**主工程提交
10. 显示提交结果

## Submodule 规则

- 只要 submodule 内有未提交改动，必须先提交 submodule，再提交主工程的 submodule 指针
- submodule 提交和主工程提交要拆成两笔，不能混成一笔
- 如果用户要求“按顺序提交”，默认顺序就是：`submodule -> 主工程`
- 如果 submodule 已提交、主工程只剩指针变更，主工程再单独提交一笔
- 如果没有 submodule 改动，按普通单仓库提交流程执行

## 提交类型

| 类型 | 触发词 |
|------|--------|
| feat | 新增、添加、创建、实现 |
| fix | 修复、解决、处理 |
| refactor | 重构、优化、改进 |
| docs | 文档、注释 |
| style | 格式 |
| test | 测试 |
| chore | 配置、依赖 |

## Scope 判断

- **ui**: 界面、视图、组件
- **api**: 接口、网络
- **data**: 数据、存储
- **util**: 工具
- **config**: 配置

## 合作者

每次提交末尾添加：
```
Co-Authored-By: Nexus <nexus@xfinite.global>
```

## 注意

- 中文提交信息
- 不提交 .env、credentials 等敏感文件
- 改动过大建议提醒用户拆分
