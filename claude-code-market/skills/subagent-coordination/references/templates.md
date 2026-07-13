# 子代理协调模板

绑定包、`WORKER_RESULT_V3` 和 `WORKER_REPAIR_V3` 的唯一模板位于 `$subagent-goal-worker/references/templates.md`。协调器发送或校验这些对象前必须读取该文件，不在这里复制契约。

## 启动包

仅当 `next.action.thread_id` 为 `null` 且当前会话没有唯一同名子代理时使用：

```json
{
  "contract": "SUBAGENT_BOOTSTRAP_V1",
  "dispatch_key": "<plan_path>#<task_id>",
  "owner": "<module_id>#<thread_role>",
  "worker_skill": "$subagent-goal-worker",
  "required_action": "加载 worker skill，返回 READY；收到完整绑定包前不得执行任务或修改文件"
}
```

首次调用 `Agent` 不附带执行配置参数；已有 `agentId` 使用 `SendMessage({to: agentId})` 恢复。

## 协调结果

```json
{
  "contract": "PARALLEL_PLAN_RESULT",
  "status": "completed | blocked | dispatch_failed | executor_mode_mismatch",
  "parent_goal": "<完整父目标>",
  "executor_mode": "subagent",
  "plan_path": "<最终 revision 的绝对路径>",
  "evidence": ["<验证、错误或用户边界证据>"],
  "summary": "<父目标结果>"
}
```
