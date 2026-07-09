---
name: skillopt-optimize-skill
description: "当用户想改进、强化、自优化、sleep-train、运行多轮 SkillOpt-Sleep 来优化某个 SKILL.md；想基于历史会话优化 Codex/Claude/agent skill；或需要带 dry-run、run、adopt、auto-adopt、staging review、卡住恢复的门控式 skill 演化流程时使用。"
---

# SkillOpt 优化 Skill

## 概览

使用 SkillOpt-Sleep 从真实历史 agent 会话中演化目标 `SKILL.md`，同时保留安全边界：harvest 和 mining 只读，候选改动必须通过 held-out gate，只有显式 `adopt` 或用户明确要求的 `--auto-adopt` 才会写入 live skill。

这个 skill 用来操作优化流程，不用来手工改写 skill 内容。

## 安全确认

任何真实 backend 运行前，先说明会发生什么；如果用户尚未明确授权，必须先征求同意：

- 真实 backend 会读取本地历史会话、挖掘任务，并把选中的任务/skill 文本发给 backend。
- `--backend codex` 会消耗用户的 Codex 额度。
- `--auto-adopt` 会把通过 gate 的提案写入目标 live skill。
- 不加 `--auto-adopt` 时，只会把提案 staged 到 `.skillopt-sleep/staging/<timestamp>/`。

如果授权不明确，只能运行 `dry-run --backend mock`。

## 先锁定输入

运行前锁定这些输入：

| 输入 | 规则 |
|---|---|
| `target_skill_path` | 目标 `SKILL.md` 的绝对路径；如果一个目录下有多个 skill，不要模糊推断。 |
| `rounds` | 用户要求的优化轮数。 |
| `backend` | smoke test 默认用 `mock`；只有明确授权后才用 `codex`。 |
| `source` | Codex Desktop 历史会话默认用 `codex`；除非用户要求 Claude transcript。 |
| `scope` | 先用 `invoked`；如果挖不到任务，除非用户已授权全历史，否则先询问再扩大到 `all`。 |
| `adopt policy` | 默认只 staged；只有用户明确要求时才使用 `--auto-adopt`。 |

## 工作流

1. **查找 Python 3.10+**。本仓库可能让 `python3` 指向 3.9，因此优先尝试 `python3.12`、`python3.11`、`python3.10`。
2. **先做 mock smoke test**，用 mock backend 和很小的任务数量验证 engine 能加载目标 skill 和 harvest source，不消耗额度。
3. **授权后再跑真实轮次**。每一轮使用独立的 project/state 目录，避免 `last_harvest` 状态吞掉后续轮次，也避免在仓库里生成 memory 文件。
4. **读取每轮结果**。记录 task 数、session 数、baseline -> candidate score、gate action、accepted edits、rejected edits、staging path、adopted paths。
5. **如果某轮卡住**，中断它，确认没有遗留子进程，降低 task/session 数量，并用低 reasoning Codex wrapper 重试。
6. **结束前验证**：确认没有遗留 `skillopt_sleep` 或本轮 `codex exec` 子进程；检查目标 `SKILL.md` 的 learned block 或 diff。

## 命令模板

在 SkillOpt 仓库中执行：

```bash
PY="$(command -v python3.12 || command -v python3.11 || command -v python3.10)"
TARGET="/absolute/path/to/skill/SKILL.md"

"$PY" -m skillopt_sleep dry-run \
  --project "$(pwd)" \
  --source codex \
  --backend mock \
  --target-skill-path "$TARGET" \
  --max-sessions 5 \
  --max-tasks 1 \
  --progress \
  --json
```

真实轮次使用独立状态目录：

```bash
ROUND=01
RUN_DIR="/private/tmp/skillopt-optimize-${ROUND}"
mkdir -p "$RUN_DIR"

"$PY" -m skillopt_sleep run \
  --project "$RUN_DIR" \
  --scope all \
  --source codex \
  --backend codex \
  --target-skill-path "$TARGET" \
  --claude-home "$RUN_DIR/.claude" \
  --max-sessions 5 \
  --max-tasks 1 \
  --progress
```

