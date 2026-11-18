# ADR 0001: 子仓库 Skill 发现（Subrepo Skill Discovery）

日期：2026-11-18
状态：已确认（grill-with-docs 第 1 轮后定稿）

## 背景

Home Repo（Ghost233HomeRepo）作为唯一工作入口后，会话 cwd 固定在 Home Repo 根目录。
DSH 原生只加载 cwd 自身的 .dsh/skills 与 .agents/skills，子仓库里的专有 skill
（如各仓库自己的 deploy-release）在 Home Repo 会话的 catalog 中不可见，
用户无法通过 "/" 菜单发现，只能手动读文件，发现性差。

Matt Pocock 的 Home Repo 模式要求 repo-specific skill 留在各仓库内，
因此需要一种"不搬运文件、让子仓库 skill 在 Home Repo 会话中可被发现"的机制。

## 决策

### D1 实现方式：动态 SkillProvider

在 dsh-ghost-home-repo 插件的 index.mjs 中，将静态 catalog 注册改为动态
SkillProvider：list({cwd}) 时现场扫描 cwd 一层子目录中的 skill 目录，
get() 时懒读 SKILL.md 原文。理由：provider 的 list 每次编目都执行，
扫描结果天然新鲜；get 懒加载使编辑零延迟生效。

### D2 命名：仓库名前缀 + 强制归一化

发现的 skill 以 "<repo前缀>-<原skill名>" 注册，例如
GhostCodexSentinel/.agents/skills/deploy-release → ghostcodexsentinel-deploy-release。

归一化规则（用户明示，不分词、不做驼峰拆分）：
1. 转小写
2. 删除所有非 [a-z] 非连字符字符（数字也删除，例：Ghost你好123 → ghost）
3. 合并连续连字符、去掉首尾连字符
4. 结果为空或与同会话其他前缀重复：跳过并在日志告警（first-wins）

### D3 显示名：无独立字段，用 description 前缀承载

DSH SkillSummary 只有 name/description/whenToUse，无 displayName 字段。
description 以 "[原仓库名] " 开头，菜单条目显示为：
ghostcodexsentinel-deploy-release — [GhostCodexSentinel] 发布该仓库到生产环境…

### D4 调用策略：modelInvocable + userInvocable 均开

用户明确选择允许模型自动路由调用仓库 skill。理由（用户）：子代理 cwd 到该
仓库后本来就能找到并执行这些 skill，Home Repo 层不额外设防。description 中
的仓库标签保证路由语义清晰。

### D5 扫描范围：.dsh/skills 与 .agents/skills 都扫，黑名单制

- 扫描 <cwd> 一层子目录下的 .dsh/skills/*/SKILL.md 与 .agents/skills/*/SKILL.md
- 跳过隐藏目录、*.worktrees（worktree 与主仓库内容重复）、node_modules
- 不采用白名单（不解析 AGENTS.md repo map）：skill 目录存在即意图明确，零配置
- 同一仓库同名 skill 同时存在于 .dsh 与 .agents 时：.dsh 优先（rank 150 < 250，
  与 DSH 原生 project-dsh=100 / project-agents=200 的相对顺序一致）

### D6 Home Repo 根目录 skill：不特殊处理

根目录 skill 由 DSH 原生 filesystem provider 加载（rank 100），本插件不介入。
无前缀名字永远属于根目录 skill，无前缀/有前缀的歧义不存在。

### D7 热更新：chokidar 监听 + control.invalidate()

list() 首次遇到某 cwd 时为其建立 chokidar 监听
（<cwd>/*/{.dsh,.agents}/skills/**），变更时调用 control.invalidate()。
新增/删除/编辑 skill 均无需重启 DSH（插件代码本身的改动仍需重启）。

## 后果

- Home Repo 会话 "/" 菜单可见所有子仓库 skill，可点名、可被模型路由
- 子代理 cwd 到具体仓库时，DSH 原生加载该仓库 skill（rank 100/200），
  与本 provider 不冲突（原生名字无前缀，provider 名字有前缀）
- 归一化后前缀冲突的仓库对会被跳过其一，需重命名仓库目录解决（可接受，
  14 个现有仓库无冲突）
