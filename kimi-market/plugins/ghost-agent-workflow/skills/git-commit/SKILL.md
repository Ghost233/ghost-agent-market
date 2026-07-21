---
name: git-commit
description: |
  使用 Kimi Agent 工具的 explore 只读子代理分析当前仓库的已暂存、未暂存和 submodule 变更,
  再由主线程复核、按职责拆分批次并直接创建中文 Git 提交。
whenToUse: |
  用户明确输入 `/git-commit`、要求“提交代码”“提交当前改动”或“commit these changes”时使用;
  不用于只讨论 commit、解释 Git 或请求 push。
---

# Git 智能提交

本实现仅用于 Kimi Code,依赖其 `Agent` 工具的 `explore` 只读子代理;只读约束由平台强制,不需要 Codex 端的能力探测 exec 块与模型选择。在本仓库提交此 skill 时,这项平台依赖就是 `AGENTS.md` 所要求写清的平台原因。

在当前 checkout 中提交用户授权的现有改动。保持用户改动,不创建 worktree,不切换分支,不 push,不改写历史。

主线程是唯一 Git 写入者。子代理只读分析并返回提交建议;不得让子代理暂存、提交、修改文件或继续委派。分析子代理固定为一次 `Agent(subagent_type: "explore")` 调用,不运行第二个分析执行单元。提交顺序是硬约束:先从最深层脏 submodule 向外提交,再提交主工程中的 submodule 指针和其他改动。

## 只读分析子代理

1. 主线程先运行 `git rev-parse --show-toplevel`,取得仓库绝对路径,并记录用户授权范围。
2. 构造中文只读分析包,包含仓库绝对路径、用户授权范围、显示名称 `[GA][审查][执行] Git 提交分析`,以及第 4 步的完整 `GIT_COMMIT_ANALYSIS_V1` 字段契约。不得假设子代理能读取本 skill;必须在 prompt 中要求子代理:
   - 读取适用的 `AGENTS.md` 等仓库指令。
   - 运行只读 Git 检查,区分 staged、unstaged、untracked、submodule 指针和 submodule 内部改动。
   - 检查 Git 身份、敏感文件、疑似生成的大文件和归属不明内容。
   - 从最深层 submodule 向外规划提交顺序,并按职责、风险和可独立回滚性给出显式路径批次。
   - 不执行 `git add`、`git commit` 或任何文件修改,不调用其他代理。
   - 最终只返回一个符合契约的 JSON 对象,`profile_evidence` 必须精确等于 `kimi:explore/default`。
3. 只调用一次 `Agent`,参数固定为:

```text
subagent_type: "explore"
description: "[GA][审查][执行] Git 提交分析"
prompt: <只读分析包,profile_evidence 精确等于 kimi:explore/default>
```

`explore` 由平台强制只读,正好满足“子代理不得暂存、提交、修改文件”的硬约束。Kimi 的 `Agent` 工具没有 model、thinking 或 effort 参数,子代理固定平台默认 profile,不得传模型或思考参数。前台等待其最终结果,不使用 `run_in_background`,也不创建第二个代理。

工具调用失败、未返回终态结果或运行失败时,在任何 Git 写操作前停止并报告原始证据;不得创建第二个代理或退回主线程自行分析。合法 `status: "blocked"` 同样是终态,不得再次分析。契约缺失、JSON 格式错误、仓库不一致或 profile 不一致时停止,不发送格式修复请求,不创建替代执行单元。

4. 分析子代理必须返回一个 `GIT_COMMIT_ANALYSIS_V1` 对象,至少包含:

```json
{
  "contract": "GIT_COMMIT_ANALYSIS_V1",
  "status": "ready | blocked",
  "profile_evidence": "kimi:explore/default",
  "repository": "<仓库绝对路径>",
  "identity": {"name": "<Git 用户名>", "email": "<Git 邮箱>"},
  "observed_status": ["<git status --short 条目>"],
  "submodule_order": ["<从深到浅的仓库路径>"],
  "batches": [
    {
      "repository": "<仓库绝对路径>",
      "message": "<中文 Conventional Commit>",
      "paths": ["<显式路径>"],
      "reason": "<职责和边界>"
    }
  ],
  "sensitive_or_unknown": ["<保持未暂存的路径和原因>"],
  "warnings": ["<风险或空数组>"]
}
```

