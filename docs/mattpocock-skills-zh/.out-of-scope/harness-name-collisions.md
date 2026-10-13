# 为避开代理运行环境的内置命令而给 skills 改名

代理运行环境提供同名的内置命令或 skill（`/prototype`、`/research`、`/code-review` 等），不会导致这里的 skill 改名。为避免冲突而要求改名或添加别名，不属于维护范围。

## 不属于维护范围的原因

代理运行环境不断增加内置功能，各自选择不同名称。每当某个环境采用我们已用的名称就改名，会迫使我们不断追赶 Claude Code、Copilot、Devin 等环境的变化，每次都打破用户的操作习惯，以及 skills 之间的所有交叉引用。

环境怎样解析两个同名对象，是该环境的行为，不属于 skill。无论采用哪种解析方式，skill 文本本身都正确。

解决办法是使用带命名空间的调用。Claude Code 插件以插件名称为每个 skill 提供命名空间，所以始终可明确调用我们的 skill：

```
/mattpocock-skills:research
/mattpocock-skills:code-review
```

通过 skills.sh 安装后，文件归你所有。可以在自己的副本中修改文件夹名和 `name:` 字段。

如果某个环境完全无法触达带命名空间或改名后的 skill，向该环境报告问题。

## 既往请求

- #423：“/code-review 遮蔽 Claude Code 自己的审查 skill”。
- #483：“/code-review 与 Claude Code 内置功能名称冲突”。
- #857：“给 research skill 改名，以避免与 Copilot 内置 /research 命令冲突”。
- #1019：“简写 `/prototype` 与 Claude Code 隐藏的新内置 skill `/prototype` 冲突”。
- #1037：“Skill 名称与 Devin CLI 内置命令重叠”。
