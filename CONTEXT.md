# Ghost Agent Workflow — CC Agent Team Context

在 Claude Code 原生能力上实现「owner 绑定 + worktree 并行 + hook 隔离」的协作模式。核心是靠 owner 的 write scope 两两不相交，从架构上保证**改动不重叠、合并无冲突**（多 owner 顺序合并用 `--no-ff`，产生合并提交，但不产生内容冲突）。

## 可行性前提（CC 能力阻断与选型）

**subagent 编排模式（非 agent team）**:
CC 当前（v2.1.224）有两个未修缺陷，使 **agent team 的 teammate 路径不可用**：
1. `Agent(isolation:"worktree")` 带 `team_name` 时 worktree **不生效**（teammate 跑主仓库目录，互相踩）—— issue #33045，open。
2. PreToolUse frontmatter hook 对 team teammate **不触发**（但对普通 subagent 触发）—— #42385/#45329。

故本模型走**普通 subagent 编排**：`Agent(isolation:"worktree")` **不带 team_name**。此路径文档保证 worktree 正常建 + hook 正常触发 + 有 agent_id。代价是放弃 team 身份/teammate 直连/team 任务板，由 main 自行维护派活状态——本模型本就规定 main 是唯一枢纽、成员不直连，**无损**。

**需求定位**：要的是"隔离 + 并行 + owner 绑定"的协作能力，不是 CC agent team 的 team 身份。故 subagent 编排完全满足。

> 以下概念中的"teammate"均指"绑 owner 的普通 subagent"，非 agent team teammate。

## 阶段0验证结论（已实测，CC v2.1.224）

以下均已用真实 spawn `owner-worker` subagent 实测通过，构成方案的可行性地基：

- ✅ **退路 A 可行**：frontmatter hook 对普通 subagent（不带 team_name）**触发**，deny 的 JSON 真阻断 Write。
- ✅ **cwd = worktree 根**：CC 把 subagent 的 cwd 锚定在 `.claude/worktrees/agent-<id>/`，身份反查链路成立。
- ✅ **hook 进程环境有 `CLAUDE_PROJECT_DIR`**（指向主仓库根），enforce-scope.sh 能用它找 owner 定义。
  - ⚠️ 但 **subagent 的 Bash 环境无 `CLAUDE_PROJECT_DIR`**（两套环境）。故 place-binding.sh（teammate 自投放）不依赖它，用 `git rev-parse --show-toplevel`。
- ✅ **绑定指针自投放可行**：teammate 首条指令跑 place-binding.sh 投放指针，hook 随后读到。投放前任何写被 fail-closed 拒绝，顺序天然保证。
- ✅ **scope 内放行 / scope 外 deny / 无指针 fail-closed**：全过。
- ✅ **main 不走 frontmatter hook**（agent-scoped，只 owner-worker 会话内触发）。
- ✅ **CC worktree 跑完自动清理**（但 untracked 残留时可能留下，main 偶尔需 `git worktree prune`）。

**⚠️ 实测踩坑（CC v2.1.224，Coinhub_Online_Demo，2026-08）**：spawn 调用**必须显式传 `isolation="worktree"`**——CC **不读** agent frontmatter（`owner-worker.md`）里写的 `isolation: worktree`，只认 spawn 调用本身。`start-owner-team` skill 早期 spawn 模板漏了这参数，导致 12 个 owner 全传 `None` → 不建 worktree → 全挤主 checkout → `place-binding.sh` 的 `git rev-parse --show-toplevel` 对所有 owner 返回同一根目录 → 抢写同一份 `pointer.json` 互相覆盖 → hook 读到"最后一个 owner"身份几乎全误判放行（全程 0 deny）→ scope 隔离退化为自觉 → `git checkout`/`reset --hard`/`add -A` 互相踩踏。结论：spawn 模板和 SOP 防呆提醒都把 `isolation="worktree"` 列为必传，且规范层（本文）与执行层（skill 模板）必须一致，不能只在正文口头提及而代码块里漏写。

**投放时序方案（已定）**：CC 不提前告知 worktree 路径，绑定指针靠 **teammate 首条指令自投放**（owner-worker SOP 第一步）。不是 fragile workaround——hook fail-closed 保证 teammate 必须先投放才能干活。