只有用户明确批准自动采纳时，才追加 `--auto-adopt`。

## 多轮循环

顺序执行每一轮。第 N 轮退出并记录结果前，不要启动第 N+1 轮。

长任务使用保守默认值：

| 场景 | 默认做法 |
|---|---|
| 第一次真实尝试 | `--max-sessions 5 --max-tasks 1` |
| 用户要求更深优化 | 一次只调大一个参数。 |
| `--scope invoked` 挖不到任务 | 只有获得授权或用户已授权全历史时，才用 `--scope all` 重跑。 |
| gate reject | 这一轮算完成；不要强行 adopt。 |
| gate accept | stage-only 时展示 staging path 并总结；已批准 auto-adopt 时报告 adopted paths。 |

## 卡住恢复

真实 Codex backend 轮次可能卡在 mining、replay、reflection 或 judging。多分钟无输出且存在 live `codex exec` 子进程时，按卡住处理。

恢复流程：

1. 向运行中的 session 发送 Ctrl-C。
2. 用 `pgrep -af skillopt_sleep` 和 `pgrep -af codex` 查遗留进程；可疑 PID 用 `ps -p <pid> -o pid,ppid,etime,command` 检查。
3. 用 `--max-sessions 5 --max-tasks 1` 重试。
4. 如果仍然卡住，创建临时 wrapper 降低 Codex reasoning effort，再通过 `--codex-path` 传入。

wrapper 内容：

```bash
#!/bin/sh
if [ "$1" = "exec" ]; then
  shift
  exec codex exec -c 'model_reasoning_effort="low"' "$@"
fi
exec codex "$@"
```

把 wrapper 放在 `/private/tmp` 或其他临时目录，设为可执行，用极小 prompt 验证后再重试：

```bash
codex-low exec --skip-git-repo-check --color never --sandbox read-only -C "$RUN_DIR" -- 'Return exactly OK.'

"$PY" -m skillopt_sleep run \
  --project "$RUN_DIR" \
  --scope all \
  --source codex \
  --backend codex \
  --codex-path /private/tmp/codex-low \
  --target-skill-path "$TARGET" \
  --claude-home "$RUN_DIR/.claude" \
  --max-sessions 5 \
  --max-tasks 1 \
  --progress
```

不要用 `--ignore-rules`，也不要把绕过用户/项目策略当成提速手段。

## 汇报格式

运行结束后，给出紧凑表格：

| round | result | score | edits | staging |
|---|---|---|---|---|
| 1 | accepted/rejected/interrupted | `0.250 -> 1.000` | accepted/rejected counts | path |

随后说明：

- accepted 轮数和 accepted edits 总数；
- 目标 `SKILL.md` 的准确路径；
- 提案是仅 staged 还是已 auto-adopted；
- 哪些轮次被中断/重试，以及重试参数；
- 是否还有遗留 `skillopt_sleep` 或 `codex exec` 进程；
- 观察到但未处理的无关 working-tree 变更。

不要在最终回复中粘贴原始 transcript、secret 或大段 proposed skill body。

## 常见错误

| 错误 | 修正 |
|---|---|
| 未明确授权就跑真实 backend | 停下来询问；只能用 mock dry-run。 |
| 每轮都把当前仓库当 `--project` | 使用隔离临时目录，避免 state 和 `CLAUDE.md` 污染仓库。 |
| 把 gate reject 当成失败 | reject 是有效优化轮次，说明 gate 保护了 skill。 |
| 让卡住的轮次无限运行 | 中断、检查进程、缩小范围，必要时降低 reasoning。 |
| 手工编辑 learned block | 使用 SkillOpt-Sleep staging/adopt；手改会破坏安全边界。 |
| 只说“完成了” | 汇报 score movement、gate action、edits、staging/adoption 证据。 |
