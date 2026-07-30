# Ghost Agent Skills Codex 插件

这个插件只包含不依赖 Owner、Goal 或 DAG 的普通 skill：

- `git-commit`：由只读子代理分析 staged、unstaged、untracked 与 submodule 变化，再由主线程复核、暂存并提交。
- `git-commit-direct-model-test`：Codex App 专用的只读运行时探测，严格串行测试 `spawn_agent` / `create_thread` 与 Spark / Luna 的四种组合。

`git-commit-direct-model-test` 依赖 Codex App 的线程与直接模型调用能力，因此不会同步到 Claude Code 或 Kimi Code 插件。

推荐入口：

```text
使用 $git-commit 检查当前改动，并按职责创建清晰的 Git 提交。
```
