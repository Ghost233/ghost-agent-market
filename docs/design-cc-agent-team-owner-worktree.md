# 设计方案：Owner Subagent 编排 + Worktree + Hook 隔离

> 状态：实现中（阶段0验证通过、阶段1核心产物就位）
> 日期：2026-08-09
> 范围：仅 Claude Code 端。
> 领域模型：见 `CONTEXT.md`（术语与架构原则的权威定义）。

## 1. 目标

在 Claude Code 原生能力上实现「main 编排 owner subagent → 每个 owner 独立 worktree → hook 强制 scope 隔离」的协作模式，核心是**完美的模块隔离 + 零冲突**：

1. **main 启动时绑定 owner**，为每个 owner spawn 一个 owner-worker subagent。
2. **每个 owner 一个独立 worktree**（1:1:1 串行，并行来自不同 owner）。
3. **owner 只能改自己 write scope 内的文件**——PreToolUse hook 强制，越界实时 deny；合并前脚本兜底。

零冲突靠 owner write scope 两两不相交从架构保证（数学必然，不靠工具挡）。隔离两层：worktree 管"并行隔离"，hook 管"权限隔离"。

## 2. 可行性前提（阶段0已实测，CC v2.1.224）

**为什么不用 agent team（带 team_name 的 teammate）**：CC 当前两个未修缺陷使 team 路径不可用——
1. `Agent(isolation:"worktree")` 带 `team_name` 时 worktree 不生效（issue #33045，open）。
2. PreToolUse frontmatter hook 对 team teammate 不触发（#42385/#45329）。

**走普通 subagent 编排**：`Agent(isolation:"worktree")` **不带 team_name**。阶段0实测确认此路径：
- ✅ frontmatter hook 对 subagent 触发，deny 真阻断 Write。
- ✅ cwd = worktree 根（`.claude/worktrees/agent-<id>/`）。
- ✅ hook 进程环境有 `CLAUDE_PROJECT_DIR`（指向主仓库根，能找 owner 定义）。
  - ⚠️ subagent 的 Bash 环境无此变量（两套环境），故 place-binding.sh 用 `git rev-parse`。
- ✅ 绑定指针 teammate 首条指令自投放可行（投放前 fail-closed）。
- ✅ main 不走 owner hook（frontmatter hook 是 agent-scoped）。

代价：放弃 team 身份/teammate 直连/team 任务板，main 自管派活状态。本模型 main 是唯一枢纽、成员不直连——无损。

## 3. 隔离栈

```
owner-worker subagent（在 CC 托管 worktree 里）
  │
  ├─【层 A】worktree（CC isolation:"worktree" 自动托管）
  │     独立工作区 + 独立分支 → 并行不互相覆盖、合并零冲突
  │     不限权限（owner 能在分支内改别的文件）← 由层 B 补
  │
  └─【层 B】PreToolUse hook（owner-worker frontmatter，实时）
        Edit/Write/MultiEdit → cwd → 绑定指针 → owner 定义 → scope
        scope 外 deny（硬阻断，fail-closed）
```

**身份反查链路**（无竞态）：`cwd`(worktree根) → worktree 内 owner 绑定指针 → owner 定义文件 → scope。

**投放时序**：CC 不提前告知 worktree 路径 → 绑定指针由 **owner-worker 首条指令自投放**（place-binding.sh，用 `git rev-parse --show-toplevel` 拿 worktree 根）。hook fail-closed 保证 teammate 必须先投放才能干活，顺序天然。

**合并前兜底**：Bash 越界（sed/echo 改 scope 外文件）hook 的 Edit/Write matcher 拦不住——靠合并前脚本扫各 owner 分支累计 diff 做scope 校验 + 相交检测兜底。

## 4. 关键产物（阶段1已就位）

| 产物 | 路径 | 职责 |
|---|---|---|
| 通用 owner agent | `.claude/agents/owner-worker.md` | 固定单文件，frontmatter 挂 hook（frontmatter 的 isolation 仅为约定，**CC 实际不读它**——spawn 调用必须显式传 `isolation="worktree"` 才建 worktree，见 CONTEXT.md 实测踩坑）。owner 是数据不是 agent 类型 |
| 层 B hook | `.ghost-agent-workflow/hooks/enforce-scope.sh` | cwd→指针→owner→scope→deny/放行，fail-closed |
| 绑定指针投放 | `.ghost-agent-workflow/hooks/place-binding.sh` | teammate 首条指令投放 pointer.json |
| scope 纯函数 | `claude-code-market/scripts/scope-match.mjs` | 匹配/相交检测基石，从 expert-registry 提取 |
| scope 校验 | `claude-code-market/scripts/scope-check.mjs` | static（静态相交）/ diff（单分支）/ merge（合并前动态）|
| owner 示例 | `.ghost-agent-workflow/owners/cc-scripts-owner.md` 等 | 2 个不相交 scope 示例 |
| main SOP | `claude-code-market/skills/start-owner-team/SKILL.md` | Phase 0→实例化→派活→验收→合并 |

