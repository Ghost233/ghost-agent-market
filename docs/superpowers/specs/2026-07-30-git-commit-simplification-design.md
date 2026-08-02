# Git Commit Skill 精简设计

## 目标

在不降低提交安全性的前提下，缩短 `git-commit` skill 的提示词和代理链路。主线程只负责派发与转发；一个 executor 子代理完成检查、审查、规划、暂存、提交和结果核验。

## 结构

保留：

- `SKILL.md`：描述主线程与 executor 的最小工作流。
- `scripts/git_commit.py`：提供确定性的只读检查和写入执行。
- `agents/openai.yaml`：Codex 展示与显式调用元数据。

删除：

- `references/reviewer.md`。
- reviewer 子代理及条件审查流程。
- 重复的平台说明、工具回合限制和可由脚本强制执行的规则。

## 工作流

1. 主线程创建一个无上下文 fork 的 executor 子代理，只传 skill 路径、脚本路径、起始目录和用户授权范围。
2. 主线程不运行 Git 命令、不读取 diff、不规划或执行提交。
3. executor 读取适用的仓库指令，使用 `python3 <script> inspect --diff` 获取状态、内容快照和风险。
4. executor 审查全部授权改动，按职责生成中文 Conventional Commit 批次；敏感文件、范围不明、身份错误或脏 submodule 会阻止写入。
5. executor 将含 `head`、`fingerprint` 和批次的 JSON 计划交给 `python3 <script> apply`。
6. 脚本验证快照和路径后逐批提交；executor 根据结构化结果向主线程返回最终汇总。
7. 主线程仅转发阻塞原因或最终结果。

平台不支持子代理或无法禁用上下文 fork 时，skill 停止，不在主线程降级执行。

## 安全脚本

`inspect` 必须：

- 分别、正确报告 staged、unstaged 和 untracked；同一路径可同时属于 staged 与 unstaged。
- 正确处理 rename/copy，不把第二个路径误解析为状态记录。
- 让 fingerprint 覆盖 HEAD、索引、工作区、untracked 内容和 submodule 状态。
- 让 `--diff` 包含受审查的 untracked 内容。
- 检查仓库要求的 Git identity、敏感路径、大文件、二进制文件和 submodule。

`apply` 必须：

- 要求并验证 `head` 与 `fingerprint`。
- 校验计划结构、显式文件路径、批次不重叠及 Conventional Commit 格式。
- 保留不属于当前批次的既有 staged 内容；每笔提交只包含该批路径。
- 使用正常 hooks，并为每笔提交保留 `Co-Authored-By: Nexus <nexus@xfinite.global>`。
- 在漂移或错误时停止并输出结构化现场，不自动回滚、amend、push 或改写历史。

## 测试

新增独立脚本测试，至少覆盖：

- staged 与 unstaged 同时存在。
- rename/copy 和特殊字符路径。
- 文件内容变化但状态字符不变时 fingerprint 改变。
- untracked 文本、二进制和大文件的检查与 diff。
- 多批提交不夹带其他 staged 内容。
- 无效计划、重复路径、身份错误、脏 submodule 和快照漂移。
- hook 失败后的结构化错误与现场保留。
- 三端 skill、脚本和本地 `.codex` 副本保持一致。

## 发布范围

同步更新 Claude Code、Codex 和仓库 `.codex` 副本。`ghost-agent-skills` 基础版本从 `0.1.2` 升到 `0.1.3`，随后运行 cachebuster，只更新 Codex 的时间戳后缀。
