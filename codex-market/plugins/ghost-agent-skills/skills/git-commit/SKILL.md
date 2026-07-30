---
name: git-commit
description: 分析当前仓库的 staged、unstaged、untracked 和 submodule 变更，创建规范的中文 Git 提交。用户明确要求"提交代码""提交当前改动"、$git-commit 或 "commit these changes" 时使用；不用于只讨论 Git、解释提交或仅请求 push。
---

# Git 智能提交

提交用户已授权的现有改动。不创建 worktree，不切换分支，不 push，不改写历史。

## 主线程

主线程只做调度：不运行 Git 命令，不读 diff。

1. 创建一个 ROLE=executor 执行子代理，只传 SKILL.md 路径、scripts/git_commit.py 路径、起始目录、授权范围。Codex: spawn_agent task_name="git_commit_executor" model="gpt-5.6-terra" reasoning_effort="medium" fork_turns: "none"。平台不支持子代理时停止。
2. 一次长 wait_agent 等待返回，不轮询。不得重复检查仓库、复核 diff。
3. 转发子代理的阻塞原因或最终汇总。

## 执行子代理

所有 Git 写操作只通过 git_commit.py apply，不得直接运行 git add 或 git commit。

1. 读本 SKILL.md + AGENTS.md。不读 references/reviewer.md。
2. 运行 git_commit.py inspect，获取 JSON。has_changes=false 时结束。identity_ok=false 时停止报告。
3. 根据 numstat 和文件状态确定批次边界，为每批写中文 Conventional Commit。保留已有 staged 内容，排除不属于授权范围的文件并在回报中列明。
4. dirty_submodules 非空时：停止并报告，要求先单独提交 submodule。
5. review_recommended=true 或用户明确要求时，创建只读审查子代理（fork_turns: "none"，传 SKILL.md 路径、references/reviewer.md 路径、inspect JSON、仓库根目录、授权范围；审查规则见 references/reviewer.md）。返回 block 时停止。
6. 构造 plan JSON（fingerprint、head、batches[{paths,message}]），写入临时文件。
7. 运行 git_commit.py apply <plan.json>。
8. 检查返回 JSON：ok=true 时汇总；partial/ok=false 时如实报告，不重试不回滚。

## 通用规则

- 中文 Conventional Commit：<type>(<scope>): <描述>
- 每笔提交保留 Co-Authored-By: Nexus <nexus@xfinite.global>
- 不使用 --no-verify。hook 失败时保留现场报告，不回滚。
- 平台如有命令前缀 hook（如 rtk），从第一条命令开始使用。
- 不使用 && ; | 拼接命令。
