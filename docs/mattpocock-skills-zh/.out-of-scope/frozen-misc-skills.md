# 修改 `misc/` skills

`skills/misc/` 中的 skills（`git-guardrails-claude-code`、`migrate-to-shoehorn`、`scaffold-exercises`、`setup-pre-commit`，以及以后进入这里的内容）已冻结。针对它们的缺陷报告、功能请求和 PR 会关闭。

## 不属于维护范围的原因

`misc/` 存放我保留却很少使用的 skills。它们没有正式发布：不进入 Claude Code 插件，没有文档页面。我日常不用它们，所以无法判断修复是否正确，也无法察觉某个修复何时破坏了其他内容。按正式发布 skills 的标准维护它们，需要相同的成本，却只有很少的使用量。

它们保留在仓库中、不再维护，是因为有些人按原样使用仍然有效。若某个 skill 不适合你，通过 skills.sh 安装并修复自己的副本。文件由你编辑。

以后某个 `misc/` skill 若重新进入 `engineering/` 或 `productivity/`，从那时起便重新属于维护范围。

## 既往请求

- #14：“setup-pre-commit/SKILL.md 可能有拼写错误”。
- #301：“任意 Git 全局选项都能绕过 `block-dangerous-git.sh`，例如 `git -C <dir> push`”。
- #465：“git-guardrails-claude-code 文档没有说明相比 Claude Code 内置 deny 规则的优势”。
- #898：“git-guardrails-claude-code：缺少 jq 时 hook 放行，且遗漏常见 Git 写法”。