**通用 owner-worker 架构**：不做"每 owner 一个 agent 定义"，而是一个固定 `owner-worker` agent。spawn 时 main 通过 prompt 注入 owner 身份（哪个 owner、任务、上下文）。owner 定义（scope、职责）是**数据**，存 `.ghost-agent-workflow/owners/*.md`。解决"加 owner 要重启 CC"和"owner 污染 agent 列表"两个问题。代价：失去 CC 自动委派（无损，本模型 main 显式编排）。

## 5. 两段式 scope 校验

| 时机 | 校验 | 实现 |
|---|---|---|
| 实例化时（静态）| 各 owner 声明 scope 两两不相交 | `scope-check.mjs static` |
| 合并前（动态）| 各 owner 分支累计 diff 全在各自 scope 内 + 跨 owner 实际改动不相交 | `scope-check.mjs merge` + `owner-merge.mjs` |

校验全脚本化、确定性，不靠 LLM 猜。Bash 越界兜底在合并前。

## 6. owner 定义格式

`.ghost-agent-workflow/owners/<id>.md`，id 过正则 `^[a-z0-9][a-z0-9-]{0,62}$`：

```markdown
---
id: payment-owner
responsibility: 支付领域决策与产出
scope:
  - payment/              # 目录（尾斜杠 = 目录下所有）
  - config/payment.yaml   # 单文件
scope_excludes: []        # 可选
---
（owner SOP 正文）
```

- scope = write scope，只约束写，读不受限。
- 尾斜杠语义：`payment/` = `payment/**`；`payment` = 名为 payment 的单文件。
- scope 封闭语义：前缀内新建合法，事后回写 owner 定义补登记。

## 7. 调度状态（C：TaskCreate + JSON 混合）

- **TaskCreate**：管"这次的活"、in-progress 判断（1:1:1 串行）。任务跑完即结。
- **JSON 持久态** `.ghost-agent-workflow/.runtime/team-state.json`：管跨会话持久值——每 owner 的 `verified_base` commit、worktree 路径。
- in-progress 只在 TaskCreate，不冗余进 JSON。

## 8. 依赖图（外置脚本，main 动态取层）

owner 间硬依赖由外置依赖图表达（task 带 depends_on，脚本算 ready、投影下一层），main 从"当前可执行层"取 owner 派活。读依赖不进图（随时读）。第一版依赖关系简单，由 main 按任务板 blockedBy 推进；复杂场景接入依赖图脚本。

## 9. 交付契约（存档≠验收）

- teammate 自己 commit 到 `ga/owner/<id>` 分支（存档）。
- main 凭 git diff + 独立验收脚本判定（不信 teammate 文本汇报）。
- 验收通过 → 更新 verified_base；不通过 → reset 回旧 verified_base + 注入上下文重派。
- 接手基线：每次派 teammate 前 reset 到 verified_base，未验收全清。

## 9a. 合并（no-ff，非快进）

scope 不相交保证**改动不重叠**，但多 owner **顺序合并到 main 时不是快进**——第一个 owner 合并后 main 前进，后续 owner 分支基于旧 main，与 main 分叉，ff-only 会失败。故用 `--no-ff` 合并（生成合并提交，清晰标明每个 owner 批次）。冲突才说明 scope 漂移，停下排查。

`owner-merge.mjs`：先 `scope-check merge` 校验 → 逐个 `--no-ff` 合并。已联调验证（两个不相交 owner 分支成功合并，越界改动被检出）。

## 10. Submodule 级联（阶段3，待验证）

- 仓库分层自洽：每个 git 仓库跑自己的 owner/scope/hook 模型。
- 唯一 main 跨层直管。
- submodule owner worktree 由 main 显式 `git -C <submodule> worktree add` 预建（CC 只给主仓库建）。
- 每个 owner subagent 只在自己单一 worktree 内干活，不跨仓库。
- **待验证**：CC subagent 的 cwd 能否引导到 main 预建 worktree（而非它自己建的主仓库 worktree）。
- gitlink 提交归 main 治理 scope；跨层校验验收状态就近存、递归读、信任传递。

## 11. 风险与已知口子

1. **`--no-verify` / Bash 越界**：靠合并前脚本兜底（teammate 非对抗性，主动绕过概率低）。
2. **CC worktree 跑完自动清理**：untracked 残留时可能留下，main 偶尔需 `git worktree prune`。
3. **subagent Bash 环境无 `CLAUDE_PROJECT_DIR`**：place-binding.sh 已用 `git rev-parse`，不依赖该变量。
4. **submodule 跨仓库 cwd 引导**：阶段3 验证。
