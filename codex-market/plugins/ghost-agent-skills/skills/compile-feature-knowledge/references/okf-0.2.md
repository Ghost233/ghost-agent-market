# OKF 0.2 规范

OKF 是 `compile-feature-knowledge` 维护的功能知识库（bundle）文档格式。本文件是 OKF 0.2 的权威定义；`SKILL.md` 的「OKF 0.2」一节是执行摘要，内容冲突时以本文件为准。

## Bundle 结构

一个 OKF bundle 是一个目录，包含：

- `index.md`：bundle 根索引，保留文件名。
- `log.md`：变更日志，保留文件名。
- 每个功能一份档案文件；遵循所在仓库已有的目录约定，没有约定时位于 `features/<功能标识>.md`。

`index.md` 与 `log.md` 只承担索引和日志职责，不作为功能档案。子目录允许有自己的 `index.md`，但不带 frontmatter。

## 功能档案

### frontmatter

```yaml
---
type: Feature
title: 登录会话保持
description: 用户在客户端登录后会话的创建、续期与失效规则。
tags: [auth, session]
status: stable
sources:
  - id: session-store
    resource: ../../../src/session/store.ts
  - id: confirm-2026-09-05
    resource: 本次用户确认（2026-09-05）
generated:
  by: compile-feature-knowledge
  at: 2026-09-05T18:30:00+08:00
verified:
  by: ghost-agent
  at: 2026-09-05T18:40:00+08:00
  scope: 仅核对 session/store.ts 源码与其单元测试
stale_after: 2026-12-01
---
```

字段约定：

| 字段 | 必填 | 形状 | 语义 |
| --- | --- | --- | --- |
| `type` | 是 | 固定 `Feature` | 功能概念文档。 |
| `title` | 是 | 字符串 | 功能名称。 |
| `description` | 是 | 单句字符串 | 一句话说明功能是什么。 |
| `tags` | 否 | 字符串列表 | 检索标签。 |
| `status` | 是 | `draft` / `stable` / `deprecated` | 文档生命周期：首次整理 `draft`，可供消费 `stable`，保留历史 `deprecated`；不表示代码是否上线。 |
| `sources` | 否 | `{id, resource}` 列表 | 每条外部依据一项。`id` 稳定，发布后不改名；`resource` 必须真实可核对。 |
| `generated` | 是 | `{by, at}` | 最近一次实质修改的执行者与时间；`at` 用带时区的 ISO 8601。仅在实质修改时更新。 |
| `verified` | 否 | `{by, at, scope}` | 实际核验当前文档的人或过程；`scope` 如实说明核验覆盖范围，局部测试不能为全文背书。实质内容改变后移除不再适用的标记，重新核验后再添加。 |
| `stale_after` | 否 | `YYYY-MM-DD` | 只有存在真实复核期限时才填写。关联代码、合同或决策变化时重新检查文档。 |

### 正文与脚注归因

- 关键结论用 Markdown 脚注归因：正文写 `[^id]`，`id` 与对应 `sources` 条目的 `id` 同名。
- 文末为每个脚注写定义：`[^id]: 一句话说明依据，并复述 resource`。
- 脚注与 `sources` 一一对应：每个 `sources` 条目至少被一个脚注引用，每个脚注必须对应一个 `sources.id`。
- 只存在于对话或任务记忆的结论，`resource` 记录确认日期与「依据本次用户确认」，不伪造聊天链接。

### 资源路径解析

- 普通相对路径按当前文档所在目录解析。
- `/` 开头的路径按 bundle 根解析。
- 越过 bundle 根的相对路径（如指向同级检出的其他仓库）允许使用，但必须在该档案正文或 bundle 根 `index.md` 注明仓库布局前提；要求可移植时改用完整 URL，建议带提交锁定的永久链接。

## index.md

bundle 根 `index.md` 是唯一声明格式版本的文件：

```yaml
---
okf_version: "0.2"
title: <仓库或知识库名> 功能知识库
---
```

- `okf_version` 是字符串，仅 bundle 根 `index.md` 声明；功能档案、`log.md` 和子目录 `index.md` 都不声明版本。
- 正文是档案链接清单，使用指向档案的相对链接，可按主题分节；每个链接必须指向真实存在的文件，新增、移动或归档档案时同步更新。

## log.md

- 无 frontmatter，正文为倒序条目：新条目写在最上方。
- 条目格式：标题 `## <YYYY-MM-DD HH:mm±HH:MM> — <写入者>`，下接要点列表，写明新增、更新、核验或作废了哪些档案及一句话原因。

## 最小完整示例

`docs/knowledge/index.md`：

```markdown
---
okf_version: "0.2"
title: Demo 仓库功能知识库
---

## 功能档案

- [登录会话保持](features/login-session.md)
```

`docs/knowledge/features/login-session.md`：

```markdown
---
type: Feature
title: 登录会话保持
description: 用户登录后会话的创建、续期与失效规则。
status: draft
sources:
  - id: session-store
    resource: ../../../src/session/store.ts
generated:
  by: compile-feature-knowledge
  at: 2026-09-07T10:00:00+08:00
---

## 当前行为与关键约束

会话有效期 7 天，活动后滚动续期。[^session-store]

[^session-store]: 续期逻辑见会话存储实现（../../../src/session/store.ts）。
```

`docs/knowledge/log.md`：

```markdown
## 2026-09-07 10:00+08:00 — compile-feature-knowledge

- 新增《登录会话保持》：首次整理，依据会话存储源码，未核验。
```

## 完成前检查

1. 所有 frontmatter 可被 YAML 解析。
2. `sources.id` 与脚注一一对应。
3. 相对路径与 `/` 根路径都能解析到真实文件。
4. 受影响的索引链接正确。
5. `generated.at` 带时区；存在 `verified` 时 `scope` 如实描述覆盖范围。
6. `okf_version` 仅出现在 bundle 根 `index.md`。
7. `log.md` 新条目位于顶部。

格式正确只代表结构正确，不代表业务事实已核验。
