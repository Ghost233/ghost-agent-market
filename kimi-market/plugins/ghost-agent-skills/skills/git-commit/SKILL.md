---
name: git-commit
description: Use when 用户明确要求“提交代码”“提交当前改动”、`$git-commit` 或 “commit these changes”；递归先提交已授权的 dirty submodule，再由父仓库记录最新 gitlink；不用于只讨论 Git、解释提交或仅请求 push。
---

# Git 智能提交

在当前 checkout 提交用户已授权的改动；不创建 worktree、不切分支、不 push、不改写历史。

## 主线程

主线程只调度，整个 git-commit 流程必须在一个子代理中运行。

1. 创建一个 ROLE=executor 子代理，只传 SKILL.md 路径、scripts/git_commit.py 路径、起始目录和授权范围。Codex 使用 spawn_agent：task_name="git_commit_executor"、model="gpt-5.6-terra"、reasoning_effort="medium"、fork_turns: "none"。
2. 主线程不运行 Git 命令，不读 diff，不规划或执行提交。平台不能创建上述子代理时停止，不得在主线程降级。
3. 一次长等待 executor；只转发其阻塞原因或最终结果。

## Executor

executor 不得创建任何代理；所有 Git 写操作只通过 `python3 <script> apply`。

1. 完整读取本文件和适用的 AGENTS.md。
2. 对起始仓库运行 `python3 <script> inspect --diff --repo <start-directory>`。`has_changes=false` 且无 submodule 工作时成功结束；identity 不匹配、授权范围不明或敏感文件未经确认时停止。
3. 逐项处理 `blocking_submodules`：仅含 `worktree-dirty` 时，在同一 executor 内对已授权的已初始化子模块递归执行本流程，始终先提交最深层仓库；含 `merge-conflict`、`uninitialized-changed`、`staged-pointer-not-checked-out` 或越权路径时停止并返回具体 reason。`staged-pointer-not-checked-out` 必须由用户决定保留暂存指针还是改用子模块当前 HEAD。用户授权“提交当前全部改动”时包含 dirty 子模块；路径限定授权不自动扩大。
4. 所有子模块提交完成后重新 inspect 父仓库。`gitlink_updates` 是父仓库必须审查并提交的普通路径，不得当作 dirty submodule；嵌套仓库逐层重复，直至根仓库。
5. 审查完整 diff，排除未授权文件，按职责生成中文 Conventional Commit 批次；每个 clean gitlink 必须指向对应子模块当前 HEAD。
6. 在仓库外的系统临时目录写入 plan JSON：

```json
{"head":"<inspect.head>","fingerprint":"<inspect.fingerprint>","batches":[{"paths":["file"],"message":"fix(scope): 中文说明"}]}
```

7. 运行 `python3 <script> apply --repo <repo-root> <plan.json>`，读取一次 JSON 结果。Codex managed sandbox 首次 apply 即使用 `sandbox_permissions=require_escalated` 请求写入 inspect 返回的 `git_dir`/`git_common_dir`；其他平台首次 apply 也按其沙箱规则取得 Git 元数据写权限，不先进行注定失败的无权限试跑。
8. 每层提交后核对父仓库记录的 gitlink 等于子模块 HEAD；最终核对所有参与仓库的工作区。返回每笔提交的 cwd/hash/message/paths、指针、检查结果、剩余及排除文件。

## 硬规则

- 不直接运行 git add 或 git commit；不使用 --no-verify。
- 每笔提交保留 `Co-Authored-By: Nexus <nexus@xfinite.global>`。
- apply、hook 或脚本失败时保留现场并如实报告；即使子模块已提交而父仓库失败，也不得重试、回滚、amend、push 或自动清理用户改动。
- 平台要求命令前缀时保留 `python3` 调用语义并按平台规则执行。
