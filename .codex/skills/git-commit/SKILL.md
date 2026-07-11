---
name: git-commit
description: |
  分析当前仓库的已暂存、未暂存和 submodule 变更，按职责拆分批次并直接创建中文 Git 提交。
  用户明确输入 `/git-commit`、要求“提交代码”“提交当前改动”或“commit these changes”时使用；
  不用于只讨论 commit、解释 Git 或请求 push。Codex 调度线程创建本地执行线程，进行一次启动健康检查，并仅接收失败通知。
---

# Git 智能提交

本实现仅用于 Codex App，依赖其用户可见线程工具和运行时模型参数。在本仓库提交此 skill 时，这项专属依赖就是 `AGENTS.md` 所要求的单端实现理由；只校验项目测试版与 Codex marketplace 源同步。

在当前 checkout 中分析并提交用户授权的现有改动。保持用户改动，不创建 worktree，不切换分支，不 push，不改写历史。

提交顺序是硬约束：先从最深层脏 submodule 向外提交，再提交主工程中的 submodule 指针和其他改动。

## 专用执行线程

本 skill 有两种运行状态。用户正常调用 `$git-commit` 时进入调度状态；任务提示中存在独占标记 `GIT_COMMIT_EXECUTOR=1` 时进入执行状态。

### 调度状态

调度线程只创建并命名执行线程，不得 stage、commit 或进行其他 Git 写操作。

1. 使用 `git rev-parse --show-toplevel` 取得仓库绝对路径，再用 `list_projects` 按该路径唯一解析 project id。解析失败时停止。
2. 使用 `date '+%H:%M:%S'` 生成标题 `<时:分:秒>-git-commit`。
3. 使用 `create_thread` 在同一项目的 local 环境创建执行线程，固定传入：

```text
target: {type: project, projectId: <resolved>, environment: {type: local}}
model: gpt-5.3-codex-spark
thinking: xhigh
prompt: <GIT_COMMIT_EXECUTOR 执行包>
```

4. `create_thread` 会在新线程的委派元数据中附加当前调度线程的 `source_thread_id`。执行包必须要求执行线程读取该值，并将其保存为非空的 `SOURCE_THREAD_ID`；缺失时不得进行 Git 写操作。
5. 执行包还必须包含 `GIT_COMMIT_EXECUTOR=1`、仓库绝对路径、用户原始提交范围，并明确要求：使用当前项目本地 `$git-commit`；检测到执行标记后跳过本节，不再创建线程；直接从“预检”开始完成全部提交；不使用 worktree、不切换分支、不 push、不自动归档；成功时静默结束，只有失败或阻塞时才向 `SOURCE_THREAD_ID` 通知一次。
6. `create_thread` 返回 thread id 后执行最多三轮启动确认。每轮必须依次：等待 10 秒；调用一次 `read_thread`；尚未命名成功时调用一次 `set_thread_title`；立即按第 8 步判断。命名成功后后续轮次不得重复改名；单次读取或命名失败只记录原始错误。
7. 只有同时满足以下条件才算启动成功，可提前结束确认循环：
   - `read_thread` 已返回该 thread id，证明线程存在。
   - 状态为 `running`、`active` 或 `inProgress`，或者线程已经正常完成。
   - 已出现执行线程产生的记录，例如 reasoning、助手回复（包括“思考中”）或工具调用。只有原始 `userMessage`、`codex_delegation`、空 items 或自动标题不算启动成功。
8. 每轮读取后立即处理：
   - 已确认启动：不 fallback，立即结束确认循环；标题失败只作为警告报告。
   - 首次出现 `systemError` 或其他终止失败，且没有执行线程记录并能确认没有 Git 写操作：立即执行第 9 步，不等待剩余轮次。标题是否成功不得阻断 fallback。
   - 状态仍在运行但没有执行线程记录、读取失败或暂时找不到线程：继续下一轮，直到最多三轮。
   - 线程被用户中断或无法排除 Git 写操作：状态记为“启动未确认”，立即停止且不得 fallback，避免重复提交。
   - 第三轮仍未确认启动且不满足安全 fallback 条件：报告“启动未确认”，停止读取和改名，不得进行第四轮。
9. 安全确认启动失败时，仅调用一次 `send_message_to_thread` 在原执行线程重试，固定传入：

```text
threadId: <create_thread 返回的 thread id>
model: gpt-5.6-luna
thinking: xhigh
prompt: GIT_COMMIT_EXECUTOR=1；启动检查触发一次性 fallback；沿用原执行包、SOURCE_THREAD_ID 和当前 checkout，从预检开始执行；不得再次 fallback 或委派。
```

10. 向用户报告执行线程的 thread id、实际查询轮数、最终标题或命名失败、启动检查结果，以及实际使用的 `gpt-5.3-codex-spark/xhigh` 或 `gpt-5.6-luna/xhigh fallback` profile evidence 后立即结束当前任务。fallback 请求成功后也不得再次读取、等待、轮询、发送消息、归档执行线程或以其他方式追踪和干预。

模型和思考强度以 `create_thread` 或一次性 fallback 的 `send_message_to_thread` 调用参数为运行时证据。不得传入 `reasoning.summary`、`reasoning.summary_level`、`summary`、`service_tier` 或 `priority`。

### 执行状态

看到 `GIT_COMMIT_EXECUTOR=1` 后，先从委派元数据读取非空的 `source_thread_id` 作为 `SOURCE_THREAD_ID`。fallback 消息必须沿用同一值。不得调用 `create_thread`、`fork_thread`、`spawn_agent` 或再次委派，不得自行 fallback。当前线程就是唯一执行线程，直接按下述流程分析、复核并串行完成全部 Git 写操作。

