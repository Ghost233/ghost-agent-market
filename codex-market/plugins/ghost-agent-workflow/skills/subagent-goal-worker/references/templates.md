# 子代理任务模板

子代理只消费 `plan.json`、`state.json` 和当前绑定包。`state.tasks.<task_id>.thread_id` 与结果中的 `thread_id` 都填写 canonical `agent_target`；这是共享 driver 的标识字段，不会创建子线程。

## 启动就绪

```json
{
  "contract": "SUBAGENT_READY_V1",
  "dispatch_key": "<plan_path>#<task_id>",
  "status": "ready"
}
```

## 输入绑定包

绑定包只包含当前任务，不得携带其他任务的写入权限。

```json
{
  "plan_path": "<计划绝对路径>",
  "state_path": "<状态绝对路径>",
  "parent_goal": "<完整父目标>",
  "executor_mode": "subagent",
  "runtime_profile": {
    "model": "gpt-5.6-sol",
    "reasoning_effort": "medium"
  },
  "dispatch_key": "<plan_path>#<task_id>",
  "result_path": "<plan_dir>/results/<task_id>.json",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "title": "抽离页面状态类型",
  "display_name": "[GA][<实施|审查|验证>][执行] <中文任务名>",
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "task": "<单一可执行结果>",
  "depends_on": [],
  "writable_paths": ["<授权写入路径>"],
  "done_when": ["<完成条件>"],
  "verification": ["<验证命令或证据>"],
  "worker_context": "<模块共享上下文>",
  "thread_id": "<canonical agent_target>",
  "result_contract": "WORKER_RESULT_V3"
}
```

`result_path` 是唯一允许写出业务范围外的协调元数据。先把完整结果原子写入该路径，再返回语义相同的 JSON；`changed_files` 不包含该文件。

## 普通结果

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed | blocked | failed",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "thread_id": "<canonical agent_target>",
  "profile_evidence": "spawn_agent:gpt-5.6-sol/medium",
  "changed_files": ["<work 的业务路径；review/verify 填 []>"],
  "verification": ["<命令及结果>"],
  "diff_self_check": "pass | fail",
  "scope_request": null,
  "summary": "<结果或阻塞证据>"
}
```

## 写入范围变化

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "needs_main_review",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "thread_id": "<canonical agent_target>",
  "profile_evidence": "spawn_agent:gpt-5.6-sol/medium",
  "changed_files": ["<work 已产生且可归因的路径；review/verify 填 []>"],
  "verification": ["<已完成的验证及结果>"],
  "diff_self_check": "scope_exception",
  "scope_request": {
    "paths": ["<需要增加或重新分配的路径>"],
    "reason": "<为什么当前范围不足>",
    "required_for_done_when": "<关联的完成条件>",
    "suggested_owner": "<建议 module 或 logical_id>",
    "split_hints": ["<可独立验收的结果>"],
    "overlap_hints": ["<已知交叉路径、契约或生成产物>"]
  },
  "summary": "<交给主线程的重规划证据>"
}
```

## 结果持久化

1. 在 `result_path` 同目录写临时文件。
2. 写入完整且合法的 `WORKER_RESULT_V3`，再原子替换 `result_path`。
3. 返回同一 JSON，不添加第二份自然语言结果。

## 聚焦补修输入

```json
{
  "contract": "WORKER_REPAIR_V3",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_id": "<canonical agent_target>",
  "result_path": "<plan_dir>/results/T1.json",
  "missing_or_invalid": ["<需要补齐的字段或证据>"],
  "required_action": "<仅修复当前结果所需的动作>",
  "return_contract": "WORKER_RESULT_V3"
}
```

无法补齐成功证据时，仍须写入身份正确、契约合法且保留原始原因的 `failed` 结果。
