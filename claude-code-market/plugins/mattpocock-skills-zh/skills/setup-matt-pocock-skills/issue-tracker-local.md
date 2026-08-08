# Issue 跟踪器：本地 Markdown

当前仓库的 issue 和规格以 Markdown 文件保存在 `.scratch/` 中。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格位于 `.scratch/<feature-slug>/spec.md`。
- 每张实现工单对应一个 `.scratch/<feature-slug>/issues/<NN>-<slug>.md` 文件，从 `01` 开始编号；绝不合并到单个工单文件。
- 分类状态记录在 issue 文件顶部附近的 `Status:` 行，角色字符串见 `triage-labels.md`。
- 评论和对话历史追加到文件底部的 `## Comments` 标题下。

## Skill 要求“发布到 issue 跟踪器”时

在 `.scratch/<feature-slug>/` 下创建新文件，必要时创建目录。

## Skill 要求“获取相关工单”时

读取引用路径处的文件。用户通常会直接传入路径或 issue 编号。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一个文件，每张工单对应一个**子文件**。

- **地图**：`.scratch/<effort>/map.md`，正文包含 Notes / Decisions-so-far / Fog。
- **子工单**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文写问题。`Type:` 行记录工单类型（`research`/`prototype`/`grilling`/`task`），`Status:` 行记录 `claimed`/`resolved`。
- **阻塞**：顶部附近使用 `Blocked by: NN, NN` 行。列出的所有文件均为 `resolved` 时，工单解除阻塞。
- **前沿**：扫描 `.scratch/<effort>/issues/` 中开放、未阻塞且未认领的文件，编号最小者优先。
- **认领**：开始任何工作前设置 `Status: claimed` 并保存。
- **解决**：在 `## Answer` 标题下追加答案，设置 `Status: resolved`，再把上下文指针（摘要 + 链接）追加到 `map.md` 的 Decisions-so-far。
