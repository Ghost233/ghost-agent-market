# 设计方案：Claude Code Agent Team + Owner 绑定 + 两层 Hook 隔离

> 状态：草案（待 review）
> 日期：2026-08-08
> 范围：仅 Claude Code 端。不复用 WorkBuddy / Codex 的运行时，仅参考其流程形态。

## 1. 目标与非目标

### 目标

在 Claude Code（以下简称 CC）**原生 agent team 能力**上，实现一套「team 启动 → 绑定 owner → 分离 worktree → 执行」的协作模式，核心是**完美的模块隔离**：

1. **team 启动时，主线程（main）要求绑定 owner** —— 成员不是空壳角色，而是绑定到具体的领域 owner。
2. **每个 owner teammate 绑定一个独立 worktree** —— 并行隔离，互不覆盖工作区。
3. **owner 只能改自己 scope 内的文件** —— 用**两层 hook** 强制，越界实时拦截 + 提交时兜底。

### 隔离设计原则（核心洞察）

owner 设计中**每个文件恰好一个 owner，scope 两两不相交**。因此：

- **零冲突是数学必然**：scope 不相交 → 没有两个 owner 改同一个文件 → 合并全是快进，无冲突。不靠工具"挡"出来，靠架构保证。
- **隔离要解决两层问题**：
  - 层 A「并行隔离」：各 owner 工作区不互相覆盖 → **worktree** 解决。
  - 层 B「权限隔离」：owner 只能改 scope 内文件 → **两层 hook** 解决。
- **worktree 不限权限**：worktree 隔离的是"工作目录/分支"，不是"文件权限"。owner 在自己 worktree 里仍能改别人的文件（改在自己分支上）。这层局限由 hook 补上。

### 非目标

- ❌ 不追求与 WorkBuddy / Codex 双端一致。
- ❌ 不复用 Codex 原生 Goal / 持久子线程 / 持久 teammate 概念。
- ❌ 第一版不做 Planner / Reviewer / Supervisor 等固定角色的完整复刻；先跑通「owner 绑定 + worktree + 两层 hook + 合并」主干。

## 2. 关键能力边界（CC 现状）

设计基于 CC 真实能力，不可绕过的事实：

| 能力 | CC 现状 | 对设计的影响 |
|---|---|---|
| team 组织 | `TaskCreate/TaskUpdate/TaskList/TaskGet` + `Agent(team_name)` | team 是逻辑概念，靠任务板维系 |
| teammate 生命周期 | `Agent` spawn 的 subagent **一次性**，跑完即结束 | 无持久 teammate；连续性靠状态外置 |
| teammate 间通信 | subagent 间**不能直连**，必须 main 中转 | main 是唯一协调枢纽 |
| 按名复用 teammate | 每次 `Agent` 都是新实例 | 「绑定关系」由 main 登记表记住 |
| `Agent(isolation:"worktree")` | CC 自动建 linked worktree，跑完自动清理 | **用于层 A 并行隔离** |
| `EnterWorktree` | 切当前 session 的 cwd | 适合 main 自己进 worktree，不适合多 teammate 并行 |
| PreToolUse hook | 在所有 subagent 触发，能 deny 工具调用，拿到 `agent_id`/`cwd`/`tool_input` | **层 B-1 权限拦截的基础** |
| subagent frontmatter hook | hook 写进 owner agent 定义，仅对该 owner 生效 | owner 各自的 scope 约束，干净不串 |
| git pre-commit hook | linked worktree 共享主仓库 hooks | **层 B-2 提交兜底的基础** |

### 核心决定

> **隔离 = CC 托管 worktree（层 A）+ 两层 hook（层 B）。不采用 sparse-checkout，不采用沙盒。**

理由（详见 §5 已评估方案）：
- sparse-checkout 物理裁剪需放弃 CC 托管 worktree、自建 worktree + 一套建删脚本，代价大；且 scope 不相交下，hook 已等价覆盖"越界不可写"。
- 沙盒（Firecracker/Bubblewrap/Docker）解决的是进程/网络/跨租户安全威胁，本场景不存在；且 macOS 上多数沙盒方案不可用。

