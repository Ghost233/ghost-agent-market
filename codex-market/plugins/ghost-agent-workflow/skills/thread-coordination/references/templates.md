# 协调模板

绑定包、`WORKER_RESULT_V3` 和 `WORKER_REPAIR_V3` 的唯一模板位于 `$thread-goal-worker/references/templates.md`。协调器发送或校验这些对象前必须读取该文件，不在这里复制契约。

## 创建线程

仅当 `next` action 的 `thread_id` 为 `null` 时使用；协调器不另行搜索已有线程：

```text
create_thread(
  target={type: project, projectId: <项目 id>, environment: {type: local}},
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<expected_title；dispatch_key；task_id；module_id；thread_role；状态：待命；收到完整绑定包前不得执行>
)
```

接受非空 `threadId`。普通错误文本不能当作 JSON 解析。结果不明确时先按 `dispatch_key` 查询；唯一匹配才采用。

## 标题

```text
[GA][<实施|审查|验证>][<待命|执行|补修|完成|复核|阻塞|失败>] <logical_id> · <title>
```

## 协调结果

```json
{
  "contract": "PARALLEL_PLAN_RESULT",
  "status": "completed | blocked | dispatch_failed",
  "parent_goal": "<完整父目标>",
  "plan_path": "<最终 revision 的绝对路径>",
  "evidence": ["<验证、错误或用户边界证据>"],
  "summary": "<父目标结果>"
}
```
