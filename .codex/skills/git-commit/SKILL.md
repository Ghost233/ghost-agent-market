---
name: git-commit
description: |
  分析当前仓库的已暂存、未暂存和 submodule 变更，按职责拆分批次并直接创建中文 Git 提交。
  用户明确输入 `/git-commit`、要求“提交代码”“提交当前改动”或“commit these changes”时使用；
  不用于只讨论 commit、解释 Git 或请求 push。Codex 调度线程创建本地执行线程，进行一次启动健康检查，并仅接收失败通知。
---

# Git 智能提交

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
thinking: high
prompt: <GIT_COMMIT_EXECUTOR 执行包>
```

4. `create_thread` 会在新线程的委派元数据中附加当前调度线程的 `source_thread_id`。执行包必须要求执行线程读取该值，并将其保存为非空的 `SOURCE_THREAD_ID`；缺失时不得进行 Git 写操作。
5. 执行包还必须包含 `GIT_COMMIT_EXECUTOR=1`、仓库绝对路径、用户原始提交范围，并明确要求：使用当前项目本地 `$git-commit`；检测到执行标记后跳过本节，不再创建线程；直接从“预检”开始完成全部提交；不使用 worktree、不切换分支、不 push、不自动归档；成功时静默结束，只有失败或阻塞时才向 `SOURCE_THREAD_ID` 通知一次。
6. `create_thread` 返回 thread id 后立即使用 `set_thread_title` 设置第 2 步生成的标题。任一接口拒绝指定模型或强度、缺少 thread id、命名失败时停止；不要降低强度、替换模型或回退到其他调度方式。
7. 命名成功后等待 10 秒，仅调用一次 `read_thread` 进行启动健康检查：
   - `running`，或已出现模型回复、工具调用、提交结果时，视为正常启动。不得继续读取、等待或干预。
   - `systemError`，或线程已终止但没有任何模型回复和工具调用时，视为启动失败。只有同时确认没有 Git 写操作时，才允许执行第 8 步。
   - 状态不明确、读取失败、线程被用户中断，或无法排除已经发生 Git 写操作时，不得 fallback；报告检查结果后停止，避免重复提交。
8. 启动失败时，仅调用一次 `send_message_to_thread` 在原执行线程重试，固定传入：

```text
threadId: <create_thread 返回的 thread id>
model: gpt-5.4-mini
thinking: high
prompt: GIT_COMMIT_EXECUTOR=1；启动检查触发一次性 fallback；沿用原执行包、SOURCE_THREAD_ID 和当前 checkout，从预检开始执行；不得再次 fallback 或委派。
```

9. 向用户报告执行线程的 thread id、标题、启动检查结果，以及实际使用的 `gpt-5.3-codex-spark/high` 或 `gpt-5.4-mini/high fallback` profile evidence 后立即结束当前任务。fallback 请求成功后也不得再次读取、等待、轮询、发送消息、归档执行线程或以其他方式追踪和干预。

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

## 执行线程回报

报告：

- 每个仓库和批次的 commit hash、提交信息和文件范围。
- submodule 到主工程的实际提交顺序。
- 执行线程标题、实际使用的 `gpt-5.3-codex-spark/high` 或 `gpt-5.4-mini/high fallback` profile evidence、hooks 和 `git diff --cached --check` 结果。
- 剩余 staged、unstaged、untracked 和被排除的敏感或无关文件。

不要把“部分批次已提交”描述为整个工作区已提交完成。
