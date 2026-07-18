# 协调模板

分派包、`WORKER_RESULT_V3` 和 `WORKER_REPAIR_V3` 的唯一模板位于 `$thread-goal-worker/references/templates.md`。协调器发送或校验这些对象前必须读取该文件，不在这里复制契约。

## 创建执行单元

仅当 `next` action 的 `thread_id` 为 `null` 时创建；协调器不另行搜索已有执行单元。使用 module 初始固定的 `worker_profile`，预备提示只包含：

```text
expected_title；dispatch_key；task_id；module_id；thread_role；状态：待命；收到完整分派包前不得执行
```

创建结果不明确时先按 `dispatch_key` 查询；唯一匹配才采用。

## 名称

```text
[GA][<实施|审查|验证>][<待命|执行|补修|完成|复核|阻塞|失败>] <中文任务名>
```

中文任务名只取 task 的 `title`。`logical_id`、`module_id`、`dispatch_key` 等内部技术标识不得出现在面向用户的标题中。

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
