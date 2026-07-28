# Kimi Marketplace

这个目录提供 Kimi Code 可安装的插件：

- `ghost-agent-workflow`

`ghost-agent-workflow` 包含八个 skill：

- `parallel-task-planner`
- `planner-reviewer`
- `setup-sub-thread-workflow`
- `sub-thread-coordination`
- `sub-thread-goal-worker`
- `sub-thread-task-supervisor`
- `start-dag-dashboard`
- `git-commit`

## 推荐入口

```text
/skill:sub-thread-coordination 以持久子线程 DAG 执行 `./plan.md`。
```

Kimi Code 固定使用 `standalone_thread` 生命周期，不依赖原生 Goal。显式 `/skill:sub-thread-coordination` 是公开 DAG 控制器；当目标未完成时，它返回 runtime 生成的单行续跑提示（`/skill:sub-thread-coordination 继续 <goal.json绝对路径>`），请逐字使用。

只有宿主提供可创建、发送和等待的长期子线程 API 时才能执行。标准 Agent 禁止作为回退；缺少能力时在规划后 fail closed。`gpt-5.6-luna/medium` Supervisor 只通过脚本创建、等待和通知最多 8 个执行子线程；配置包含四组 profile，机械 gate 由脚本执行。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`；新线程取得正式 threadId 后自行设置 canonical 标题。脚本 JSON 只作机器收据，主线程完成机械验收后才报告 task 最终结果。

Review 是显式 DAG 节点，机械验收由 runtime 执行，共享验证由 verify 节点生成可复用 evidence。所有 JSON、JSONL、YAML、TOML 与配置都通过脚本写入；完整结果只落盘，子线程聊天只返回紧凑 receipt。

初始 DAG 通过机械校验后，由独立 Planner Reviewer 检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 通过 `/skill:start-dag-dashboard` 调用后台 Node 启动器；启动器从工作目录的 `.ghost-agent-workflow` 发现活动 Goal，并只报告一次 URL。网页通过文件监听和 SSE 接收 runtime 数据更新。

Owner 是仓库级永久代码模块主体。新增、分裂或 scope 变化必须由脚本验证并等待用户对精确 digest 的批准；工作流等待用户操作时不启动空模型回合累计 blocked 次数。

只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 是临时执行状态，应加入 `.gitignore`。Owner 新增或分裂必须经脚本冲突验证和用户对精确 digest 的明确批准。

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
