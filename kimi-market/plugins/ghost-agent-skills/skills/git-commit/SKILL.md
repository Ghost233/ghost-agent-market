---
name: git-commit
description: 使用固定 gpt-5.6-terra/medium 的执行子代理完成当前 checkout 的 Git 检查、提交规划、暂存、提交与最终核验，并由执行子代理再启动同配置的只读审查子代理独立复核；主线程只负责调度和转发结果。用户明确要求“提交代码”“提交当前改动”、`/git-commit`、`/skill:git-commit` 或 “commit these changes” 时使用；不用于只讨论 Git、解释提交或仅请求 push。
---

# Git 智能提交

在当前 checkout 中提交用户已授权的现有改动。保持用户改动，不创建 worktree，不切换分支，不 push，不改写历史。

## 角色拓扑

运行时只使用以下三级角色，不创建专用 agent 配置：

```text
ROLE=dispatcher
└── ROLE=executor
    └── ROLE=reviewer
```

- `dispatcher` 只创建一个 `executor`，不得创建 `reviewer`。
- `executor` 负责整个提交事务，只创建一个 `reviewer`，不得再创建 `executor`。
- `reviewer` 只读审查，不得创建任何代理。
- `executor` 和 `reviewer` 都固定使用 `gpt-5.6-terra`，思考强度固定为 `medium`。
- 两级子代理都禁止 fork 上级上下文。Codex `spawn_agent` 必须显式设置 `fork_turns: "none"`；使用提供 `fork_context` 的接口时必须设置为 `false`。
- 平台无法指定模型、无法禁用上下文 fork 或不支持嵌套子代理时停止，不执行 Git 写操作。

## 主线程：dispatcher

1. 从当前请求取得起始目录和用户授权范围，不运行 Git 命令，不读取仓库 diff，不规划提交。
2. 创建 `ROLE=executor` 子代理，只传递：本 SKILL.md 的绝对路径、起始目录、用户授权范围和必要的平台约束；不复制主线程聊天历史。Codex 使用 `spawn_agent`，显式设置 `task_name: "git_commit_executor"`、`fork_turns: "none"`、`model: "gpt-5.6-terra"` 和 `reasoning_effort: "medium"`。
3. 等待 `executor` 返回。主线程不得重复检查仓库、复核 diff、暂存或提交。
4. `executor` 请求用户确认时，向用户转发阻塞原因；用户回复后优先恢复原 `executor`，Codex 使用 `followup_task`，不得默认新建事务。
5. 向用户转发 `executor` 的最终汇总，并仅在其明确报告操作成功后输出对应 Git UI 指令。

## 一级子代理：executor

收到 `ROLE=executor` 后执行完整事务：

1. 完整读取本 SKILL.md，但只遵循 `executor` 和通用提交规则；读取适用的 `AGENTS.md` 等仓库指令。
2. 运行只读检查，确认仓库根目录、当前 checkout、staged、unstaged、untracked、submodule、Git identity、敏感文件和异常大文件。没有可提交改动时正常结束。
3. 记录 HEAD、submodule 指针、status、diff 与 cached diff 证据，创建 `ROLE=reviewer` 子代理；只向它传递本 SKILL.md 路径、仓库根目录、用户授权范围、仓库指令位置和当前 Git 证据，不传递聊天历史。Codex 使用 `spawn_agent`，显式设置 `task_name: "git_commit_reviewer"`、`fork_turns: "none"`、`model: "gpt-5.6-terra"` 和 `reasoning_effort: "medium"`。
4. 等待并汇总 reviewer 结果。reviewer 返回 `block`、发现越权内容、提交边界不明或无法可靠审查时，在任何 Git 写操作前停止并报告。
5. reviewer 通过后，重新读取紧凑的 HEAD、submodule 和 status 状态；证据已变化时停止，或把增量证据交给原 reviewer 复核一次，不得直接提交过期快照。
6. 根据职责、风险和可独立回滚性确定最终批次。submodule 有未提交改动时，从最深层 submodule 开始，再提交父仓库指针。
7. 执行全部暂存、提交和最终核验，不把写操作交回主线程。

## 二级子代理：reviewer

收到 `ROLE=reviewer` 后：

- 完整读取本 SKILL.md，但只遵循 `reviewer` 和通用提交规则。
- 只使用只读命令，独立核对状态、diff、submodule、Git identity、敏感内容、提交边界、显式路径和中文提交信息。
- 不修改文件，不暂存，不提交，不 push，不执行其他 Git 写操作。
- 默认最多使用 6 个工具回合；无法在限制内可靠完成时返回 `block`，不降低审查标准。
- 返回紧凑结构：`decision`、`snapshot`、`risks`、`batches`、`excluded`。不要复述完整 diff 或输出冗长过程记录。

## 效率约束

- 独立只读检查必须合并并行执行。在支持 `functions.exec` 的平台中使用一次调用内的 `Promise.all`；不要用 `&&`、`;` 或管道拼接 shell 命令。
- executor 在创建 reviewer 前默认不超过 3 个工具回合；reviewer 默认不超过 6 个工具回合。
- 不为本流程创建 `update_plan`，不发送非阻塞进度说明。
- 每个提交批次只保留两个模型检查点：暂存并审阅 cached diff；提交并读取 hash/status。
- 暂停后的用户确认只做增量复核，优先复用原 executor 和 reviewer。

## 通用提交规则

- 保留用户已有的合理 staged 内容；发现无关或归属不明的 staged 内容时停止并报告。
- 每批使用显式路径 `git add -- <paths>`；不要使用 `git add .` 或 `git add -A`。
- 暂存后运行 `git diff --cached --stat`、`git diff --cached` 和 `git diff --cached --check`，确认批次准确且不包含敏感内容。
- 使用中文 Conventional Commit：`<type>(<scope>): <描述>`。
- 每笔提交保留：

```text
Co-Authored-By: Nexus <nexus@xfinite.global>
```

- 不使用 `--no-verify` 绕过 hooks。hook 或 Git 命令失败时保留现场并报告，不自动回滚、amend 或重写历史。
- 每笔提交后读取 commit hash 和 `git status --short`；全部完成后检查所有涉及仓库和 submodule 的 staged、unstaged 与 untracked 状态。

## executor 完成回报

向 dispatcher 返回：reviewer 决策与关键风险、每个提交的 cwd/hash/信息、submodule 顺序、检查结果、剩余或排除的文件，以及成功的暂存和提交目录。不要把部分完成描述为整个工作区已经提交完成。