## Language

**Owner**:
一个领域负责人，绑定两件事：负责的功能领域，与一个可写文件集合（write scope）。owner 不是角色描述，是约束的载体。
_Avoid_: 角色、成员（这些是 teammate 概念，见下）

**Write scope（scope）**:
一个 owner 被允许**写/改/删**的文件路径集合。只约束写，**不约束读**——owner 可读全仓做上下文。读别人的接口/类型来对接属于正常跨模块协作，不算越界。
_Avoid_: 可访问范围、access scope（本设计不引入读约束）

**Teammate**:
一个绑定了 owner 的**普通 subagent**实例，由 `Agent(isolation:"worktree")` spawn（**不带 `team_name`**）。注入 owner 指令 + 该 owner 的 scope 约束。跑完即销毁，无持久身份；连续性靠状态外置。
- **不是 CC agent team 的 teammate**（不走 `team_name`/`SendMessage`/team 任务板）——见下「subagent 编排模式」。
_Avoid_: 持久线程、长期成员、agent team teammate（CC 无持久 teammate 能力，且 team 模式下 worktree/hook 不生效）

**Scope 不相交原则**:
任意两个 owner 的 write scope 两两不相交；每个文件恰好属于一个 owner 的 scope（或尚无 owner）。这是零冲突与权限隔离的共同地基——数学上保证没有两个 owner 改同一文件。

**Scope 封闭语义**:
scope 以路径前缀声明（如 `payment/`）。owner 在自己前缀下**新建文件当下合法**（不阻塞开发），但事后必须回写 owner 定义补登记——新建文件要么被某 owner 认领，要么处于"无主"状态。scope 是"事实可写文件集"的声明，需与实际保持一致。

**Scope 冲突仲裁（上层职责）**:
当两个 owner 的 write scope 相交（声明了同一文件/路径），由上层（main）重新划分 scope 归属来消除相交——**调 owner 定义，不改代码**。owner 之间不自行争夺文件归属。

**Scope 相交检测（脚本化、确定性）**:
scope 两两是否相交，是**集合运算，由脚本判定**，不靠 LLM 猜测。实例化前脚本对所有选中 owner 的 scope 路径做两两相交检查，相交即 fail，不进入 spawn。

**无主文件（unclaimed file）**:
仓库中存在、但不在任何 owner write scope 内的文件。可被任意 owner 读；若要写，必须先被某 owner 认领（回写进其 scope）。

**新建文件约束（写前缀 = 声明 scope）**:
owner 只能在自己**已声明的 scope 前缀内**新建文件（层 B-1 hook 据此拦）。跨域新建（在别的 owner 目录或无主目录下建文件）不能直接做，必须先由上层（main）把该路径划进它的 scope、回写定义并重跑相交检测，之后才能建。这保证运行中不会产生未声明的新增文件，scope 漂移相交被源头挡住。

**动态相交检测（合并前）**:
实例化时的静态 scope 相交检测只覆盖启动瞬间的声明。合并前脚本再扫各 owner 分支的**实际 diff**，检测"实际改动文件集"是否相交——拦截运行中因新建/改动产生的漂移相交，作为最后一道闸。

**Owner 绑定指针（owner-binding pointer）**:
放在每个 owner worktree 内的一个运行时文件，**指向该 owner 的定义文件位置**（不直接存 owner 配置）。hook 从 `cwd`（= worktree 根）定位该指针，再顺指针读到 owner 定义拿 scope。解耦身份与配置：owner 定义改了，hook 通过指针总能读到最新版。
- 物化在 worktree 内 → 不依赖外部映射表写入时序，无竞态。
- 位于 `.ghost-agent-workflow/` 下（项目根 `.gitignore` 已忽略该目录）→ 天然不进 git，不污染提交。
- 命名避免与 git submodule 混淆，不用 "submodule-owner"，用明确的运行时目录名（如 `.runtime/owner-binding/`）。