## 3. 核心概念定义

### 3.1 owner = 功能绑定 + 文件可操作范围绑定

owner 不是「角色描述」，而是两条硬约束的载体：

| 维度 | 含义 | 作用 |
|---|---|---|
| **功能绑定** | 该 owner 负责的领域 / 任务类型 | main 据此派活 |
| **文件可操作范围（scope）绑定** | 该 owner **只能动哪些路径** | hook 校验依据 |

**scope 不相交原则**：任意两个 owner 的 scope 两两不相交。每个文件恰好属于一个 owner（或尚无 owner）。这是零冲突与权限隔离的共同地基。

### 3.2 owner 定义位置：`.ghost-agent-workflow/owners/`

沿用现有 `setup-sub-thread-workflow` skill 已管理的目录（其 `.gitignore` 已保留 `owners/**`）：

```
<项目>/.ghost-agent-workflow/owners/<owner 名>.md
```

跟随项目 git 版本化，对其他项目零影响。

### 3.3 main / lead

CC 主会话兼任协调者。职责：

- Phase 0：与用户确认范围 + 选定 owner + **校验选中的 owner scope 两两不相交**。
- 实例化：spawn owner teammate（CC 托管 worktree + 注入 frontmatter hook）。
- 派活：通过任务板调度。
- 合并/清理：合并各 owner 分支回主分支，清 worktree。

## 4. owner 定义格式

```markdown
---
name: payment-owner
description: 负责支付领域相关决策与产出
displayName:
  zh: 支付负责人
# 文件可操作范围：路径模式列表，两两 owner 不相交
# 支持目录、单文件、跨多目录任意组合
scope:
  - payment/              # 整个目录
  - shared/types.ts       # 单个文件（注意：会与其他 owner 的 scope 构成相交，需避免）
  - config/payment.yaml   # 跨目录的指定文件
maxTurns: 120
---

# 支付负责人

（正文：工作范围、输入、工作流、不应做。spawn 时作为 teammate 指令注入。）
```

### scope 字段语义

`scope` 是路径模式数组，供两层 hook 匹配。三种粒度全部支持：

| 需求 | 写法 | 效果 |
|---|---|---|
| 指定文件夹 | `payment/` | 该目录下所有文件 |
| 指定文件 | `shared/types.ts` | 仅该文件 |
| 跨多个目录 | 上面两种任意组合 | 任意路径集合 |

> 第一版优先精确路径 + 目录前缀匹配，暂不引入 `*` glob，降低匹配歧义。

## 5. 隔离栈：两层 hook（本方案核心）

### 5.1 总览

```
owner teammate（在 CC 托管 worktree 里）
  │
  ├─【层 A】worktree（CC isolation:"worktree" 自动托管）
  │     给：独立工作目录 + 独立分支 → 并行不互相覆盖、合并零冲突
  │     不给：挡不住在本分支内乱改别人的文件 ← 局限，由层 B 补
  │
  ├─【层 B-1】PreToolUse hook（工具层，实时拦截）
  │     Edit/Write/MultiEdit → 读 cwd + file_path，scope 外 deny
  │     给：干活时秒拦，owner 根本写不进 scope 外文件
  │     漏：Bash（sed/echo/脚本）改文件拦不住 ← 由层 B-2 兜
  │
  └─【层 B-2】git pre-commit hook（提交层，兜底）
        git commit → 校验 staged diff 全在 scope 内，越界拒绝
        给：不管 owner 用什么手段写文件（含 Bash 绕过），
            想进 git 历史就必须过 scope 校验
```

两层 B 互补：

| 威胁 | 层 B-1 PreToolUse | 层 B-2 git hook |
|---|---|---|
| `Edit`/`Write`/`MultiEdit` 改 scope 外 | ✅ 秒拦 | ✅ 也拦（双保险）|
| `Bash(sed/echo > )` 绕过 | ❌ matcher 挡不住 | ✅ **专为此存在** |
| 外部脚本/任意手段写文件 | ❌ | ✅ 提交时验总 diff |

### 5.2 层 A：CC 托管 worktree

