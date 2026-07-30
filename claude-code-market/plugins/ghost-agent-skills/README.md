# Ghost Agent Skills Claude Code 插件

包含与 Owner/DAG 工作流解耦的 `git-commit` skill。它使用只读子代理分析当前 Git 变化，再由主线程复核并完成暂存和提交。

推荐入口：

```text
/ghost-agent-skills:git-commit 检查当前改动并创建清晰的 Git 提交
```