**通用 owner-worker agent（owner 是数据，不是 agent 类型）**:
不做"每个 owner 一个 agent 定义"，而是**一个固定的通用 agent** `owner-worker`（放 `.claude/agents/owner-worker.md`，跟随 git，预建保证 session 启动时加载）。spawn 时 main 通过 prompt 注入 owner 参数（哪个 owner、绑定指针位置、任务）。owner 定义本身（scope、职责）是**数据**，存在 `.ghost-agent-workflow/owners/*.md`，由 main 读取后注入。
- 解决"首次建 `.claude/agents/` 需重启"——只有一个固定文件，预建后永久加载，加 owner 不动 agent 定义。
- owner 是数据：加 owner = 加个 `.ghost-agent-workflow/owners/<id>.md` 数据文件，main 读取即可，不污染 CC agent 列表，不工作流时静默存在。
- 代价：失去 CC subagent 自动委派（所有 owner 活都路由到同一个 owner-worker，必须 main 显式 spawn 注入 owner 参数）——本模型本就 main 显式编排（依赖图取层），不靠 CC 自动委派，**无损**。

**Owner 身份反查（hook 定位 owner 的方式）**:
层 B-1 hook 挂在通用 `owner-worker` agent 上，所有 spawn 都触发同一个 hook。hook 按「`cwd`（= worktree 根）→ worktree 内 owner 绑定指针 → owner 定义文件 → scope」的链路确定当前 owner 与 scope，不靠 `agent_id` 随机值或外部映射表竞态。这是 hook 可靠性的地基。

**Main（协调者）**:
CC 主会话，兼任 team 协调者。职责是 Phase 0 范围确认、实例化、派活、合并/清理，以及**上层协调 owner 定义**（调整 scope 归属消除相交）。
- **main 不写业务代码**——实际产出一律派给 owner-worker subagent。
- main 的写权限收窄到专属治理 scope：**仅 `.ghost-agent-workflow/` 内的治理文件**（owner 定义、team-state、配置）。由 main 的 SOP 约束（不靠 hook）。
- **main 天然不走 frontmatter hook**：frontmatter hook 是 agent-scoped，只在 owner-worker 会话内触发；main 不是 owner-worker，其写操作根本不经过 owner hook（阶段0组1已证实）。故 hook 无需写 main 分支——main 的治理 scope 约束靠 SOP，hook 只管 owner-worker subagent。

**无不受约束的写者（架构原则）**:
体系内**没有任何写操作游离在 scope 之外**——owner-worker subagent 受 owner scope（hook 强制），main 受治理 scope（SOP 约束，只写 `.ghost-agent-workflow/`）。不存在"靠身份全豁免"的写者。隔离边界对 owner subagent 由 hook 硬约束，对 main 由 SOP 约束。

**两段式 scope 校验**:
scope/相交校验分布在两个时机，各管一个时间点，不重复：
1. **实例化时（静态）**：spawn 前脚本校验各 owner **声明的 scope** 两两不相交。
2. **合并前（动态）**：脚本扫各 owner 分支**累计 diff**，做相交检测 + scope 校验——抓运行中新建/改动造成的漂移相交，同时兜底 Bash 越界（teammate 用 sed/echo 改 scope 外文件，进分支历史后由这里检出）。
- 越界改动会进入 owner 分支历史，直到合并前才被拒——可接受，因为 reset 到 verified-base 会清掉未验收 commit。
- 合并是 main 专属动作，**必须经合并脚本**（先校验再 merge），不直接 `git merge`。

**Teammate 跨轮连续性（A+D）**:
CC 的 teammate 是一次性 subagent，跑完上下文即失。连续性靠两层维系，不靠"记忆"：
- **A（地基）：worktree 持久代码现状**。owner 的产出已提交在 owner 分支/worktree，跨多轮持久。新 teammate 接手时直接读代码现状继续——状态从易失内存（teammate 记忆）搬到持久磁盘（worktree）。
- **D（兜底）：main spawn 时注入上下文**。代码承载不了的连续性（复现步骤、待办、禁忌），由 main 在派活时写进新 teammate 的 prompt。main 是协调者，掌握全局进展，由它注入。

