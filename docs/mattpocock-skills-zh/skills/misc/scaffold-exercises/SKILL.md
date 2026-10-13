---
name: scaffold-exercises
description: 创建可通过 lint 的练习目录结构，包括章节、问题、解答和讲解。用户希望搭建练习目录、创建练习占位内容，或配置新课程章节时使用。
---

# 搭建练习目录

创建能通过 `pnpm ai-hero-cli internal lint` 的练习目录结构，然后用 `git commit` 提交。

## 目录命名

- **章节**：在 `exercises/` 中采用 `XX-section-name/`，例如 `01-retrieval-skill-building`。
- **练习**：在章节中采用 `XX.YY-exercise-name/`，例如 `01.03-retrieval-with-bm25`。
- 章节编号为 `XX`，练习编号为 `XX.YY`。
- 名称使用 dash-case，即小写、连字符分隔。

## 练习变体

每个练习至少需要以下一个子目录：

- `problem/`：学生工作区，含 TODO。
- `solution/`：参考实现。
- `explainer/`：概念材料，不含 TODO。

搭建占位内容时，默认使用 `explainer/`，除非计划另有要求。

## 必需文件

每个子目录（`problem/`、`solution/`、`explainer/`）都需要 `readme.md`，满足：

- **不为空**，必须有真实内容，只有一行标题也可以。
- 没有失效链接。

搭建占位内容时，创建含标题和说明的最小 readme：

```md
# 练习标题

说明放在这里
```

子目录有代码时，也需要 `main.ts`，多于 1 行。占位练习只包含 readme 也可以。

## 工作流

1. **解析计划**：提取章节名、练习名和变体类型。
2. **创建目录**：为每个路径执行 `mkdir -p`。
3. **创建占位 readmes**：每个变体文件夹一份带标题的 `readme.md`。
4. **运行 lint**：用 `pnpm ai-hero-cli internal lint` 验证。
5. **修复错误**：反复修复，直到 lint 通过。

## Lint 规则概述

Linter（`pnpm ai-hero-cli internal lint`）检查：

- 每个练习都有子目录（`problem/`、`solution/`、`explainer/`）。
- 至少存在 `problem/`、`explainer/` 或 `explainer.1/` 之一。
- 主要子目录中的 `readme.md` 存在且非空。
- 没有 `.gitkeep` 文件。
- 没有 `speaker-notes.md` 文件。
- Readmes 中没有失效链接。
- Readmes 中没有 `pnpm run exercise` 命令。
- 每个子目录都需要 `main.ts`，只包含 readme 时除外。

## 移动或重命名练习

重新编号或移动练习时：

1. 用 `git mv` 重命名目录，不用 `mv`，保留 Git 历史。
2. 更新数字前缀，保持顺序。
3. 移动后重新运行 lint。

例如：

```bash
git mv exercises/01-retrieval/01.03-embeddings exercises/01-retrieval/01.04-embeddings
```

## 示例：按计划创建占位内容

给定这样的计划：

```
章节 05：记忆 Skill 构建
- 05.01 记忆简介
- 05.02 短期记忆（explainer + problem + solution）
- 05.03 长期记忆
```

创建：

```bash
mkdir -p exercises/05-memory-skill-building/05.01-introduction-to-memory/explainer
mkdir -p exercises/05-memory-skill-building/05.02-short-term-memory/{explainer,problem,solution}
mkdir -p exercises/05-memory-skill-building/05.03-long-term-memory/explainer
```

随后创建 readme 占位内容：

```
exercises/05-memory-skill-building/05.01-introduction-to-memory/explainer/readme.md -> "# 记忆简介"
exercises/05-memory-skill-building/05.02-short-term-memory/explainer/readme.md -> "# 短期记忆"
exercises/05-memory-skill-building/05.02-short-term-memory/problem/readme.md -> "# 短期记忆"
exercises/05-memory-skill-building/05.02-short-term-memory/solution/readme.md -> "# 短期记忆"
exercises/05-memory-skill-building/05.03-long-term-memory/explainer/readme.md -> "# 长期记忆"
```
