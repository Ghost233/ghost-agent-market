# 协调模板

执行模式提示和 Mermaid 只由规划器在每个 revision 校验成功后展示一次，不进入线程绑定包，也不作为依赖或结果证据。

线程归属固定为 `(parent_goal, module_id, thread_role)`。同一归属跨全部 revision 复用一个保留线程；`dispatch_key` 只标识当前 task 的分派与创建重试，不是线程身份。首次创建使用 module 的 profile；复用时继承已有线程的实际配置，并使用当前 task 的最新领域化 `worker_context`。

## 创建预备线程

```text
create_thread(
  target={type: project, projectId: <项目 id>, environment: {type: local}},
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<expected_title；dispatch_key；task_id；thread_role；module_id；状态：待命；收到完整绑定包前不得执行>
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
  "result_path": "<plan_dir>/results/<task_id>.json",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "title": "抽离页面状态类型",
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
    "model": "<实际模型>",
    "reasoning_effort": "<实际强度>"
  },
  "profile_evidence": "<创建或继承证据>",
  "result_contract": "WORKER_RESULT_V3"
}
```

执行线程把完整结果原子写入唯一 `result_path`，并在聊天中返回语义相同的 JSON。终态更新把该路径传给 driver；校验通过后，完整结果保存为 `state.tasks.<task_id>.result`。

绑定包中的 `task_id`、`logical_id`、权限和 `result_path` 都是 task 局部字段。复用线程承接下一 task 时必须全部替换；只有 `module_id + thread_role` 保持线程归属。

## WORKER_RESULT_V3 普通结果

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed | blocked | failed",
  "task_id": "T1",
  "logical_id": "state.extract-types",
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "thread_id": "<绑定线程 id>",
  "profile_evidence": "<模型配置核对结果>",
  "changed_files": ["<work 的业务路径；review/verify 填 []>"],
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
  "thread_role": "work | review | verify",
  "module_id": "state-contract",
  "thread_id": "<绑定线程 id>",
  "profile_evidence": "<模型配置核对结果>",
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

## 聚焦补修差量

仅在首次结果字段缺失、验证不足或普通差异自检失败时发送一次，不重发完整绑定包。

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

无法补齐成功证据时，仍须返回身份正确、契约合法且保留原始原因的 `failed` 结果。若补修结果继续非法或线程不可达，协调器保留 `running/thread_id` 并返回 `dispatch_failed`，不得伪造终态或进入静止点修订。

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
