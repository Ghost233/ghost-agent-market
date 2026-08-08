---
name: setup-matt-pocock-skills
description: 为当前仓库配置工程类 skills，包括 issue 跟踪器、分类标签词汇和领域文档布局。在首次使用其他工程类 skill 前运行一次。
disable-model-invocation: true
---

# 设置 Matt Pocock Skills

创建工程类 skills 所依赖的仓库级配置：

- **Issue 跟踪器**：issue 存放位置，默认 GitHub，也原生支持本地 Markdown。
- **分类标签**：五种规范分类角色实际使用的字符串。
- **领域文档**：`CONTEXT.md` 和 ADR 的位置，以及读取它们的规则。

这是提示驱动的 skill，不是确定性脚本。先探索，再展示发现，与用户确认后才写入。

## 流程

### 1. 探索

检查当前仓库的初始状态。读取实际存在的内容，不作假设：

- `git remote -v` 和 `.git/config`：是否为 GitHub 仓库？具体是哪一个？
- 仓库根目录的 `AGENTS.md` 和 `CLAUDE.md`：是否存在？是否已有 `## Agent skills` 章节？
- 根目录的 `CONTEXT.md` 和 `CONTEXT-MAP.md`。
- `docs/adr/` 以及所有 `src/*/docs/adr/` 目录。
- `docs/agents/`：本 skill 以前是否已经生成过配置？
- `.scratch/`：是否已有本地 Markdown issue 跟踪约定。
- 是否安装 `triage` skill（本目录旁存在 `triage` skill 文件夹，或可用 skills 中包含它）。这决定是否执行 B 部分。
- Monorepo 信号：`pnpm-workspace.yaml`、`package.json` 的 `workspaces` 字段，或拥有自身 `src/` 的非空 `packages/*`。只有真正的大型多包仓库才选择多上下文；缺少这些信号就按单上下文处理，绝大多数仓库如此。

### 2. 展示发现并询问

总结现有内容和缺失内容。随后按顺序逐节处理：每次只问一节，获得答案后再进入下一节。

每节先给出推荐答案，让用户可以用一个词接受。只有选项确实产生分支时才给一行说明；探索结果已经确定时跳过该节，例如未安装 `triage` 时跳过 B，非 monorepo 时跳过 C 的询问。

**A 部分——Issue 跟踪器。**

> 说明：“issue 跟踪器”是当前仓库保存 issue 的位置。`to-tickets`、`triage` 和 `to-spec` 等 skill 会读写它，因此需要知道应调用 `gh issue create`、在 `.scratch/` 下写 Markdown，还是遵循你描述的其他流程。选择你实际追踪该仓库工作的地方。

默认情况下这些 skills 面向 GitHub 设计。`git remote` 指向 GitHub 时推荐 GitHub；指向 GitLab（`gitlab.com` 或自托管实例）时推荐 GitLab。否则，或用户另有偏好时，提供：

- **GitHub**：issue 保存在仓库的 GitHub Issues，使用 `gh` CLI。
- **GitLab**：issue 保存在仓库的 GitLab Issues，使用 [`glab`](https://gitlab.com/gitlab-org/cli) CLI。
- **本地 Markdown**：issue 作为文件保存在仓库 `.scratch/<feature>/` 下，适合个人项目或没有 remote 的仓库。
- **其他**（Jira、Linear 等）：请用户用一个段落描述流程，本 skill 以自由文本记录。

将选择记录到 `docs/agents/issue-tracker.md`。GitHub 和 GitLab 模板包含“把 PR/MR 作为请求入口”的标志，默认**关闭**。保持关闭，也不要主动询问；需要把外部 PR/MR 加入分类队列的用户以后可直接修改文件。

**B 部分——分类标签词汇。** 未安装 `triage` skill 时完全跳过；未安装的 skill 不需要标签。

如果已安装，只问一个问题：

> 是否保留默认分类标签？（推荐：**是**）

默认值是五个规范角色，标签字符串与角色同名：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。回答**是**时原样写入。只有用户回答否时才收集覆盖值，通常是跟踪器已有其他名称，例如用 `bug:triage` 表示 `needs-triage`；这样 `triage` 会应用现有标签，而不是创建重复标签。

**C 部分——领域文档。** 默认使用**单上下文**：仓库根目录一个 `CONTEXT.md` 加 `docs/adr/`。这适合几乎所有仓库，无需询问直接写入。

只有探索发现 monorepo 信号时才提供**多上下文**：根目录 `CONTEXT-MAP.md` 指向各上下文自己的 `CONTEXT.md`。然后确认用户选择哪种布局。

### 3. 确认并编辑

向用户展示以下草稿：

- 将添加到 `CLAUDE.md` 或 `AGENTS.md` 的 `## Agent skills` 区块（选择规则见步骤 4）。
- `docs/agents/issue-tracker.md`、`docs/agents/domain.md` 和 `docs/agents/triage-labels.md` 的内容；最后一份仅在安装 `triage` 时展示。

写入前允许用户修改。

### 4. 写入

**选择要编辑的文件：**

- 如果 `CLAUDE.md` 存在，编辑它。
- 否则，如果 `AGENTS.md` 存在，编辑它。
- 两者都不存在时，询问用户要创建哪一个，不代替用户选择。

`CLAUDE.md` 已存在时绝不创建 `AGENTS.md`，反之亦然；始终编辑已有文件。

选定文件已包含 `## Agent skills` 区块时，就地更新内容，不追加重复区块。不要覆盖周边章节中的用户编辑。

区块模板：

```markdown
## Agent skills

### Issue 跟踪器

[用一行总结 issue 在哪里追踪]。参见 `docs/agents/issue-tracker.md`。

### 分类标签

[用一行总结标签词汇]。参见 `docs/agents/triage-labels.md`。

### 领域文档

[用一行总结布局：“单上下文”或“多上下文”]。参见 `docs/agents/domain.md`。
```

只有安装了 `triage` 且执行过 B 部分时，才包含 `### 分类标签` 子区块并写入 `docs/agents/triage-labels.md`；否则两者均省略。

随后以本 skill 目录中的种子模板为起点写入文档：

- [issue-tracker-github.md](./issue-tracker-github.md)：GitHub issue 跟踪器。
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md)：GitLab issue 跟踪器。
- [issue-tracker-local.md](./issue-tracker-local.md)：本地 Markdown issue 跟踪器。
- [triage-labels.md](./triage-labels.md)：标签映射，仅在安装 `triage` 时使用。
- [domain.md](./domain.md)：领域文档读取规则与布局。

选择“其他”issue 跟踪器时，根据用户描述从头编写 `docs/agents/issue-tracker.md`。

### 5. 完成

告诉用户设置已完成，并说明哪些工程类 skills 会读取这些文件。说明以后可以直接编辑 `docs/agents/*.md`；只有切换 issue 跟踪器或从头重新设置时才需要再次运行本 skill。
