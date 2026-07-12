# 协调模板

## 创建预备线程

```text
create_thread(
  target={type: project, projectId: <项目 id>, environment: {type: local}},
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<任务：logical_id · title；dispatch_key；task_id；module_id；状态：预备；收到完整绑定包前不得执行>
)
```

## 任务绑定包

只填入当前任务，不附带其他任务的写入权限。

```json
{
  "plan_path": "<计划绝对路径>",
  "state_path": "<状态绝对路径>",
  "parent_goal": "<完整父目标>",
  "dispatch_key": "<plan_path>#<task_id>",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "title": "抽离页面状态类型",
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

## WORKER_RESULT_V3 普通结果

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed | blocked | failed",
  "task_id": "T1",
  "logical_id": "state.extract-types",
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

## WORKER_RESULT_V3 写入范围变化

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "needs_main_review",
  "task_id": "T1",
  "logical_id": "state.extract-types",
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

## 协调结果

```json
{
  "contract": "PARALLEL_PLAN_RESULT",
  "status": "completed | blocked | dispatch_failed",
  "parent_goal": "<完整父目标>",
  "plan_path": "<最终 revision 的绝对路径>",
  "evidence": ["<验证、错误或阻塞证据>"],
  "summary": "<父目标结果>"
}
```
