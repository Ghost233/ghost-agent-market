# Ghost Agent Skills：Codex 试用版

用户要求先在 Codex 验证本轮流程，Claude Code / ZCode 保留旧版，验证通过后再同步。Matt 原版技能保持独立。

| 入口 | 职责 |
| --- | --- |
| `$ghost-matt-spec` | 规划与修订规格，明确模块合同和验收标准 |
| `$ghost-matt-ticket` | 拆解任务、依赖与并行边界 |
| `$ghost-matt-implement` | 当前分支共享工作区开发、整轮验收、批量修复 |
| `$ghost-matt-run-test` | 单独运行指定测试并分析，默认不修复 |
| `$ghost-matt-test-report` | 只读汇总已有测试证据，不重新测试 |

五个入口通过规格、工单及测试证据衔接，可从已有产物继续，不必重新开始。规格与工单沿用项目约定；未配置时使用 `docs/specs/<主题>/`。完整验收期间冻结候选，先收齐结果，再集中修复。

旧 Codex 入口 `ghost-implement-spec`、`ghos-matt-run-test`、`ghos-matt-test-report` 已由上述新入口替代，不保留会加载旧流程的别名。其他 Git 和功能知识技能保留。

每个技能目录自包含：必需规则位于自己的 `SKILL.md`，整轮测试等较长内容位于该技能的 `references/`，可单独复制使用，不引用插件根目录或兄弟技能的文件。运行测试仅在用户授权修复时加载修复参考。

更新安装后在新任务中调用这些入口。现有任务可能仍持有旧版技能上下文。
