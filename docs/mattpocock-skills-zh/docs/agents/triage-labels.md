# 分诊标签

Skills 使用五个标准分诊角色。这个文件把角色映射到本仓库问题跟踪器中的实际标签字符串。

| mattpocock/skills 中的标签 | 我们跟踪器中的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要评估这个 issue |
| `needs-info` | `needs-info` | 等待报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 规格完整，可以交给无人值守的代理 |
| `ready-for-human` | `ready-for-human` | 需要人类实施 |
| `wontfix` | `wontfix` | 不会执行 |

Skill 提到某个角色时，例如“添加可交给无人值守代理的分诊标签”，使用表中对应的标签字符串。

选择状态前，按 [`SCOPE.md`](../../SCOPE.md) 判断每个 issue。拒绝项以“not planned”关闭。
