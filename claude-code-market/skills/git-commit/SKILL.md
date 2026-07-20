---
name: git-commit
description: |
  分析当前仓库的已暂存、未暂存和 submodule 变更，按职责拆分批次并直接创建中文 Git 提交。
  用户明确输入 `/git-commit`、要求“提交代码”“提交当前改动”或“commit these changes”时使用；
  不用于只讨论 commit、解释 Git 或请求 push。Claude Code 当前主会话负责全部分析、stage 和 commit。
---

# Git 智能提交

在当前 checkout 中分析并提交用户授权的现有改动。保持用户改动，不创建 worktree，不切换分支，不 push，不改写历史。Codex 端按注册工具选择 `multi_agent_v1` 或直接子代理的能力探测不适用于 Claude Code；这里继续由当前主会话完成分析和 Git 写入。

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
