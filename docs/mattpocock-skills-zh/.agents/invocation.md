# 模型调用与用户调用

本仓库的每个 `SKILL.md` 都是一个 skill。划分它们的唯一维度是**调用方式**，即谁能触达它：

- **用户调用型**：**只有人类输入名称**才能触达。在 frontmatter 中设置 `disable-model-invocation: true`（Claude Code），在 `agents/openai.yaml` 中设置 `policy.allow_implicit_invocation: false`（Codex）。`description` **面向人类**，为浏览斜杠命令的用户提供一句摘要。删去触发条件列表，例如“用户说……时使用”。
- **模型调用型**：**模型或用户**均可触达。这是默认方式：省略 `disable-model-invocation`，以及 `agents/openai.yaml` 的 `policy` 块。`description` **面向模型**，保留丰富的触发条件，例如“用户想要……、提到……、要求……时使用”，让自动调用能触发。判断 skill 是否应该保持模型调用型的方法是：_模型自主使用它是否有帮助？_ 复用是提取 skill 的原因，不是这个判断标准。

各代理运行环境通过自己的方式，让用户调用型 skill 不在模型可触达范围内，因此只有人类能触发，其他 skill 也不能。用户调用型 skill 可以调用模型调用型 skill，但永远无法调用另一个用户调用型 skill。

每个 skill 的 `SKILL.md` 旁也都有 `agents/openai.yaml`。它保存 Codex UI 元数据：用于 skill 选择器的 `interface.display_name` 和 `interface.short_description`；用户调用型 skill 还包含 `policy.allow_implicit_invocation: false`，与 `disable-model-invocation` 配套。保持两者一致：一个 skill 在两种代理运行环境中都必须是用户调用型，或者都不是。

分类目录的 `README.md` 和顶层 `README.md` 将条目分成**用户调用型**和**模型调用型**两组。

## Skills 之间的依赖

依赖要写成明确的**调用 Skill 工具**指令，指定 skill 名称，例如 `Call the Skill tool with "grilling"`。不要写 `../other-skill/FILE.md` 这类深入其他目录的引用，也不要只提 `/skill`，让模型自行解释。写明工具名称才能促成调用。大多数代理运行环境提供工具来调用 skill，直接写出工具名称，比在说明中放 `/name` 并期待它被当作命令执行，成功率更高。去掉开头的 `/` 也更符合跨运行环境的设计：单独的 skill 名称不假定哪种环境的触发语法。共享参考资料存放在所属 skill 中，其他 skills 通过调用该 skill 的 Skill 工具来读取，而非跨目录链接。

这里指的是**操作指令**：skill 自己的步骤要求代理立即运行另一个 skill。供人类选择的路由说明（`ask-matt`、分类 `README.md`）只是列出 skills，并未调用任何内容，因此仍可将 `/skill` 名称作为普通标签。

Skill 工具每次只接受一个 skill。某步骤需要两个 skills 时，必须调用两次。明确写成 `Call the Skill tool twice, for "grilling" and "domain-modeling"`，不要写“使用 X 和 Y 调用它”，后者像是一次传入两个名称。

整套约定仅在被点名的 skill 是**模型调用型**时成立。用户调用型 skill 绝不能用这种方式触达；根据上述不变量，其他 skill 不能调用它，向 Skill 工具提供名称也不行。某步骤以用户调用型 skill 为前提，例如 `setup-matt-pocock-skills`，应要求人类执行：“告诉用户运行 `/setup-matt-pocock-skills`”，绝不能写成 Skill 工具调用。

## 被动读取与主动领域工作

仅为统一词汇而_读取_ `GLOSSARY.md`，用一句普通指针即可，无需 `domain-modeling` skill。只有主动构建、打磨领域模型的工作才属于 `domain-modeling`，包括质疑术语、检查边界情景、编写 ADR，以及边做边更新 `GLOSSARY.md`。
