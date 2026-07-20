---
name: git-commit-direct-model-test
description: |
  在 Codex App 中只读、严格串行测试 git-commit 分析任务的四种直接调用组合：
  spawn_agent + gpt-5.3-codex-spark、create_thread + gpt-5.3-codex-spark、
  spawn_agent + gpt-5.6-luna、create_thread + gpt-5.6-luna。
  用户明确要求运行直接模型矩阵测试、验证这四种组合或调用 $git-commit-direct-model-test 时使用；
  不用于真实提交，不使用项目自定义 agent 配置。
---

# Git Commit 直接模型矩阵测试

本 skill 仅用于 Codex App。它直接测试 collaboration 子代理和可见子线程工具，因而是有意的 Codex 单端实现；不得为 Claude Code 创建功能不等价的副本。

只执行只读运行时探测。不得修改文件、暂存、提交、push、创建 worktree、安装插件或创建、读取、恢复 `.codex/agents` 中的自定义 agent 定义。

## 固定矩阵

严格串行执行且不得改变顺序：

1. `spawn_agent` + `gpt-5.3-codex-spark`
2. `create_thread` + `gpt-5.3-codex-spark`
3. `spawn_agent` + `gpt-5.6-luna`
4. `create_thread` + `gpt-5.6-luna`

“一次测试”表示用户只发出一次指令，由主任务依次完成四个 case 并汇总；不表示把四个 case 合并成一次工具调用。前一 case 到达成功、失败或阻塞终态后，才开始下一 case。任何单项失败都必须记录并继续后续 case。

## 公共准备

1. 运行 `git rev-parse --show-toplevel`，记录仓库绝对路径。
2. 调用 `list_projects`，按该绝对路径唯一解析本地 project id，供两个 `create_thread` case 使用。解析失败不得阻止两个 `spawn_agent` case；线程 case 分别记录同一项准备错误。
3. 为四个 case 构造除 case 元数据外完全一致的中文只读探测包。探测包必须包含仓库绝对路径、case id、transport、requested model 和下方完整 `DIRECT_MODEL_TEST_V1` 契约，并要求执行单元：
   - 读取适用的 `AGENTS.md`。
   - 运行 `git status --short` 和 `git diff --stat`。
   - 不修改文件，不运行任何 Git 写命令，不调用其他代理或创建其他线程。
   - 最终只返回一个 JSON 对象，不使用 Markdown 代码围栏。

```json
{
  "contract": "DIRECT_MODEL_TEST_V1",
  "case_id": "01 | 02 | 03 | 04",
  "transport": "spawn_agent | create_thread",
  "requested_model": "gpt-5.3-codex-spark | gpt-5.6-luna",
  "repository": "<仓库绝对路径>",
  "status": "ready | blocked",
  "checks": {
    "instructions_read": true,
    "git_status_read": true,
    "git_diff_stat_read": true
  },
  "observed_status": ["<git status --short 条目>"],
  "summary": "<简短结果>",
  "warnings": ["<警告或空数组>"]
}
```

返回对象中的 `requested_model` 只是请求回显，不作为模型身份的独立证明。主任务必须以实际工具请求、创建结果和终态作为测试证据。

## 子代理 case

case 01 和 03 必须直接调用 `spawn_agent`，固定传入：

```text
agent_type: "default"
fork_turns: "none"
model: <该 case 的精确 requested model>
task_name: "ga_direct_model_test_<case id>_<时分秒>"
message: <公共只读探测包>
```

`default` 是内置 agent type；不得替换为任何项目自定义 agent type。不得读取 agent 配置、通过父任务继承模型、创建中转线程，或省略 `model`。不得根据工具说明、`ALL_TOOLS`、预检或猜测跳过调用；必须进行一次真实 `spawn_agent` 调用。

创建成功后使用 `wait_agent` 等待终态。只允许为取得终态而等待；不得发送格式修复或重试。同一 case 最多调用一次 `spawn_agent`。工具拒绝模型、参数校验失败、创建失败、运行失败、超时、结果缺失或契约无效都记为该 case 的失败证据，然后继续下一 case。

## 子线程 case

case 02 和 04 必须直接调用 `create_thread`，固定传入：

```text
target: {type: project, projectId: <已解析 id>, environment: {type: local}}
model: <该 case 的精确 requested model>
prompt: <公共只读探测包>
```

不得指定 `thinking`，不得创建 worktree，不得使用中转代理。创建成功后设置标题：

```text
[YYYYMMDD-HHmm] git-commit direct test · <case id> · <requested model>
```

使用 `wait_threads` 等待该线程到达完成、失败或需要用户处理的终态。每次只等待当前 case 的唯一线程；不得让两个矩阵线程同时运行。线程保持可见，不自动归档。同一 case 最多调用一次 `create_thread`；失败后记录原始证据并继续。

## 判定与汇总

每个 case 独立判定：

- `passed`：直接工具调用成功、执行单元到达完成终态、返回有效 `DIRECT_MODEL_TEST_V1`，且仓库、case id、transport 和 requested model 与请求一致。
- `failed`：工具拒绝、创建或运行失败、超时、终态缺失、结果契约无效或字段不一致。
- `blocked`：执行单元返回合法 `status: "blocked"`，或线程明确需要用户处理。

四项全部结束后返回一个汇总表，固定列出 `case`、`transport`、`requested model`、`outcome`、`tool evidence`、`contract` 和 `thread/agent id`。随后分别给出：

1. 每个失败或阻塞 case 的未经改写的关键错误证据。
2. 四个结果之间的 observed status 和 summary 差异。
3. 总结 `passed/failed/blocked` 数量。

不得把 `spawn_agent` 不支持某模型改写成分析任务失败；必须明确标为直接模型覆盖被工具拒绝。不得因为两个 `create_thread` case 成功，就宣称对应的 `spawn_agent` case 也受支持。