spawn owner teammate 时用 `Agent(isolation:"worktree")`：

- CC 自动创建 linked worktree，跑完自动清理。
- 提供"并行隔离"——各 owner 工作区独立，未提交改动不互相覆盖。
- **不依赖它做权限隔离**（那是 hook 的活）。

> 注：CC 托管 worktree 是全仓 checkout（非 sparse）。这意味着 owner 能看到所有文件，但**改不了 scope 外的**——因为 hook 拦。读不受限（owner 可读全仓做上下文，只限制写）。

### 5.3 层 B-1：PreToolUse hook（实时权限拦截）

挂在 owner agent 定义的 frontmatter，仅对该 owner 生效：

```yaml
# .ghost-agent-workflow/owners/payment-owner.md 的 frontmatter（或对应 agent 定义）
---
name: payment-owner
isolation: worktree
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit"
      hooks:
        - type: command
          command: "sh \"${CLAUDE_PROJECT_DIR}/.ghost-agent-workflow/hooks/enforce-scope.sh\""
---
```

hook 脚本逻辑（伪码）：

```bash
#!/bin/sh
# enforce-scope.sh
INPUT=$(cat)
FILE_PATH=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")
CWD=$(jq -r '.cwd // empty' <<<"$INPUT")          # = 当前 owner worktree 根
AGENT_ID=$(jq -r '.agent_id // empty' <<<"$INPUT") # 仅 subagent 内非空

# 仅在 subagent 内生效，不误伤 main
[ -z "$AGENT_ID" ] && exit 0

# 解析该 worktree 对应 owner 的 scope（从映射表查，见 §7）
SCOPE=$(resolve_owner_scope "$CWD")                 # payment/ config/payment.yaml ...

# 解析 FILE_PATH 相对 CWD 的路径，判断是否落在 scope 内
if file_in_scope "$FILE_PATH" "$CWD" "$SCOPE"; then
  exit 0                                            # 放行
else
  # 硬 deny，优先级最高，压过所有 allow 规则
  jq -nc --arg r "scope 越界：$FILE_PATH 不属于本 owner" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
fi
```

关键点：
- 用 `agent_id` 非空判断限定在 subagent 内，main 的编辑不受影响。
- 用 `cwd`（= worktree 根）锚定当前 owner，不硬编码路径，适应 CC 分配的任意 worktree 路径。
- 返回结构化 `deny`，优先级高于 allow，在权限规则评估前拦下。

### 5.4 层 B-2：git pre-commit hook（提交兜底）

git linked worktree 默认共享主仓库的 hooks 目录，故 hook **装在主仓库 `.git/hooks/pre-commit` 一处**，所有 owner worktree 的提交都经过它。

```bash
#!/bin/sh
# .git/hooks/pre-commit（由 setup 脚本安装，见 §9）
CHANGED=$(git diff --cached --name-only)            # 本次暂存的文件
OWNER=$(resolve_owner_by_worktree "$(pwd)")          # 当前 worktree 属于哪个 owner
SCOPE=$(read_owner_scope "$OWNER")                   # 读该 owner scope

for f in $CHANGED; do
  if ! file_in_scope "$f" "$SCOPE"; then
    echo "❌ 越界拒绝：$f 不属于 owner $OWNER 的 scope" >&2
    echo "   已拒绝提交。请 git reset 该改动并交给对应 owner。" >&2
    exit 1
  fi
done
exit 0
```

关键点：
- 校验 `git diff --cached --name-only` 的文件列表——**git 已知改了哪些文件**，比解析 shell 命令可靠得多。
- 通过 `pwd`/worktree 路径反查 owner，复用层 B-1 的 scope 解析逻辑。
- exit 1 拒绝提交，owner 只能 reset 越界改动重做。

> **已知口子**：`git commit --no-verify` 可跳过本 hook。第一版不额外防御（owner 非对抗性 agent，主动绕过概率低）；若需封死，在层 B-1 加 Bash matcher deny 掉 `--no-verify`，或合并主干时再做一次 scope 校验。

### 5.5 已评估但不采用的方案

