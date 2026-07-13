# 任务执行模板

## 输入绑定包

绑定包只包含当前任务，不得携带其他任务的写入权限。

```json
{
  "plan_path": "<计划绝对路径>",
  "state_path": "<状态绝对路径>",
  "parent_goal": "<完整父目标>",
  "dispatch_key": "<plan_path>#<task_id>",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "title": "抽离页面状态类型",
  "thread_role": "work | review",
  "module_id": "implementation",
  "task": "<单一可执行结果>",
  "depends_on": [],
  "writable_paths": ["<授权写入路径>"],
  "done_when": ["<完成条件>"],
  "verification": ["<验证命令或证据>"],
  "worker_context": "<模块共享上下文>",
  "thread_id": "<真实线程 id>",
  "worker_profile": {
    "model": "<实际模型>",
    "reasoning_effort": "<实际强度>"
  },
  "profile_evidence": "<创建或继承证据>",
  "result_contract": "WORKER_RESULT_V3"
}
```

## 普通结果

根据实际情况填写 `status` 和证据；`completed` 时 `scope_request` 必须为 `null`。

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed | blocked | failed",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review",
  "module_id": "implementation",
  "thread_id": "<绑定线程 id>",
  "profile_evidence": "<模型配置核对结果>",
  "changed_files": ["<路径>"],
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
  "thread_role": "work | review",
  "module_id": "implementation",
  "thread_id": "<绑定线程 id>",
  "profile_evidence": "<模型配置核对结果>",
  "changed_files": ["<已产生且可归因的路径>"],
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
