---
name: git-commit
description: Use when 用户明确要求“提交代码”“提交当前改动”、`$git-commit` 或 “commit these changes”；不用于只讨论 Git、解释提交或仅请求 push。
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
2. 运行 `python3 <script> inspect --diff --repo <start-directory>`。无改动时结束；identity 不匹配、dirty_submodules 非空、授权范围不明或敏感文件未经确认时停止。
3. 审查完整 diff，排除未授权文件，按职责生成中文 Conventional Commit 批次。
4. 写入临时 plan JSON：

```json
{"head":"<inspect.head>","fingerprint":"<inspect.fingerprint>","batches":[{"paths":["file"],"message":"fix(scope): 中文说明"}]}
```

5. 运行 `python3 <script> apply --repo <repo-root> <plan.json>`，读取一次 JSON 结果；失败或部分完成时不重试、不回滚。
6. 返回每笔提交的 cwd/hash/message/paths、检查结果、剩余及排除文件。

## 硬规则

- 不直接运行 git add 或 git commit；不使用 --no-verify。
- 每笔提交保留 `Co-Authored-By: Nexus <nexus@xfinite.global>`。
- hook 或脚本失败时保留现场并如实报告；不得 amend、push 或自动清理用户改动。
- 平台要求命令前缀时保留 `python3` 调用语义并按平台规则执行。
