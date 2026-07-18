# 任务执行模板

执行线程只消费 `plan.json`、`state.json` 和绑定包；面向用户展示的 Mermaid 不进入任何模板或结果契约。

当前线程固定归属一个 `parent_goal` 内的 `(module_id, thread_role)`，可以顺序承接该归属的多个 task，但不得承接其他父目标。module 的 profile 与 context 在当前父目标内固定；每次新绑定只替换 task 局部目标、权限、结果路径和证据。

## 输入绑定包

绑定包只包含当前任务，不得携带其他任务的写入权限。

```json
{
  "plan_path": "<计划绝对路径>",
  "state_path": "<状态绝对路径>",
  "parent_goal": "<完整父目标>",
  "executor_mode": "thread",
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
  "thread_id": "<真实线程 id>",
  "worker_profile": {
    "model": "gpt-5.6-sol",
    "reasoning_effort": "medium"
  },
  "profile_evidence": "create_thread:gpt-5.6-sol/medium",
  "result_contract": "WORKER_RESULT_V3"
}
```

`result_path` 是唯一允许写出业务范围外的协调元数据。先把完整结果原子写入该路径，再在聊天中返回语义相同的 JSON；`changed_files` 不包含该文件。

## 普通结果

根据实际情况填写 `status` 和证据；`completed` 时 `scope_request` 必须为 `null`。review 的非阻断建议写入 `summary`，保持 `completed` 和 `diff_self_check: pass`。

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed | blocked | failed",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "thread_id": "<绑定线程 id>",
  "profile_evidence": "create_thread:gpt-5.6-sol/medium",
  "changed_files": ["<work 的业务路径；review/verify 填 []>"],
  "verification": ["<命令及结果>"],
  "diff_self_check": "pass | fail",
  "scope_request": null,
  "summary": "<结果或阻塞证据>"
}
```

## 写入范围变化或阻断审查

work 需要扩大写域，或 review 发现阻断缺陷时使用。review 必须保持 `changed_files: []`，并在 `scope_request.paths` 精确列出后继 work 需要修复的路径；`scope_exception` 表示只读 review 正在把修复职责交回规划器，不表示它修改了文件。非阻断建议不得使用此结果。

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "needs_main_review",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "thread_id": "<绑定线程 id>",
  "profile_evidence": "create_thread:gpt-5.6-sol/medium",
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

完成唯一终态结果后：

1. 在 `result_path` 同目录写临时文件。
2. 写入完整且合法的 `WORKER_RESULT_V3`，再原子替换 `result_path`。
3. 在消息中原样返回同一 JSON，不添加第二份自然语言结果。

主线程执行终态 update 后，驱动器会把该 JSON 内嵌到 `state.tasks.<task_id>.result`。除 `work` 的授权业务文件外，三种角色都只允许额外写这一协调元数据文件；`review` 与 `verify` 的 `changed_files` 必须为 `[]`。

## 聚焦补修输入

收到以下差量时，只恢复当前 task，补齐列出的结果或证据，并重新原子写入同一 `result_path`；不得扩大业务写入范围。

```json
{
  "contract": "WORKER_REPAIR_V3",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_id": "<绑定线程 id>",
  "result_path": "<plan_dir>/results/T1.json",
  "missing_or_invalid": ["<需要补齐的字段或证据>"],
  "required_action": "<仅修复当前结果所需的动作>",
  "return_contract": "WORKER_RESULT_V3"
}
```

无法补齐成功证据时，仍须把原始原因写入身份正确、契约合法的 `failed` 结果；不得返回第二份非法或缺字段结果。
