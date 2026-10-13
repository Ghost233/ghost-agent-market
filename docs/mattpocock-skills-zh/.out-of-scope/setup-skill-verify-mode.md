# `setup-matt-pocock-skills` 的验证或检查模式

本项目不会为 `setup-matt-pocock-skills` 添加专门的验证、检查模式，也不会增加独立的验证 skill。

## 不属于维护范围的原因

用第二个 skill 或 `--verify` 参数检查 `docs/agents/*.md` 产物是否仍符合初始化模板 schema，会重复已有 setup skill 在对话中已能完成的工作。

预期工作流是：**运行 `/setup-matt-pocock-skills`，要求它验证当前配置。** Skill 通过提示驱动，因此维护者可将其限定为一次验证，例如“不要重写任何内容，只将现有文件与当前初始化模板比较，并报告漂移”，无需独立代码路径。增加参数或同类 skill，会把自然语言入口已能表达的功能拆成多个界面。

由单个 skill 管理配置，也避免初始化模板演变时，两份 skills 相互偏离的维护成本。

## 既往请求

- #106：功能请求：为 setup-matt-pocock-skills 增加验证或检查模式。
