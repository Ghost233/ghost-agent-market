# 防止子代理递归调用 skills 的防护

Skills 不添加防止子代理递归调用 skills 或生成嵌套代理的防护，例如 `/code-review` 子代理再次调用 `/code-review`，或 `/research` 代理生成另一个代理。要求增加叶子代理指令、深度限制或“不要调用此 skill”的说明，不属于维护范围。

## 不属于维护范围的原因

停止子代理无限循环，应由代理运行环境负责，而非 skills。环境决定子代理能使用哪些工具和 skills，以及嵌套有多深，因此环境设置的限制可同时适用于全部 skills。写在一个 skill 说明中的防护只覆盖这个 skill，每次运行都消耗 tokens，仍依赖模型选择遵守。

子代理无界递归或分派时，向代理运行环境报告。

## 既往请求

- #530：“research skill：生成的后台代理能再次递归生成代理，嵌套不受控制”。
- #573：“code-review 子代理递归调用 /code-review 并继续分派”（PR #1186，“code-review：让 Standards 和 Spec 子代理成为叶子审查者”，已关闭）。
