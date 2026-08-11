# Claude Code Market

这个目录提供三个 Claude Code 可安装插件。

`ghost-agent-workflow` 包含七个工作流 skill：

- `parallel-task-planner`
- `planner-reviewer`
- `setup-sub-thread-workflow`
- `sub-thread-coordination`
- `sub-thread-goal-worker`
- `sub-thread-task-supervisor`
- `start-dag-dashboard`

`ghost-agent-skills` 包含不依赖 Owner/DAG 的普通 skill：

- `git-commit`
- `git-merge-conflict`

`mattpocock-skills-zh` 是 Matt Pocock《Skills for Real Engineers》的非官方中文翻译版，收录上游发布的 25 个稳定 skill。安装一个 plugin 即可加载整批 skill。

Claude Code 没有 Codex 原生 `/goal` 生命周期，工作流固定使用 `standalone_thread`。首次运行使用平台的显式 skill 调用：

```text
/ghost-agent-workflow:sub-thread-coordination 执行 `./plan.md`；如果未指定 Quick 或 DAG，先让我选择运行模式
```

只有宿主提供可创建、发送和等待的长期子线程 API 时才能执行。标准 Agent 不具备用户长期持有上下文与完成约束，禁止作为回退；缺少子线程 API 时在规划后 fail closed。

若一轮尚未完成，skill 原样返回 runtime 生成的一行短续跑提示：

```text
/ghost-agent-workflow:sub-thread-coordination 继续 `<goal.json绝对路径>`。
```

短提示必须逐字使用 runtime 输出，不携带计划、DAG、Owner Capsule 或 worker prompt；下一轮从 `.ghost-agent-workflow/` 恢复当前状态。启动前必须由用户明确选择模式；Quick 不启动 Supervisor；DAG 移交后的 Main 使用 `gpt-5.6-sol/xhigh`，`gpt-5.6-luna/medium` Supervisor 通过脚本按需启动宿主监督 turn，最多等待 8 个已登记线程，没有 active 任务就停止，Main 不周期唤醒。当前 Goal 建立后统一用 `workflow step <goal-dir>` 恢复。新线程只用 `create_thread`，禁止 fork Main 历史；Owner Git 同步由 Main 显式执行。配置包含五组 profile，机械 gate 与定向验证由脚本执行。

DAG 启动命令为 `workflow start-dag <workspace> <development-key>`；脚本生成集成分支 `ga/<key>/main` 和 Owner 分支 `ga/<key>/<owner_id>`。原始工作区始终保留用户分支并可继续提交；交付时合并到该分支的最新 HEAD，冲突则保留全部 worktree 与分支。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`；新线程取得正式 threadId 后自行设置 canonical 标题。脚本 JSON 只作机器收据，主线程完成机械验收后才报告 task 最终结果。

`sub-thread-coordination` 是唯一协调入口。Quick 使用显式串行 Review；DAG Planner 把 Review 设计为显式节点。机械验收由 runtime 执行，不保存 evidence history。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

初始 DAG 通过机械校验后，由独立 Planner Reviewer 检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 通过 `/ghost-agent-workflow:start-dag-dashboard` 调用后台 Node 启动器并只报告一次共享 URL。所有项目竞争 `127.0.0.1:57357`，首个成功者作为主看板，其他参与者推送变化；主看板退出后自动重新选举。页面顶部按工作区文件夹提供项目 Tab，`progress.json` 与 `events.jsonl` 仍由 runtime 脚本维护。

所有结构化文件和配置都通过脚本写入；完整 `WORKER_RESULT_V5` 只落盘，聊天只返回紧凑 receipt。runtime 使用轻量 workspace fence，不复制所有受管理文件。初始化脚本自动生成 `.ghost-agent-workflow/.gitignore`，只跟踪自身、配置与 Owner 数据并忽略 runtime；已有文件不覆盖。Owner 新增、分裂或 scope 变化必须经脚本冲突验证和用户对精确 digest 的明确批准。

## 安装

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market
```

这是 Claude Code 会话内的斜杠命令，不要追加终端 CLI 使用的 `--sparse` 参数。

安装插件：

```text
/plugin install ghost-agent-workflow@ghost-agent-market
/plugin install ghost-agent-skills@ghost-agent-market
/plugin install mattpocock-skills-zh@ghost-agent-market
```

安装或更新后，请新开一个 Claude Code 会话加载新增 skill。
