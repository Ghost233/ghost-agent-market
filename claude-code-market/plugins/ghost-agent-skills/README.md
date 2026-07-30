# Ghost Agent Skills Claude Code 插件

包含与 Owner/DAG 工作流解耦的 `git-commit` skill。它由 `gpt-5.6-terra/medium` 执行子代理负责完整提交事务，并由其嵌套的同配置只读子代理独立审查；主线程只调度和转发结果。

推荐入口：

```text
/ghost-agent-skills:git-commit 检查当前改动并创建清晰的 Git 提交
```