**Owner-Worktree-Teammate 基数（1:1:1 串行）**:
一个 owner 对应**恰好一个 worktree**、且任意时刻**至多一个活着的 teammate**。同 owner 的活排队串行——一个 teammate 跑完（或挂起）才 spawn 下一个。
- 为什么不能同 owner 并行多 teammate：它们会共享同一 worktree，未提交改动互相覆盖，worktree 要消灭的踩踏在同 owner 内复现。
- 并行性来自**不同 owner 之间**（payment-owner 与 auth-owner 各自一个 teammate 并行），不来自 owner 内部。
- 若某模块内部确需并行，正道是**拆成更细粒度的 owner**（各自独立 worktree + 不相交 scope），而非同 owner 多实例。
- 调度实现：main 维护每 owner 是否有 in-progress teammate（可复用任务板），未结束前不 spawn 同 owner 新 teammate。

**调度状态分工（C：TaskCreate + JSON 混合）**:
退路 A 下无 team 任务板，main 的状态分两处存，各管不重叠的部分：
- **TaskCreate（短期、易失）**：管"这次的活"（subject/description）、in-progress 判断（有该 owner 的 in_progress 任务 = 忙，用于 1:1:1 串行）。任务跑完即结。
- **JSON 持久态（跨会话）**：管 TaskCreate 存不了的持久值——每 owner 的 `verified_base` commit、`worktree` 路径映射。放 `.ghost-agent-workflow/.runtime/team-state.json`，不进 git。
- in-progress/阶段**只在 TaskCreate**，不冗余进 JSON（避免两处状态不一致）。JSON 只存持久基准与映射。

**依赖图（外置脚本生成，main 动态取层执行）**:
owner 间的任务依赖**不用 CC 任务板的 `blocks/blockedBy` 表达**，而由**外置脚本维护一个依赖图**（参考 codex `goal-dag.mjs` 的模型：task 带 `depends_on`，脚本算 ready、投影下一层）。main 不判断依赖，只从脚本投影的"当前可执行的一层"里取 owner 派活。
- 依赖图的生成、ready 计算、分层投影**全是脚本做**（确定性，不靠 LLM 猜）——与"scope 相交检测脚本化"同原则。
- main 每次：调脚本拿"当前 ready 的一层" → 对其中各 owner spawn（不同 owner 可并行，1:1:1 允许）→ 等它们验收完 → 再调脚本拿下一层（依赖完成的解锁）→ 动态编排动态执行。
- **读依赖不进图**：owner 读别人代码（如 payment 读 auth 接口）随时能读，不建依赖、不阻塞。只有"等对方产出才能动"的**写依赖**（hard dependency）才进图。
- 设计倾向：划 owner 时尽量让接口契约有明确归属（一个 owner 拥有，别人只读），从根上减少跨 owner 硬依赖。真正需要"等"的才进依赖图。

**交付契约（A+C，存档≠验收）**:
teammate 完成工作后**自己提交到 owner 分支**（过层 B-2 scope 校验）。但**提交只是存档**（留痕、可回溯），**不等于验收通过**。main 不信 teammate 的文本自我汇报，只认 git 事实 + 独立验收：
- **A（存档）**：交付物 = owner 分支上的 commit。teammate 跑完即提交，确保改动落盘不丢。teammate 的文本返回（"改了啥、为啥"）降级为给 main 注入下一个 teammate 上下文（D 方案）的材料，不作交付凭证。
- **C（验收）**：main 凭 git diff + 独立验收脚本判定是否达标——owner scope 内若有测试/lint，合并前由 main 跑一次确认；无验收手段时，靠 scope 校验 + 相交检测兜底。
- teammate 没有"自证完成"的权力——它只能存档（commit），达标与否由 main + 脚本判定。

**接手基线（每次 reset 到已验收点）**:
main 每次派 teammate 前，把 owner worktree 强制 `reset --hard` 到该 owner**上一次验收通过的 commit**（首次为主分支 HEAD）。未验收的改动（已提交未验收、未提交的脏改动、崩溃残留、被 hook 拒的残留）**一律清掉**。
- 这是"存档≠验收"的逻辑闭环：只有已验收的改动才配作为下次起点，未验收的无论提交与否都不算数。
- teammate 拿到的永远是干净、可信基线。要"接着上次没改完的改"，靠 main 注入上下文（D 方案）告知，而非靠残留脏文件。
- reset/merge 是 main 的合法 **git 元操作**（搬运/重置状态），不属"写业务代码"——main 仍不创作业务逻辑。
- 对 teammate 的配套要求：**边做边阶段性提交**（owner SOP 约束），而非全做完才提交一次——崩溃也只丢最后一小步。

