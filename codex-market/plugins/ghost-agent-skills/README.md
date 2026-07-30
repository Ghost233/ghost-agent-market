# Ghost Agent Skills Codex 插件

这个插件只包含不依赖 Owner、Goal 或 DAG 的普通 skill：

- `git-commit`：由 `gpt-5.6-terra/medium` 执行子代理负责完整提交事务，并由其嵌套的同配置只读子代理独立审查；主线程只调度和转发结果。
- `git-commit-direct-model-test`：Codex App 专用的只读运行时探测，严格串行测试 `spawn_agent` / `create_thread` 与 Spark / Luna 的四种组合。

`git-commit-direct-model-test` 依赖 Codex App 的线程与直接模型调用能力，因此不会同步到 Claude Code 或 Kimi Code 插件。

推荐入口：

```text
使用 $git-commit 检查当前改动，并按职责创建清晰的 Git 提交。
```
