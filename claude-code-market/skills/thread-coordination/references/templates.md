# 协调模板

## 任务分派包

只填入当前任务，不附带其他任务的写入权限。

```json
{
  "plan_path": "<计划绝对路径>",
  "state_path": "<状态绝对路径>",
  "parent_goal": "<完整父目标>",
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

## WORKER_RESULT_V3 普通结果

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

## WORKER_RESULT_V3 写入范围变化

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
    "paths": ["<需要增加或重新分配的路径>"],
    "reason": "<为什么当前范围不足>",
    "required_for_done_when": "<关联的完成条件>",
    "suggested_owner": "<建议 module 或 logical_id>",
    "split_hints": ["<可独立验收的结果>"],
    "overlap_hints": ["<已知交叉路径、契约或生成产物>"]
  },
  "summary": "<交给主会话的重规划证据>"
}
```

## state 内嵌结果

执行单元先把完整 `WORKER_RESULT_V3` 原子写入绑定的 `result_path`，并在消息中返回完全相同的 JSON。协调会话使用终态 update 后，state 中对应任务必须包含：

```json
{
  "tasks": {
    "T1": {
      "status": "completed | blocked | failed | needs_main_review",
      "thread_id": "<绑定执行单元 id>",
      "result": {
        "contract": "WORKER_RESULT_V3",
        "status": "<与任务终态相同>",
        "task_id": "T1",
        "logical_id": "state.extract-types",
        "thread_role": "work | review | verify",
        "module_id": "state-domain",
        "thread_id": "<绑定执行单元 id>",
        "profile_evidence": "<模型配置与分派归属核对结果>",
        "changed_files": ["<tracked file 路径>"],
        "verification": ["<命令、退出码、原始错误与日志路径>"],
        "diff_self_check": "pass | fail | scope_exception",
        "scope_request": null,
        "summary": "<结果或阻塞证据>"
      }
    }
  }
}
```

`review` 与 `verify` 的 `changed_files` 必须为 `[]`。终态 state 不得只有 status 而缺少 result。

## 聚焦补修差量

仅在首次结果字段缺失、验证不足或普通差异自检失败时发送一次，不重发完整分派包。

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
