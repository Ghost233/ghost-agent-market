---
name: git-commit
description: Use when 用户明确要求“提交代码”“提交当前改动”、`$git-commit` 或 “commit these changes”；递归先提交已授权的 dirty submodule，再由父仓库记录最新 gitlink；不用于只讨论 Git、解释提交或仅请求 push。
---

# Git 智能提交

在当前 checkout 提交用户已授权的改动；不创建 worktree、不切分支、不 push、不改写历史。

## 主线程

主线程为整个 git-commit 流程选择唯一 executor；不得让多个上下文并发检查或写入同一仓库。

1. 平台允许创建子代理时，创建一个 ROLE=executor 子代理，只传 SKILL.md 路径、scripts/git_commit.py 路径、起始目录和授权范围（包括明确排除的路径），随后即停在该调用上等待结果：Codex 使用 spawn_agent（task_name="git_commit_executor"、model="gpt-5.6-terra"、reasoning_effort="medium"、fork_turns: "none"）发起后，用 wait_agent 阻塞到该子代理返回；Claude Code 的 Agent 工具按默认前台方式调用，发起后即阻塞到 executor 完成并返回结果。子代理的最终结果或完整阻塞原因作为本次调用的返回值交回主线程，进入第 3 条。
2. 平台不能创建上述子代理时，由主线程作为唯一 executor 执行下述流程，不得仅因缺少子代理而停止。
3. 已委派时主线程不运行 Git 命令、不读 diff、不规划或执行提交；拿到 executor 的返回值后，将其完整阻塞原因或最终结果转发给用户。

## Executor

executor 不得创建任何代理；所有 Git 写操作只通过 `python3 <script> apply`。

1. 完整读取本文件和适用的 AGENTS.md。
2. 对起始仓库运行 `python3 <script> inspect --diff --repo <start-directory>`。`has_changes=false` 且 `blocking_submodules`、`gitlink_updates` 均为空时成功结束并报告排除项；identity 不匹配、授权范围不明或 `sensitive_paths` 中的文件未经确认时停止。`sensitive_warnings` 只提示，不得单独阻塞提交。
3. 先核对 `excluded_submodules`，按下节保留已明确排除的子模块及其 gitlink；父仓库检查子模块工作区时也尊重该子模块仓库内的排除配置。逐项处理其余 `blocking_submodules`：仅含 `worktree-dirty` 时，在同一 executor 内对已授权的已初始化子模块递归执行本流程，始终先提交最深层仓库；含 `merge-conflict`、`uninitialized-changed`、`staged-pointer-not-checked-out` 或越权路径时停止并返回具体 reason。`staged-pointer-not-checked-out` 必须由用户决定保留暂存指针还是改用子模块当前 HEAD。用户授权“提交当前全部改动”时包含未排除的 dirty 子模块；路径限定授权不自动扩大。
4. 所有子模块提交完成后重新 inspect 父仓库。`gitlink_updates` 仅包含未排除的更新，是父仓库必须审查并提交的普通路径，不得当作 dirty submodule；嵌套仓库逐层重复，直至根仓库。
5. 审查完整 diff，排除未授权文件，按职责生成中文 Conventional Commit 批次；每个纳入提交的 clean gitlink 必须指向对应子模块当前 HEAD。完整 diff 可能仍显示排除项，批次路径以 `changes` 和授权范围为准。
6. 在仓库外的系统临时目录写入 plan JSON：

```json
{"head":"<inspect.head>","fingerprint":"<inspect.fingerprint>","batches":[{"paths":["file"],"message":"fix(scope): 中文说明"}]}
```

