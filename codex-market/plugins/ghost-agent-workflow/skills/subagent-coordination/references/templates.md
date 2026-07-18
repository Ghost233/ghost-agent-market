# 子代理协调模板

绑定包、`WORKER_RESULT_V3` 和 `WORKER_REPAIR_V3` 的唯一模板位于 `$subagent-goal-worker/references/templates.md`。协调器发送或校验这些对象前必须读取该文件，不在这里复制契约。

## 启动包

仅当 `next.action.thread_id` 为 `null` 且当前 agent tree 没有唯一同名子代理时使用：

```json
{
  "contract": "SUBAGENT_BOOTSTRAP_V1",
  "dispatch_key": "<plan_path>#<task_id>",
  "owner": "<module_id>#<thread_role>",
  "display_name": "[GA][<实施|审查|验证>][待命] <中文任务名>",
  "worker_skill": "$subagent-goal-worker",
  "runtime_profile": {
    "model": "gpt-5.6-sol",
    "reasoning_effort": "medium"
  },
  "required_action": "加载 worker skill，返回 READY；收到完整绑定包前不得执行任务或修改文件"
}
```

调用 `spawn_agent` 时固定传入：

```json
{
  "model": "gpt-5.6-sol",
  "reasoning_effort": "medium",
  "fork_turns": "none",
  "task_name": "ga_<plan_token>_<module_token>_<role>_sol_medium",
  "message": "<SUBAGENT_BOOTSTRAP_V1>"
}
```

直接调用的 `spawn_agent` schema 暴露 `agent_type` 时，在上述调用中附加 `"agent_type": "worker"`；未暴露时保持原调用，不得因此阻塞。缺少 `model`、`reasoning_effort` 或 `fork_turns` 时不得创建子代理。必须以真实调用结果判断成功或失败，不得通过 `functions.exec`、`ALL_TOOLS` 或工具搜索做预判。

`task_name` 是工具要求的内部标识；协调过程和用户报告只显示 `display_name`。`<中文任务名>` 必须至少包含一个中文汉字。

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
