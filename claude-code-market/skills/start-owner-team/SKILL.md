---
name: start-owner-team
description: 启动 owner subagent 编排模式——main 绑定 owner、为每个 owner spawn owner-worker subagent（各自 worktree 隔离）、按依赖图取层派活、验收后合并。用户要求"启动 owner team""按 owner 分工并行"或"用 owner 模式干活"时使用。
---

# 启动 Owner Subagent 编排

你是 main（协调者）。本 skill 指导你用 **owner subagent 编排模式**（非 agent team）完成工作。核心：owner 的 write scope 两两不相交保证零冲突；每个 owner 用一个 owner-worker subagent 在独立 worktree 里干活；你不写业务代码，只编排。

完整概念见 `CONTEXT.md`。本 skill 只讲执行步骤。

## 前置（一次性，幂等）

- `.claude/agents/owner-worker.md` 必须存在且已被 CC 加载（session 启动时若 `.claude/agents/` 首次创建需重启）。
- `.ghost-agent-workflow/hooks/enforce-scope.sh` + `place-binding.sh` 必须存在且可执行。
- 这三项已随本插件提供，正常安装即就位。

## Phase 0：范围确认（不提前 spawn）

1. 问候用户，说明你是协调者，会把任务组织成 owner 分工并行交付。
2. 扫描 `.ghost-agent-workflow/owners/*.md`，列出可用 owner（id + responsibility + scope）。
3. 用 AskUserQuestion 与用户确认：
   - 选哪些 owner 参与、各自的任务目标、范围边界。
   - 哪些 owner 间有硬依赖（A 要等 B 产出才能动）——用于依赖图。
4. **静态校验**：跑 `node claude-code-market/scripts/scope-check.mjs static <workspace>`。相交则停下，让用户调 owner 定义（调 scope 归属，不改代码）。
5. 用户确认前不 spawn、不建分支。

## 实例化

1. 为每个选中 owner 建分支 `ga/owner/<id>`（基于主分支 HEAD）：
   `git branch ga/owner/<id> <main-HEAD>`。分支名固定，跨多轮复用。
2. 把 owner 的 verified-base 初始化为主分支 HEAD，记到 `.ghost-agent-workflow/.runtime/team-state.json`：
   `{ "<owner-id>": {"verified_base": "<sha>", "worktree": null} }`。
3. TaskCreate 建任务板，记录每个 owner 的任务；硬依赖用 `blockedBy` 表达。

## 派活（依赖图取层，1:1:1 串行）

依赖关系靠你（main）按用户在 Phase 0 声明的硬依赖 + 任务板 `blockedBy` 推进。无依赖的 owner 互相独立，可并行 spawn。

对每个要派的 owner：

1. **接手基线**：reset 该 owner 的 worktree 到 verified-base（首次无 worktree，靠 spawn 时 isolation:worktree 自动建；后续轮次，CC 给的 worktree 是新建的，天然基于默认分支——若需基于 verified-base，在 owner-worker prompt 里指示先 `git checkout ga/owner/<id>` 再 `git reset --hard <verified_base>`）。
2. **spawn owner-worker**（**不带 team_name**）：
   ```
   Agent(subagent_type="owner-worker",
        prompt="""
        你是 <owner-id>。
        第一步：投放 owner 绑定指针（必须最先做，否则任何写都会被 hook 拒）：
          sh <workspace>/.ghost-agent-workflow/hooks/place-binding.sh <owner-id>
        第二步：切换到你的分支并基于 verified-base：
          git checkout ga/owner/<id>
          git reset --hard <verified_base>
        然后执行任务：<任务描述 + 上下文（D 方案注入）>
        scope：<owner 的 scope 列表，提醒只能动这些路径>
        完成后汇报：改了哪些文件、是否自检通过。边做边阶段性提交。
        """)
   ```
3. **owner-worker 干活**：在自己的 worktree 内改文件（scope 外被 enforce-scope.sh deny）、阶段性提交到 `ga/owner/<id>`。
4. **交付**：owner-worker 跑完返回。它的文本汇报只作参考，**达标与否由你独立验收**。

## 验收与接手

1. **独立验收**：读 `ga/owner/<id>` 的 diff（`git diff <verified_base>..ga/owner/<id>`），按任务目标判定。scope 内若有测试，跑一次确认。
2. **验收通过**：更新 `.runtime/team-state.json` 里该 owner 的 `verified_base` 为 `ga/owner/<id>` 的 HEAD。
3. **验收不通过**：不更新 verified_base。下次派该 owner 时，worktree reset 回旧 verified_base（未验收的改动被清掉），在 prompt 里注入"上轮哪里不对、要怎么改"（D 方案）。teammate 没有"自证完成"的权力。
4. 重复派活直到验收通过。

## 合并

1. 所有参与 owner 验收通过后，合并前先校验：
   `node claude-code-market/scripts/scope-check.mjs merge <workspace> <main-HEAD> <owner1> <owner2> ...`
   （校验各 owner 分支 diff 全在各自 scope 内 + 跨 owner 实际改动不相交。失败则停下排查。）
2. 逐个快进合并：`git merge --ff-only ga/owner/<id>`。因 scope 不相交，理论无冲突；有冲突说明 scope 漂移，停下。
3. 合并完成，报告用户最终结果。

## 铁律

- **你不写业务代码**——产出一律派给 owner-worker。你只编排、验收、合并。
- **owner-worker 必须不带 team_name**（带 team_name worktree/hook 不生效，见 CONTEXT.md 可行性前提）。
- **spawn 后第一步必是 place-binding**（hook fail-closed，不投放任何写都被拒）。
- **验收不信 owner 文本汇报**，只认 git diff + 独立校验。
- **合并必经 scope-check merge**，不直接 `git merge`。
- 同一 owner 任意时刻只一个 owner-worker 在跑（1:1:1 串行）；并行来自不同 owner。