| 方案 | 不采用理由 |
|---|---|
| **sparse-checkout 物理裁剪** | 需放弃 CC 托管 worktree + 自建 worktree 建删脚本；scope 不相交下 hook 已等价覆盖"越界不可写"。唯一额外优势（挡 Bash 子进程写）由层 B-2 git hook 覆盖。 |
| **沙盒（Firecracker/Bubblewrap/gVisor）** | 解决进程/网络/跨租户安全威胁，本场景不存在；macOS 上 Firecracker 无 KVM、Bubblewrap/Landlock Linux-only，均不可用。 |
| **Docker 隔离** | Mac 上跑 VM 启动秒级，且隔离的是环境不是文件权限，对本目标无额外价值。 |

## 6. team 启动流程（main SOP）

```
Phase 0  范围确认（不提前 spawn）
  ├─ main 问候，说明自己是 team 协调者
  ├─ 扫描 .ghost-agent-workflow/owners/*.md，列出可用 owner（名称 + 功能 + scope）
  ├─ AskUserQuestion 与用户确认：选哪些 owner、任务目标、范围边界
  ├─ 【校验】选中 owner 的 scope 两两不相交；相交则报错让用户调整
  └─ 用户确认前不 spawn

实例化（用户确认后）
  ├─ 安装 git pre-commit hook 到主仓库 .git/hooks（一次性，幂等）
  ├─ 对每个选中 owner：spawn teammate
  │     Agent(name=<owner>, team_name=<team>, isolation:"worktree",
  │            subagent_type=<owner agent 定义>,
  │            prompt=owner 正文 + 任务上下文)
  │     # frontmatter 内置的 PreToolUse hook 自动生效（层 B-1）
  ├─ 登记到 .ghost-agent-workflow/teams/<team>.json
  │     （owner → worktree 路径 → 分支 → scope 映射，供两层 hook 反查 owner）
  └─ TaskCreate 建任务板，初始任务 pending

派活
  ├─ main 按 TaskList 取可用任务，spawn/复用对应 owner teammate
  ├─ teammate 在自己 worktree 干活：
  │     Edit/Write scope 外 → 层 B-1 秒拦
  │     Bash 改 scope 外 → 层 B-1 漏，但 git commit 时层 B-2 拦
  ├─ teammate SendMessage 回传 main
  └─ main 写回映射表 / TaskUpdate

合并/清理（见 §7）
```

## 7. DAG 与合并方案

### 7.1 依赖表达：用 CC 任务板，不另建 DAG 文件

CC `TaskCreate`/`TaskUpdate` 已支持 `blocks` / `blockedBy`。owner 间「A 的产出是 B 的输入」用任务依赖表达，main 按 `TaskList` 调度未 block 任务。**不需要独立 DAG 状态文件。**

相比现有 `goal-dag.mjs`（1.8 万行做调度 + sync/finish + supervisor），调度交给 CC 任务板，大幅瘦身。

### 7.2 合并：唯一真正需要脚本的环节

因 scope 不相交，合并理论上全是快进。合并脚本职责：

1. **scope 二次校验**：合并前再查 owner 分支 diff 全在 scope 内（封 `--no-verify` 口子的兜底）。
2. **快进合并**：把 owner 分支合并回主分支。
3. **异常处理**：若发现 scope 外改动（说明有人绕过），停止合并、保留现场、报 main。
4. **清理**：CC 托管 worktree 跑完自动清；分支由脚本清。

### 7.3 形态：一个轻量合并脚本

```text
node scripts/owner-merge.mjs merge   <team> <owner>   # scope 校验 + 快进合并 + 清分支
node scripts/owner-merge.mjs status  <team>            # 列各 owner 分支状态
```

百行级，只做 scope 校验 + git merge。`goal-dag.mjs` 的 owner-sync/owner-finish 思想保留（先同步再合并、冲突保留现场），实现全新且轻量。

## 8. 目录结构（运行态）