`profile_evidence` 只能精确等于 `kimi:explore/default` 这一固定值。不得使用 `|`、不得同时报告多个 profile。最终状态为 `blocked` 或分析代理失败时,在任何 Git 写操作前停止并报告原始证据。

## 主线程复核

子代理结果是只读建议,不是提交授权或事实替代。主线程收到结果后必须亲自完成以下复核:

1. 读取适用于根仓库及目标 submodule 的仓库指令。
2. 运行 `git status --short`、`git diff --stat`、`git diff`、`git diff --cached --stat`、`git diff --cached` 和 `git submodule status`。
3. 区分调用前已暂存内容、未暂存内容、未跟踪文件、submodule 指针和 submodule 内部改动;不要把调用前已暂存内容误归到新批次。
4. 在每个将提交的仓库中读取 `git config user.name` 和 `git config user.email`。身份不符合仓库指令时停止,不创建提交。
5. 对照 `observed_status`、`submodule_order` 和每个 batch 的显式路径。两次只读状态出现差异时比较具体路径;能够明确归因且仍在授权范围内时重新规划,无法归因时在 stage 前停止。
6. 再次检查 `.env*`、credentials、私钥、token、证书、生产配置和疑似生成的大文件。敏感或归属不明内容保持未暂存并报告。

没有可提交改动时正常停止,不创建空提交。

## 提交决策

- 只为解决客观疑点读取一次必要的指令、diff 或历史;证据充分后立即决定提交或失败。
- 只有身份不符、敏感内容、归属不明的 staged 内容、明确违反仓库指令、分析契约无效或 Git 命令失败才阻塞。
- 多轮用户编辑可能累计多次合法版本递增。若最终版本格式、进位和 cachebuster 均符合仓库规则,不得仅因它高于 `HEAD + 0.0.1` 而降级、改写或停止。
- 当前授权范围内的问题能安全修复时直接修复并继续;必须扩大范围时才停止并报告。
- 保留用户已有的合理 staged batch。若 staged 内容混合无关职责,报告冲突,不静默取消暂存或重排用户 staging。
- 文档、测试、配置和实现只有在服务同一变更时才放入一笔提交。submodule 提交与主工程提交必须分开。
- 使用中文 Conventional Commit:`<type>(<scope>): <描述>`。每笔提交保留:

```text
Co-Authored-By: Nexus <nexus@xfinite.global>
```

## 执行提交

主线程亲自执行全部 Git 写命令;Kimi Code 没有 Codex 端的沙盒提权语义,写命令按当前会话权限直接执行,只读检查照常先行。

- 显式暂存使用 `git add -- <paths>`,逐批次显式列出路径。
- 创建提交使用 `git commit`,不得使用 `--no-verify` 绕过 hooks。
- 不得使用 `git add -A`、`git add .` 或其他会吸收无关文件的宽泛命令。

按 `submodule_order` 和 batch 顺序逐笔执行:

1. 使用显式路径 stage。
2. 运行 `git diff --cached --stat`、`git diff --cached` 和 `git diff --cached --check`,确认批次聚焦、没有敏感内容或意外删除。
3. 创建提交;hook 或 commit 失败时保留现场并报告,不自动回滚。
4. 读取新 hash 并重新运行 `git status --short`,再决定是否继续下一批次。

提交后同一路径出现新修改时,把已创建 commit 与新增未提交内容分开报告;不得自动 amend 或追加暂存。

## 完成回报

主线程报告:

- 固定 profile evidence `kimi:explore/default` 和分析警告。
- 每个仓库和批次的 commit hash、提交信息与文件范围。
- submodule 到主工程的实际提交顺序。
- hooks 和 `git diff --cached --check` 结果。
- 剩余 staged、unstaged、untracked,以及被排除的敏感或无关文件。

不要把部分批次已提交描述为整个工作区已提交完成。
