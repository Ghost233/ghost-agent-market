# Kimi Marketplace

这个目录提供 Kimi Code 可安装的插件：

- `ghost-agent-workflow`

`ghost-agent-workflow` 包含四个 skill：

- `parallel-task-planner`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

## 推荐入口

```text
/skill:subagent-coordination 执行 `./plan.md`,以子代理 DAG 完整执行,直到计划项覆盖率 100% 且所有验收通过。
```

Kimi Code 的原生 Goal 不向插件暴露稳定的 native instance identity（无 threadId/createdAt），因此本插件使用 `local_fallback` 生命周期：显式 `/skill:subagent-coordination` 是唯一公开 DAG 控制器；当目标未完成时，它会返回 runtime 生成的单行续跑提示（`/skill:subagent-coordination 继续 <goal.json绝对路径>`），请逐字使用该提示继续执行。如果你希望获得自动外循环，也可以用原生 `/goal 每轮调用 subagent-coordination skill …` 包裹；skill 本身不调用 CreateGoal/UpdateGoal，也不依赖原生 Goal 存在。

控制器内部调用 planner 生成 coverage/plan/delta，并把 attempt 分发给 worker；执行方式固定为 `subagent`。instance identity 取 source 绝对路径与 source digest 的 SHA-256 前 12 位小写 hex 后缀，恢复时精确校验 instance 与 objective digest。首次运行先冻结工作区 baseline、生成 `SOURCE_BLOCKS_V1`；coverage 按 source refs × implementation/verification effects 计算，独立 source audit 在 work 前证明无遗漏，最终 diff audit 由 runtime 扫描 baseline 与真实工作区并固化 artifact digest。DAG 耗尽但 required effect coverage 不足 100% 时进入 `needs_delta`。

Owner 是稳定的逻辑责任域，Agent 只是软亲和执行载体。执行器通过 `Agent(run_in_background: true)` 启动、`Agent(resume:)` 复用，正确性只依赖 `.ghost-agent-workflow/` 中的持久状态，不依赖 Agent 会话记忆。Kimi 子代理固定平台默认 profile（runtime_profile 为 null），不同 Goal 不复用 Agent。

`.ghost-agent-workflow/` 只保存本地 runtime state，不应提交；请在使用插件的项目中将它加入 `.gitignore`。

## 安装

### 方式一：GitHub 一键安装（免克隆）

CI 会把 `main` 分支的 `kimi-market/` 构建成滚动 release（tag `kimi-latest`），在 Kimi Code 中直接安装 release 附件 zip：

```text
/plugins install https://github.com/Ghost233/ghost-agent-market/releases/download/kimi-latest/ghost-agent-workflow-kimi.zip
```

或者通过远程 marketplace 清单安装：

```text
/plugins marketplace https://raw.githubusercontent.com/Ghost233/ghost-agent-market/main/kimi-market/.kimi-plugin/marketplace-remote.json
```

然后在插件面板中安装 `ghost-agent-workflow`。

注意：仓库整库 URL（含 `/tree/...`）不支持安装——Kimi 只认 zip 根部的 manifest，monorepo 子目录不会被发现，所以必须走上面的 release zip。第三方来源首次安装会弹信任确认（默认取消，需手动选择信任）。zip 安装不参与自动更新检查，重新执行同一命令即可更新到最新构建。

### 方式二：克隆后本地安装

克隆本仓库后，在 Kimi Code 中执行：

```text
/plugins install <仓库路径>/kimi-market/plugins/ghost-agent-workflow
```

或者：

```text
/plugins marketplace <仓库路径>/kimi-market/.kimi-plugin/marketplace.json
```

然后在插件面板中安装 `ghost-agent-workflow`。

通用注意事项：

- 插件安装在用户级 `$KIMI_CODE_HOME/plugins/managed/<id>/`，对全部项目生效。
- 安装或更新后需要 `/reload` 或开启新会话才会生效。
- 本地安装会把插件复制到 managed 目录；修改源目录后需要重新安装才能同步改动。
- Goal DAG 相关 skill 通过 `node` 执行 runtime 脚本，需要用户机器安装 Node.js；`git-commit` 不依赖 Node。