7. 运行 `python3 <script> apply --repo <repo-root> <plan.json>`，读取 JSON 结果。脚本先用临时 index 预检全部批次，再触碰真实 index；可自动修复已授权普通 UTF-8 文本的尾随空白和 EOF 多余空行，保留 Markdown 行尾恰好两个空格的换行语法。首笔提交前若 hook 只修改本批路径且其他路径未变，脚本重新预检并重试一次。
8. Codex managed sandbox 首次 apply 即使用 `sandbox_permissions=require_escalated` 请求写入 inspect 返回的 `git_dir`/`git_common_dir`；其他平台也先按其沙箱规则取得 Git 元数据写权限。若仍仅因 Git 元数据权限失败，且 `committed_count=0`、HEAD 与授权范围未变，可取得正确权限后原样重试一次。
9. 每层提交后核对纳入提交的 gitlink 等于子模块 HEAD；排除项的父仓库记录、子模块 HEAD 与本地内容应保持本轮开始时的状态。最终核对所有参与仓库的工作区。返回每笔提交的 cwd/hash/message/paths、自动修复、重试次数、指针、检查结果、`sensitive_warnings`、剩余及排除文件；排除项单列父仓库记录与本地 HEAD，允许两者不同。

## 子模块排除

用户明确要求持久排除某个子模块时，在启动 executor 前完成所属父仓库的本地配置。这是配置调整；executor 只读取已有配置，提交写操作仍只通过 `apply`。

```bash
git -C <父仓库> config --local --add git-commit.excludeSubmodule <相对gitlink路径>
```

- 路径相对于直接记录该 gitlink 的父仓库，必须规范化、已追踪且已初始化；多项排除使用多次 `--add`。脚本只读取 `--local` 配置，不从全局配置或 `.gitmodules` 推断排除授权。
- 排除同时覆盖子模块工作区和父仓库 gitlink：保留子模块与版本更新能力，日常提交不递归提交它，也不把它加入 plan。已有排除不会因“提交全部改动”自动失效。
- Git 日常状态可另外使用本地 `submodule.<name>.ignore=all`，其中 `<name>` 取自 `.gitmodules` 的子模块名称。脚本仍以 `git-commit.excludeSubmodule` 为排除依据，用 `--ignore-submodules=none` 检查其余子模块。
- 排除项已有暂存指针、冲突、未初始化或无效路径时，inspect/apply 停止并返回具体路径和原因，保留 index 与工作区。其余 dirty 子模块照常阻塞；嵌套排除配置写在对应直接父仓库中。
- 排除配置纳入 `fingerprint`；配置变化后重新 inspect 和审查 plan。恢复纳入提交时，仅移除用户指定的本地排除值，再重新 inspect，不清理子模块内容。
- 如果只剩排除项，报告“无可提交改动”并列出保留项；`final_status` 仍可能显示这些变动，完成标准是已授权且未排除的改动已提交、排除项完整保留。
- 报告配置或 skill 修正的实际文件路径和变更；Git 本地配置、插件缓存改动不会出现在业务仓库 diff 中。缓存中的修正须同步回插件源码，避免插件升级覆盖。

## 硬规则

- 不直接运行 git add 或 git commit；不使用 --no-verify。
- 每笔提交保留 `Co-Authored-By: Nexus <nexus@xfinite.global>`。
- 因具体文件停止时，逐项转发 `risk_findings` 提供的 path、rule_id、reason、evidence 和 required_action；若失败来自其他检查，则转发脚本或 hook 的确切原因及下一步。不得只说“文件敏感”“存在风险”或“安全检查未通过”，也不得展示检测到的凭据或秘密原文。
- 简单补救不得扩大授权范围：只允许处理本批普通 UTF-8 文本的尾随空白/EOF 多余空行、仅修改本批路径的 hook 自动格式化，以及尚未产生提交时的 Git 元数据权限问题；每类最多重试一次，并如实报告修复内容。
- 冲突标记、space-before-tab、非 UTF-8/符号链接、身份不匹配、敏感文件未确认、范围或内容漂移、hook 修改批次外路径、未知失败均停止，不得自动修复。
- 当前仓库本次 apply 已产生任一提交后，后续失败必须保留现场并停止。子模块已成功提交而父仓库尚未提交时，父仓库仍可执行上述简单补救；若不满足简单补救条件则停止，且不得回滚、amend、push 或自动清理用户改动。
- 平台要求命令前缀时保留 `python3` 调用语义并按平台规则执行。
