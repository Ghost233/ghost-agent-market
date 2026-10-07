---
name: spec-delivery
description: "并行实施已确认 spec，逐阶段审查、复盘并修复 P0/P1/P2，合并阶段 PR 后总审查并提交总 PR。用于完整开发交付；讨论或编辑本 skill 不启动开发。"
---

# Spec 完整交付

调用：Codex 用 `/goal $spec-delivery`，Claude Code 用 `/ghost-agent-skills:spec-delivery`。复用当前对话的 spec 和授权；缺少必要信息才提问。用户要求 goal 且平台支持时，建立或沿用对应 goal。

读取当前安装的 `mattpocock-skills-zh:implement-spec`、`mattpocock-skills-zh:code-review`、`mattpocock-skills-zh:retro`，遵循它们及其依赖。阶段合并和最终收尾按以下流程执行。

1. 确定 spec 清单、阶段、验收条件和分支流向：阶段 PR → 集成分支，总 PR → 目标分支。两者须分离，PR 只包含本次范围内的变更。
2. 按 `implement-spec` 的依赖图并行派发子代理，明确文件归属。同阶段后继等待前置工单验收并进入阶段候选；跨阶段后继等待前置阶段通过审查并集成。共用 checkout 时，Git 操作由主线程或唯一 merger 串行执行。
3. 每阶段依次执行：`code-review` → 修复已确认 P0/P1/P2 → `retro` → 修复相关 P0/P1/P2 → 再次 `code-review`。复盘修复限本次交付范围。审查从阶段开始时的固定 SHA 覆盖完整已提交变更；修复后重跑受影响检查，复审最新 HEAD，直到 P0/P1/P2 清零且必需检查通过。
4. 提交阶段 PR，在已有授权内合入集成分支，验证合并结果并同步涉及的本地分支，再推进后续阶段。
5. 全部 spec 完成后，主线程读取总 diff、核对跨 spec 行为，再调用 `code-review`。修复 P0/P1/P2、运行必要检查并复审通过后，提交总 PR 并标为 ready。仅在用户明确要求时继续合并总 PR，验证结果并同步本地分支。

保留简短进度记录：阶段状态、依赖、审查 SHA、未关闭问题和 PR。恢复时先核对实际状态。遵守仓库规则，保留用户原有改动，仅清理本次不再需要的 worktree。

全部验收满足、P0/P1/P2 清零、必需检查通过、PR 达到约定状态且本地分支已同步，才结束 goal。报告 PR、验证结果和剩余问题；总 PR 仅 ready 时明确注明待合并。