```
<项目>/
├─ .ghost-agent-workflow/
│  ├─ config.json                 # 已有（可保留或裁剪）
│  ├─ owners/                     # owner 定义（跟随 git）
│  │  └─ payment-owner.md
│  ├─ hooks/                      # 层 B-1 hook 脚本（跟随 git，可移植）
│  │  └─ enforce-scope.sh
│  ├─ teams/                      # 运行态（.gitignore 忽略）
│  │  └─ <team>.json              # owner → worktree 路径 → 分支 → scope 映射
│  └─ （CC 托管 worktree 在 .claude/worktrees/，由 CC 管理，不在此处）
├─ .git/hooks/pre-commit          # 层 B-2 hook（setup 脚本安装，不进 git）
└─ （主工作区，main 所在）
```

`teams/` 属运行态，加入 `.ghost-agent-workflow/.gitignore`。

## 9. 需要新建 / 改造的产物

| 产物 | 动作 | 说明 |
|---|---|---|
| `.ghost-agent-workflow/owners/*.md` | 新建（示例） | owner 定义样板，含 scope + frontmatter hook |
| `.ghost-agent-workflow/hooks/enforce-scope.sh` | 新建 | 层 B-1：PreToolUse scope 拦截 |
| `scripts/install-precommit-hook.sh` | 新建 | 层 B-2：装主仓库 `.git/hooks/pre-commit`（幂等） |
| `scripts/owner-scope.mjs`（或并入现有脚本） | 新建 | 公共：按 worktree 路径反查 owner + scope，供两层 hook 共用 |
| `scripts/owner-merge.mjs` | 新建 | 合并 + scope 二次校验（§7.2） |
| team 启动 skill（CC） | 新建 | 指导 main 执行 §6 SOP |
| `setup-sub-thread-workflow` | 可能改造 | `.gitignore` 增加 `teams/` 忽略 |

> 现有 `goal-dag.mjs` **不复用**，走全新轻量脚本。是否归档由用户另定。

## 10. 风险与待验证点

1. **【高】frontmatter hook 的 CC 版本要求**：subagent frontmatter 挂 PreToolUse hook 需 CC v2.1.218+，且需 workspace trust。**落地前先确认本机 `claude --version`。** 退路：改用全局 `.claude/settings.json` 挂 hook + `agent_id`/`agent_type` 判断分流（能力更老版本就有）。
2. **【高】两层 hook 反查 owner 的映射可靠性**：层 B-1 用 `cwd`、层 B-2 用 `pwd` 反查 owner，依赖 `teams/<team>.json` 映射表准确。需在 spawn 后立即、原子地写入映射；worktree 路径必须是 CC 实际分配的真实路径。
3. **【中】CC 托管 worktree 的 hooks 共享行为**：linked worktree 默认共享主仓库 hooks 目录，但需实测 CC 创建的 worktree 确实是 linked（非独立 git 仓库），否则层 B-2 hook 不生效。
4. **【中】`--no-verify` 绕过口子**：第一版不防御；必要时层 B-1 加 Bash matcher 封堵，或主干合并再校验。
5. **【低】teammate 一次性上下文丢失**：每次 spawn 新实例无跨轮记忆，靠任务板 + 映射表 + worktree 持久文件承载连续性。
6. **【低】Bash hook 解析脆弱**：第一版不解析 Bash 命令（只靠层 B-2 git 校验兜底），避免 shell 命令解析的已知脆性。

## 11. 待用户拍板的开放问题

1. **DAG 形态**：§7「CC 任务板做依赖 + 轻量合并脚本」是否接受？还是需要独立 DAG / dashboard？
2. **scope 通配符**：第一版是否只支持精确路径 + 目录前缀，暂不支持 `*` glob？
3. **`goal-dag.mjs` 去留**：确认不复用后，归档还是保留备用？
4. **固定角色**：第一版纯 owner teammate，还是仍带轻量 reviewer/supervisor？
5. **hook 全局 vs frontmatter**：若 CC 版本不够新，是否接受改用全局 settings hook + agent_id 分流？

---

> 下一步：待用户对 §11 拍板后，进入实现计划（plan 模式），按 §9 产物清单逐步落地。建议第一个落地动作是最小验证：建一个 owner + scope，spawn 带 isolation:worktree 的 teammate，确认两层 hook 真能拦住越界写与越界提交。
