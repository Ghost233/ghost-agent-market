---
name: skillopt-reinforce-10
description: 将一个已有的 agent SKILL.md 通过恰好十轮连续的 SkillOpt-Sleep 强化。用户要求从已审核的历史会话或任务语料持续训练、强化或优化某个指定 skill 十次时使用。必须先获得使用真实后端预算及自动采纳仅限验证门控更新的明确同意。
---

# SkillOpt 十轮强化

基于可复用的任务证据强化一个已有 skill。训练单元是已审核的
`TaskRecord` 语料，而不是原始 skill 文本：SkillOpt 会重放任务、提出有边界的
编辑，并且仅当候选版本的留出集分数提升时才接受编辑。

随附的运行器会**恰好执行十轮**连续 cycle。被接受的编辑会在下一轮开始前
采纳，因此后续轮次会基于已强化的 skill 继续训练。被 gate 拒绝的编辑也计入
一轮，但不会修改目标。

## 平台范围

本 skill 是用户明确要求的仓库级本地实现，仅放在 `.agents/skills/` 供 Codex
发现；不镜像到 Claude Code 或 Codex marketplace。它依赖当前仓库的 `SkillOpt`
子模块，并且默认从 Codex Desktop 会话生成语料。需要为其他平台分发时，再单独
创建对应 marketplace skill。

## 前置条件

1. 要求目标 `SKILL.md` 已存在，且已安装 SkillOpt checkout 或 `skillopt`
   Python 包。优先将 `SKILLOPT_REPO` 指向包含 `skillopt_sleep/` 的 checkout。
2. 从历史 agent 会话创建与目标 skill 对应的任务语料。Codex Desktop 使用
   `codex` source，Claude Code 使用 `claude` source。

```bash
SKILLOPT_REPO=/absolute/path/to/SkillOpt
PROJECT=/absolute/path/to/project
TARGET=/absolute/path/to/target/SKILL.md
TASKS=/absolute/path/to/reviewed-tasks.json

bash "$SKILLOPT_REPO/plugins/run-sleep.sh" harvest \
  --project "$PROJECT" \
  --source codex \
  --target-skill-path "$TARGET" \
  --max-sessions 30 \
  --max-tasks 12 \
  --output "$TASKS"
```

3. 在任何真实重放前读取生成的 JSON。删除或脱敏密钥和无关任务，确认其与
   目标 skill 相符，再将顶层 `reviewed` 字段设为 `true`。未审核语料不得使用
   真实后端。
4. 若语料没有足够独立的真实任务来保留有意义的留出集，立即停止。向用户索取
   更多有代表性的任务证据，不得编造示例。运行器至少要求两个 `train` 和两个
   `val`；所有 `train/val/test` 均须来自互不重叠的真实会话，并且语料记录的
   `transcript_source` 必须与本次 `--source` 一致。

## 同意边界

启动运行器前，说明目标路径、语料路径、后端、source，以及十轮中每个被接受的
更新都会自动采纳并保留备份。要求用户明确同意消耗后端预算并允许这些经过 gate
的自动采纳。泛泛要求改进某个 skill 不构成该同意。

强化运行中不得使用 `mock`、关闭 gate、跳过语料审核，或将某个目标 skill 的语料
用于另一个目标。

## 执行

使用绝对路径运行随附脚本。选择与当前 agent 平台对应的真实后端。
`--confirm-auto-adopt` 是必填项，证明已经满足同意边界。

```bash
bash /absolute/path/to/skillopt-reinforce-10/scripts/reinforce_ten_rounds.sh \
  --project "$PROJECT" \
  --target-skill-path "$TARGET" \
  --tasks-file "$TASKS" \
  --backend codex \
  --source codex \
  --confirm-auto-adopt
```

Claude Code 使用 `--backend claude --source claude`。`--edit-budget`、
`--dream-rollouts`、`--recall-k`、`--model`、`--codex-home` 和
`--claude-home` 只能在用户明确同意后覆盖。

运行器会强制 `evolve_memory=false`、`evolve_skill=true` 以及
`gate_mode=on`，只会修改指定的目标 skill。Codex 后端会把 `--codex-home`
传播为嵌套 CLI 的 `CODEX_HOME`；该目录必须可写且已经登录。运行器先在独立事务
目录中执行一轮，累计检查 attempt、带工具 attempt、judge、reflect 及内部直接
调用，确认没有调用错误或空任务响应，再把 manifest 中的候选固定为不可变快照。
只有全部诊断通过后，才会在项目 staging、目标 skill 与 canonical state 的互斥锁
内提交精确目标和本轮 state；三项资源均不共享的强化仍可并行。完整落盘的事务
标记区分 prepared 与 started，异常或进程中断会保留原状态，并在下次启动时恢复
真正开始写入的事务。审计报告只记录真实后端，不保留未参与执行的 replay 标签。
运行器会输出每轮的留出集 baseline/candidate 分数、gate 动作、staging 目录和已
采纳路径。

## 复核

第十轮后，读取每个 staging 的 `report.md` 与最终目标 diff。报告十轮的 gate 动作、
已接受/拒绝的编辑数量、最终 skill 变更，以及没有可用任务的轮次。若 gate 没有
接受编辑或留出集分数没有提升，不得宣称 skill 已改进。

## 硬性规则

- 会话归档保持只读；不得在报告中暴露原始会话内容或密钥。
- 运行器失败时立即停止；不得跳过失败轮次后仍称其为十轮运行。
- 真实后端的任一调用错误或空任务响应必须使当前运行失败，不得作为普通 gate
  reject 继续消耗剩余轮次。
- 采纳前必须确认 manifest 仅包含精确目标 `SKILL.md`，不得写 memory 或其他路径。
- 一轮只有在诊断、候选与路径全部通过后才提交目标和 SkillOpt state；失败轮次
  不得污染 night、任务归档或 accepted 记录。
- 不得在两轮之间手动编辑目标。让验证门控的运行器执行被接受的更新并保留备份。
- 此 skill-only 运行中不得修改 `CLAUDE.md` 或其他 memory 文件。
