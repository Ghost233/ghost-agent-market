# 任务执行模板

当前执行单元固定归属一个 `parent_goal` 内的 `(module_id, thread_role)`，可以顺序承接该归属的多个 task，但不得承接其他父目标。module 的 profile 与 context 在当前父目标内固定；每次新分派只替换 task 局部目标、权限、结果路径和证据。

## 输入绑定包

分派包只包含当前任务，不得携带其他任务的写入权限或 Mermaid。依赖、写入范围与完成条件只以计划 JSON 和本包字段为准。

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
  "thread_role": "work | review | verify",
  "module_id": "state-domain",
  "task": "<单一可执行结果>",
  "depends_on": [],
  "writable_paths": ["<授权写入路径>"],
  "done_when": ["<完成条件>"],
  "verification": ["<验证命令或证据>"],
  "worker_context": "<模块共享上下文>",
  "thread_id": "<真实执行单元 id>",
  "worker_profile": {
    "model": "<实际模型>",
    "reasoning_effort": "<实际强度>"
  },
  "profile_evidence": "<模型配置与创建或继承证据>",
  "result_contract": "WORKER_RESULT_V3"
}
```

## 普通结果

根据实际情况填写 `status` 和证据；`completed` 时 `scope_request` 必须为 `null`。`work` 以自身 verification 与差异自检默认闭环。`review` 的非阻断建议写入 `summary`，并使用 `completed`、`diff_self_check: pass` 和 `scope_request: null`，不得触发 revision。

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed | blocked | failed",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-domain",
  "thread_id": "<绑定执行单元 id>",
  "profile_evidence": "<模型配置与分派归属核对结果>",
  "changed_files": ["<路径>"],
  "verification": ["<命令、退出码、原始错误与日志路径>"],
  "diff_self_check": "pass | fail",
  "scope_request": null,
  "summary": "<结果或阻塞证据>"
}
```

## 写入范围变化或审查阻断缺陷

只有 work 需要扩大写入范围，或 review 发现必须由后继 work 修复的阻断缺陷时使用 `needs_main_review`。review 的 `changed_files` 仍为 `[]`；其 `scope_request.paths` 填写后继 work 需要修复的精确路径，`diff_self_check: scope_exception` 是共享 driver 要求的重规划信号，不表示 review 写过业务文件。非阻断建议不得使用此结构。

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "needs_main_review",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-domain",
  "thread_id": "<绑定执行单元 id>",
  "profile_evidence": "<模型配置与分派归属核对结果>",
  "changed_files": ["<已产生且可归因的路径>"],
  "verification": ["<已完成的验证及结果>"],
  "diff_self_check": "scope_exception",
  "scope_request": {
    "paths": ["<需要增加、重新分配或由后继 work 修复的精确路径>"],
    "reason": "<为什么当前范围不足，或阻断缺陷为什么必须修复>",
    "required_for_done_when": "<关联的完成条件>",
    "suggested_owner": "<建议 module 或 logical_id>",
    "split_hints": ["<可独立验收的结果>"],
    "overlap_hints": ["<已知交叉路径、契约或生成产物>"]
  },
  "summary": "<交给主会话的重规划证据>"
}
```

## 结果持久化

完成唯一终态结果后：

1. 在 `result_path` 同目录写临时文件。
2. 写入完整且合法的 `WORKER_RESULT_V3`，再原子替换 `result_path`。
3. 在消息中原样返回同一 JSON，不添加第二份自然语言结果。

协调会话执行终态 update 后，驱动器会把该 JSON 内嵌到 `state.tasks.<task_id>.result`。除 `work` 的授权业务文件外，三种角色都只允许额外写这一协调元数据文件；`review` 与 `verify` 的 `changed_files` 必须为 `[]`。

## 聚焦补修输入

收到以下差量时，只补齐列出的结果或证据，并重新原子写入同一 `result_path`；不得扩大业务写入范围。

```json
{
  "contract": "WORKER_REPAIR_V3",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_id": "<绑定执行单元 id>",
  "result_path": "<plan_dir>/results/T1.json",
  "missing_or_invalid": ["<需要补齐的字段或证据>"],
  "required_action": "<仅修复当前结果所需的动作>",
  "return_contract": "WORKER_RESULT_V3"
}
```

无法补齐成功证据时，仍须把原始原因写入身份正确、契约合法的 `failed` 结果；不得返回第二份非法或缺字段结果。
