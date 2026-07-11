---
name: git-commit
description: |
  分析当前仓库的已暂存、未暂存和 submodule 变更，按职责拆分批次并直接创建中文 Git 提交。
  用户明确输入 `/git-commit`、要求“提交代码”“提交当前改动”或“commit these changes”时使用；
  不用于只讨论 commit、解释 Git 或请求 push。Codex 主线程保留全部 Git 写操作，并用只读 worker 辅助分析。
---

# Git 智能提交

在当前 checkout 中分析并提交用户授权的现有改动。保持用户改动，不创建 worktree，不切换分支，不 push，不改写历史。

提交顺序是硬约束：先从最深层脏 submodule 向外提交，再提交主工程中的 submodule 指针和其他改动。

## Codex 只读分析 Worker

主线程必须按名称启动项目级 custom agent `git_commit_worker` 分析 dirty tree；文件很多或存在多个独立 submodule 时，可按目录或 submodule 增加同一 agent。定义文件必须位于当前 checkout 的 `.codex/agents/git-commit-worker.toml`。

- 启动前读取并验证 agent 定义：`name=git_commit_worker`、`model=gpt-5.3-codex-spark`、`model_reasoning_effort=high`、`sandbox_mode=read-only`。定义缺失、不可发现或字段不匹配时，必须在任何 Git 写操作前停止并报告 `git_commit_worker unavailable`。
- 使用当前 checkout / same-directory，设置 `fork_turns: "none"`，只传仓库根目录、只读范围和结果契约；不得使用未绑定模型的普通 worker。
- 模型和思考强度以 agent 定义为运行时来源，不靠提示词覆盖。不得主动传入 `reasoning.summary`、`reasoning.summary_level`、`summary` 或 service tier / priority 参数。
- 若 custom agent 创建或首次模型请求被参数 schema 拒绝，必须在任何 Git 写操作前停止并原样报告错误；不要回退到其他模型，也不要改由主线程直接提交。
- 只允许 `git status`、`git diff`、`git diff --cached`、`git submodule status`、`rg`、`sed`、`pwd` 等只读命令。
- 禁止 worker 修改文件、stage、commit、push、pull、merge、rebase、reset、checkout、switch、stash 或创建 worktree。
- 要求 worker 返回：`agent_name`、`model`、`model_reasoning_effort`、分析范围、changed files、风险、submodule 状态、敏感文件、建议批次和中文提交信息。返回的 agent/model/effort 任一与定义不一致时，停止并报告，不创建提交。

主线程必须重新读取实际 Git 状态并复核结果；不得仅凭 worker 声明提交。所有 Git 写操作保持串行并由主线程执行。

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

Codex 沙盒阻止写入 Git index/refs 时，主线程使用 `sandbox_permissions: "require_escalated"`，并用最小、具体的 justification 请求授权；只读检查不提权。

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
- worker 分析范围、hooks 和 `git diff --cached --check` 结果。
- 剩余 staged、unstaged、untracked 和被排除的敏感或无关文件。

不要把“部分批次已提交”描述为整个工作区已提交完成。
