---
name: git-commit
description: 使用只读子代理分析当前仓库的 staged、unstaged、untracked 和 submodule 变更，再由主线程复核并创建中文 Git 提交。用户明确要求“提交代码”“提交当前改动”、`/git-commit`、`/skill:git-commit` 或 “commit these changes” 时使用；不用于只讨论 Git、解释提交或仅请求 push。
---

# Git 智能提交

在当前 checkout 中提交用户已授权的现有改动。保持用户改动，不创建 worktree，不切换分支，不 push，不改写历史。

## 分工

- 必须先使用当前平台可用的子代理接口启动一个只读分析子代理。分析模型固定为 `gpt-5.6-sol`，思考强度固定为 `high`。
- 强制禁止 fork 主线程上下文。Codex `spawn_agent` 必须显式设置 `fork_turns: "none"`；使用提供 `fork_context` 的接口时必须设置为 `false`。接口无法保证不继承主线程上下文时停止，不执行 Git 写操作。
- 只向子代理传递仓库路径、用户授权范围、仓库指令和当前 Git 证据，不复制主线程聊天历史。
- 子代理读取适用的仓库指令，并用只读 Git 命令检查状态、diff、submodule、Git identity、敏感文件和提交边界；返回变更摘要、风险、建议批次、显式路径和中文提交信息。
- 子代理不得修改文件、暂存、提交、push 或执行其他 Git 写操作。
- 主线程负责复核分析，并执行全部 Git 写操作。子代理建议不能替代主线程对实际状态和 diff 的检查。

## 工作流程

1. 运行 `git rev-parse --show-toplevel`，确认仓库根目录和当前 checkout。
2. 读取适用的 `AGENTS.md` 等仓库指令，并记录用户授权范围。
3. 运行 `git status --short`、`git diff --stat`、`git diff`、`git diff --cached --stat`、`git diff --cached` 和 `git submodule status`。
4. 启动只读子代理分析当前变更。把仓库绝对路径、用户授权范围和必要的只读结果交给它。
5. 主线程重新读取实际 Git 状态和 diff，核对建议批次；检查 `.env*`、credentials、私钥、token、证书、生产配置和异常大文件。
6. 没有可提交改动时正常停止，不创建空提交。

## 规划提交

- 按职责、风险和可独立回滚性拆分批次；同一变更的实现、测试、文档和配置可以放在一起。
- 保留用户已有的合理 staged 内容。发现无关或归属不明的 staged 内容时先停止并报告。
- submodule 有未提交改动时，从最深层 submodule 开始提交，再提交父仓库中的指针变化。
- 每批使用显式路径 `git add -- <paths>`；不要使用 `git add .` 或 `git add -A`。
- 使用中文 Conventional Commit：`<type>(<scope>): <描述>`。
- 每笔提交保留：

```text
Co-Authored-By: Nexus <nexus@xfinite.global>
```

## 执行提交

对每个批次依次执行：

1. 使用显式路径暂存文件。
2. 运行 `git diff --cached --stat`、`git diff --cached` 和 `git diff --cached --check`，确认批次准确且不包含敏感内容。
3. 创建提交，不使用 `--no-verify` 绕过 hooks。
4. 读取新 commit hash，并重新运行 `git status --short`。
5. hook 或 Git 命令失败时保留现场并报告，不自动回滚、amend 或重写历史。

## 完成回报

报告子代理的关键建议、每个提交的 hash 和信息、submodule 提交顺序、检查结果，以及剩余 staged、unstaged、untracked 或被排除的文件。不要把部分完成描述为整个工作区已经提交完成。