## Submodule 级联（跨仓库分层）

**仓库分层自洽模型**:
scope 隔离按 **git 仓库边界分层**。每个 git 仓库（主仓库或 submodule）内部跑自己的一套 owner/scope/hook 模型——自己的 owner 定义、自己的 scope 不相交、自己的两层 hook。外层 owner 的 scope 不包含 submodule 内部路径（submodule 内部由 submodule 自己的 owner 体系管）。

**唯一 main（外层，跨层直管）**:
整个级联只有**一个 main**——最外层主仓库的 CC 主会话。submodule 是被引用的子目录，CC 不会在那里另起会话，故里层无独立 main。main 跨越仓库边界，直接进入各 submodule 层派 owner，同时是主仓库与所有 submodule 层的协调者。

**Submodule owner 的 worktree（main 预建，subagent 单一 worktree 自洽）**:
每个 owner subagent 只在**自己单一的 worktree 内**干活，不跨仓库、不操作别的 worktree——主仓库 owner 在主仓库 worktree，submodule owner 在 submodule worktree，各管各的，完全同构。
- 主仓库 owner worktree：由 CC `Agent(isolation:"worktree")` 自动建/清。
- submodule owner worktree：CC 只给主仓库建，故由 **main 显式用 `git -C <submodule> worktree add/remove` 预建**，subagent cd 进该 worktree 干活。
- **阶段3部分验证**：✅ main 能给 submodule 建 worktree；✅ subagent 能 `cd` 到主仓库 worktree 之外的 submodule worktree（未被 CC 拦）。⚠️ 未验证：cd 之后 Write/Edit 能否写、hook 触发时 cwd/CLAUDE_PROJECT_DIR 取值、hook 脚本能否被找到。这些依赖 CC 内部行为，建议由真实 submodule owner 需求驱动时再深挖，避免过度工程。

**Gitlink 提交（归 main 治理 scope）**:
submodule 改动是两段提交：① submodule 内部 owner 在 submodule worktree 提交（过 submodule 自己的层 B-2）；② 主仓库提交 gitlink 指针更新。gitlink 不属于任何 owner 的业务 scope，但归入 **main 治理 scope**（`.ghost-agent-workflow/` + 所有 submodule gitlink）——它是仓库级依赖版本管理，属治理而非业务创作。submodule 内部 owner 验收通过后，由 **main 在主仓库执行 gitlink 提交**。

**跨层校验（验收状态就近存、递归读、信任传递）**:
- **就近存放**：每个仓库（主 + 各 submodule）在自己的 `.ghost-agent-workflow/` 记录本仓库各 owner 的 verified-base（上次验收通过的 commit）。验收状态不集中到外层，分层自洽。
- **递归读取**：外层合并前校验遇 gitlink，递归进对应 submodule 读其 verified-base，确认 gitlink 指向的 commit 是已验收点（或基于它）。是 → 放行；否 → 该 submodule 尚有未验收改动，拒绝外层合并。
- **信任传递**：submodule 内部的 scope/相交合规，由 submodule 自己的三段校验在内部提交时保证，外层不重跑——只验 gitlink 指向是否为已验收点。

**Submodule 内部合并（级联标准环节，与外层合并同构）**:
submodule owner 的产出在其 owner 分支上。验收通过后，main 须先在 submodule 仓库内部执行一次完整合并——把 owner 分支合并进 submodule 的主分支（`git -C <submodule> merge <owner-branch>`），让产出成为 submodule 主分支的稳定 commit。
- 这次合并与外层合并**完全同构**：走 submodule 层的合并前校验（递归）+ 合并提交（靠 `MERGE_HEAD` 放行）。
- **顺序硬约束**：必须先完成 submodule 内部合并（产出进 submodule 主分支），main 才能在主仓库提交 gitlink 指向那个稳定 commit。跳过这步直接提 gitlink，会指向 submodule 里未合并的悬空 owner 分支 commit。
- 合并是 main 专属动作，在所有层成立——submodule 内部合并也由 main 执行。
