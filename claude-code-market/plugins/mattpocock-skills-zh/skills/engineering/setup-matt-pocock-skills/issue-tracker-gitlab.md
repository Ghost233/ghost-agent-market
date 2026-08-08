# Issue 跟踪器：GitLab

当前仓库的 issue 和规格保存在 GitLab Issues 中。所有操作使用 [`glab`](https://gitlab.com/gitlab-org/cli) CLI。

## 约定

- **创建 issue**：`glab issue create --title "..." --description "..."`。多行描述使用 heredoc；传入 `--description -` 可打开编辑器。
- **读取 issue**：`glab issue view <number> --comments`。机器可读输出使用 `-F json`。
- **列出 issue**：`glab issue list -F json`，按需添加 `--label` 过滤。
- **评论 issue**：`glab issue note <number> --message "..."`。GitLab 把评论称为 note。
- **添加/移除标签**：`glab issue update <number> --label "..."` / `--unlabel "..."`。多个标签可用逗号分隔，或重复传入 flag。
- **关闭**：`glab issue close <number>`。该命令不接受关闭评论，因此先用 `glab issue note <number> --message "..."` 发布说明，再关闭。
- **Merge request**：GitLab 把 PR 称为 merge request。使用 `glab mr create`、`glab mr view`、`glab mr note` 等；结构与 `gh pr ...` 相同，把 `pr` 换成 `mr`，把 `comment`/`--body` 换成 `note`/`--message`。

从 `git remote -v` 推断仓库；在 clone 内运行时 `glab` 会自动完成。

## 把 Merge Request 作为分类入口

**把 MR 作为请求入口：no。** _（如果当前仓库把外部 MR 视为功能请求，改为 `yes`；`/triage` 会读取此标志。）_

设为 `yes` 时，MR 使用与 issue 相同的标签和状态，并改用对应的 `glab mr` 命令：

- **读取 MR**：`glab mr view <number> --comments`，并用 `glab mr diff <number>` 获取 diff。
- **列出待分类外部 MR**：`glab mr list -F json`，只保留作者不是项目成员或 owner 的 MR，即贡献者提交而非维护者正在进行的工作。
- **评论/标签/关闭**：`glab mr note`、`glab mr update --label`/`--unlabel`、`glab mr close`。

与 GitHub 不同，GitLab 分别为 issue 和 MR 编号；确认维护者所指入口后，`#42` 不存在歧义。

## Skill 要求“发布到 issue 跟踪器”时

创建 GitLab issue。

## Skill 要求“获取相关工单”时

运行 `glab issue view <number> --comments`。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一个 issue，**子 issue**作为工单。

- **地图**：带 `wayfinder:map` 标签的单个 issue，正文保存 Notes / Decisions-so-far / Fog。使用 `glab issue create --label wayfinder:map`。支持原生 epic 的 GitLab 层级也可用 epic 承载地图；带标签 issue 在所有层级都可用。
- **子工单**：正文顶部包含 `Part of #<map>`，标签为 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）的 issue。认领后把工单分配给主导开发者。
- **阻塞**：优先使用 GitLab **原生阻塞链接**，这是规范且 UI 可见的表示。通过 note 发布 `/blocked_by #<n>` quick action：`glab issue note <child> --message "/blocked_by #<blocker>"`。原生阻塞链接属于 Premium/Ultimate 功能；免费层级或不可用时，在描述顶部使用 `Blocked by: #<n>, #<n>`。所有阻塞项关闭后工单解除阻塞。
- **前沿查询**：运行 `glab issue list -F json` 并限定到地图子项，排除存在开放阻塞项——即通过 `glab api projects/:id/issues/:iid/links` 查到指向开放 issue 的原生 `blocked_by` 链接，或 `Blocked by` 行中的某个 issue 仍然开放——或已有 assignee 的工单；按地图顺序取第一个。
- **认领**：`glab issue update <n> --assignee @me`，这是会话第一次写操作。
- **解决**：运行 `glab issue note <n> --message "<answer>"`，再运行 `glab issue close <n>`，最后把上下文指针（摘要 + 链接）追加到地图的 Decisions-so-far。