`SOURCE_THREAD_ID` 缺失时，在任何 Git 写操作前停止并在当前线程报告配置错误。此时没有可靠的回传目标，不得猜测 thread id。

## 预检

1. 运行 `git rev-parse --show-toplevel`，确认仓库根目录和当前 checkout。
2. 读取适用于根仓库及目标 submodule 的仓库指令文件，例如 `AGENTS.md`。
3. 运行 `git status --short`、`git diff --stat`、`git diff`、`git diff --cached --stat`、`git diff --cached` 和 `git submodule status`。
4. 区分调用前已暂存内容、未暂存内容、未跟踪文件、submodule 指针和 submodule 内部改动；不要把调用前已暂存内容误归到新批次。
5. 在每个将提交的仓库中读取 `git config user.name` 和 `git config user.email`。身份不符合仓库指令时停止，不创建提交。
6. 检查 `.env*`、credentials、私钥、token、证书、生产配置和疑似生成的大文件。存在敏感或归属不明内容时保持未暂存并报告。

没有可提交改动时停止，返回当前状态；不要创建空提交。

## 决策边界

- 只为解决客观疑点读取一次必要的指令、diff 或历史；证据充分后立即决定提交或失败，不反复考古。
- 只有身份不符、敏感内容、归属不明的 staged 内容、明确违反仓库指令或 Git 命令失败才阻塞。明确记录的平台差异不是阻塞理由。
- 多轮用户编辑可能在一次提交前累计多次合法版本递增。若最终版本格式、进位和 cachebuster 均符合仓库规则，不得仅因它高于 `HEAD + 0.0.1` 而降级、改写或停止。
- 当前授权范围内的问题能安全修复时直接修复并继续；必须扩大范围时才停止并通知。

## 规划提交批次

- 以职责、风险和可独立回滚性分组；文档、测试、配置和实现只有在服务同一变更时才放入一笔提交。
- 保留用户已有的合理 staged batch。若 staged 内容混合无关职责，先报告冲突；不要静默取消暂存或重排用户 staging。
- 为每个批次列出显式路径，使用 `git add -- <paths>`。不要使用 `git add -A`、`git add .` 或其他会吸收无关文件的宽泛命令。
- 使用中文 Conventional Commit：`<type>(<scope>): <描述>`。从实际 diff 判断 scope，不套用固定目录名。

常用类型：`feat`、`fix`、`refactor`、`docs`、`test`、`style`、`chore`。

每笔提交保留以下 trailer：

```text
Co-Authored-By: Nexus <nexus@xfinite.global>
```

## Submodule 顺序

1. 对每个脏 submodule 重复预检、身份检查、显式 staging、cached diff 复核和提交。
2. 存在嵌套 submodule 时从最深层开始，逐层提交父级指针。
3. submodule 提交失败或仍有未解释改动时停止；不要继续提交主工程指针。
4. 回到主工程重新读取状态，把已完成的 submodule 指针纳入对应主工程批次。

submodule 提交与主工程提交必须是不同提交。

## 执行提交

Codex 沙盒阻止写入 Git index/refs 时，执行线程使用 `sandbox_permissions: "require_escalated"`，并用最小、具体的 justification 请求授权；只读检查不提权。

对每个批次依次执行：

1. 使用显式路径 stage。
2. 运行 `git diff --cached --stat` 和 `git diff --cached`，确认只包含该批次、没有敏感文件、没有遗漏或意外删除。
3. 执行 `git diff --cached --check`。
4. 创建提交。不得使用 `--no-verify` 绕过 hooks。
5. hook 或 commit 失败时保留现场并报告。只在当前授权范围内修复；需要扩大修改范围时停止。
6. 提交后读取新 hash，并重新运行 `git status --short`；再决定是否继续下一批次。

## 完成与失败通知

以下情况视为正常完成：全部授权批次已提交，或预检确认没有可提交改动。正常完成时只在执行线程内报告结果并自然结束；不得向 `SOURCE_THREAD_ID` 发送消息，不得归档自身。

任何导致授权提交未完整完成的终止状态都视为失败，包括工具或模型拒绝、身份不符、安全检查阻塞、Git 或 hook 失败以及部分提交后无法继续。失败时：

1. 保留现场，不自动回滚已完成提交或 staging。
2. 仅调用一次 `send_message_to_thread`，目标 `threadId` 为 `SOURCE_THREAD_ID`；省略 `model` 和 `thinking`，保持源线程原有 profile。
3. 消息必须包含执行线程标题、失败阶段、原始错误、已经创建的 commit，以及最新 staged、unstaged、untracked 状态。开头使用 `[git-commit 执行失败]`。
4. 无论通知成功或失败，都不得重试、等待源线程响应或继续执行；在当前线程记录通知结果后自然结束。

通知采用固定结构：

```text
[git-commit 执行失败]
线程：<title>
阶段：<stage>
错误：<raw error>
已提交：<commits or none>
状态：<staged / unstaged / untracked>
```

## 执行线程回报

报告：

- 每个仓库和批次的 commit hash、提交信息和文件范围。
- submodule 到主工程的实际提交顺序。
- 执行线程标题、实际使用的 `gpt-5.3-codex-spark/xhigh` 或 `gpt-5.6-luna/xhigh fallback` profile evidence、hooks 和 `git diff --cached --check` 结果。
- 剩余 staged、unstaged、untracked 和被排除的敏感或无关文件。

不要把“部分批次已提交”描述为整个工作区已提交完成。
