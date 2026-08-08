# Ghost Agent Workflow — CC Agent Team Context

在 Claude Code 原生 agent team 上实现「owner 绑定 + worktree 并行 + 两层 hook 隔离」的协作模式。核心是靠 owner 的 write scope 两两不相交，从架构上保证零冲突。

## Language

**Owner**:
一个领域负责人，绑定两件事：负责的功能领域，与一个可写文件集合（write scope）。owner 不是角色描述，是约束的载体。
_Avoid_: 角色、成员（这些是 teammate 概念，见下）

**Write scope（scope）**:
一个 owner 被允许**写/改/删**的文件路径集合。只约束写，**不约束读**——owner 可读全仓做上下文。读别人的接口/类型来对接属于正常跨模块协作，不算越界。
_Avoid_: 可访问范围、access scope（本设计不引入读约束）

**Teammate**:
CC agent team 里的一次性 subagent 实例，由 `Agent` spawn。一个 teammate 绑定一个 owner（注入 owner 指令 + 该 owner 的 scope 约束）。teammate 跑完即销毁，无持久身份；连续性靠状态外置。
_Avoid_: 持久线程、长期成员（CC 无此能力）

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
