---
name: git-commit
description: |
  分析当前仓库的已暂存、未暂存和 submodule 变更，按职责拆分批次并直接创建中文 Git 提交。
  用户明确输入 `/git-commit`、要求“提交代码”“提交当前改动”或“commit these changes”时使用；
  不用于只讨论 commit、解释 Git 或请求 push。Claude Code 当前主会话负责全部分析、stage 和 commit。
---

# Git 智能提交

在当前 checkout 中分析并提交用户授权的现有改动。保持用户改动，不创建 worktree，不切换分支，不 push，不改写历史。本实现不启动分析子代理，因此不发生上下文 fork，也不指定替代模型；分析和 Git 写入始终使用当前主会话的执行模型。Codex 端的 `fork_context: false`、`fork_turns: "none"` 和子代理能力探测不适用于 Claude Code。


## 永久 Owner 仓库的清单模式

运行 `git rev-parse --show-toplevel` 后，首先检查仓库根的 `.ghost-agent-workflow/owners/registry.json`。文件存在时必须进入本节，并在本节结束；禁止继续执行后面的通用分析/主会话 diff 复核流程。Registry 不存在时才使用后续旧流程。

清单模式中的 Git 控制器是机械 actor，不是模块 Owner。它只能读取 Registry、runtime state、`DELIVERY_MANIFEST_V1`、`COMMIT_ATTESTATION_V1`、Git identity/status/name-only/check/hash；不得读取 `git diff`、`git show` 的模块内容，不得搜索或语义审查模块代码，也不得替 Owner 修改提交信息或文件分组。

1. 从当前已完成 Goal 的 commit-readiness evidence 取得精确 delivery manifest；若需发现候选，只按 runtime state 的 accepted artifact ref 机械查找，不能按时间戳盲选。多个或没有当前候选时停止。
2. 运行 `node <plugin-root>/scripts/goal-dag.mjs delivery-validate <delivery-manifest.json>`。只有 `status: valid` 才继续；它会重新核对 worktree、HEAD、Registry digest、`workspace_change_seq`、diff-scope evidence、Owner attestations、敏感/runtime/未归属路径和 `git diff --check`。
3. 机械比较 `git status --porcelain=v1 -z` 全部可交付路径和 manifest `changed_files[]`。集合不完全相等、存在脏 submodule 内部内容、清单外 staged 内容或 HEAD 改变时，在任何写入前停止。Goal/Plan/runtime 路径永不提交。
4. 读取仓库指令和 Git identity；身份不符即停止。要求 `commit_strategy: single_atomic`，所有 Owner 已通过 attestation 同意同一个顶层 `commit_message`。
5. 用 manifest 完整显式路径集合暂存一次；只用 `git diff --cached --name-only`、`git diff --cached --check` 和 status 核验路径，不显示模块 diff。使用共同批准的 message 创建一个原子提交，保留仓库要求的 trailer；不得拆分、合并或改写语义。

清单模式不启动通用分析代理。最终只报告 manifest/attestation digest、sequence、commit hash、name-only/check 和剩余 status，不输出模块 diff。


提交顺序是硬约束：先从最深层脏 submodule 向外提交，再提交主工程中的 submodule 指针和其他改动。

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

对每个批次依次执行：

1. 使用显式路径 stage。
2. 运行 `git diff --cached --stat` 和 `git diff --cached`，确认只包含该批次、没有敏感文件、没有遗漏或意外删除。
3. 执行 `git diff --cached --check`。
4. 创建提交。不得使用 `--no-verify` 绕过 hooks。
5. hook 或 commit 失败时保留现场并报告。只在当前授权范围内修复；需要扩大修改范围时停止。
6. 提交后读取新 hash，并重新运行 `git status --short`；再决定是否继续下一批次。

## 最终回报

报告：

- 每个仓库和批次的 commit hash、提交信息和文件范围。
- submodule 到主工程的实际提交顺序。
- hooks 和 `git diff --cached --check` 结果。
- 剩余 staged、unstaged、untracked 和被排除的敏感或无关文件。

不要把“部分批次已提交”描述为整个工作区已提交完成。
