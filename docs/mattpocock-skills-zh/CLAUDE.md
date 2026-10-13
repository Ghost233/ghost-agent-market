> 译者说明：本目录是上游 `49dd158d1076134a641b33efb035946536778336` 的资料参考快照，供阅读使用。27 个正式中文 skill 位于仓库的插件目录，安装和使用见[根 README](../../README.md)。这里保留的上游维护命令、脚本和机器发布清单按完整上游仓库布局解释；执行维护命令时，请切换到 `upstream/mattpocock-skills/` 子模块。此参考快照中的 `skills/` 仅收录未发布内容及分类说明，机器清单保留原始路径供对照。

Skills 按 `skills/` 下的类别目录组织：

- `engineering/`：日常代码工作。
- `productivity/`：日常非代码工作流工具。
- `misc/`：保留但很少使用，不列入正式发布范围。
- `in-progress/`：测试版，主动公开并欢迎反馈，不随插件发布。
- `deprecated/`：已经停止使用。

`engineering/` 或 `productivity/`（**正式发布**类别）中的每个 skill，必须在顶层 `README.md` 中有引用，并出现在 `.claude-plugin/plugin.json` 的 `skills` 数组中。Claude Code 插件仅发布正式发布集合。`misc/`、`in-progress/` 和 `deprecated/` 中的 skills 不得出现在这两处。

安装命令逐字复制自 [.agents/install-block.md](./.agents/install-block.md)。`.claude-plugin/marketplace.json` 是仓库自己的 marketplace。除 Claude Code 外，每个代理都从这里安装以获得自动更新；Claude Code 使用 `claude-plugins-official`。修改任一清单后，运行 `claude plugin validate . --strict`。[ADR 0002](./.agents/adr/0002-ship-as-a-claude-code-plugin.md) 记录了原因。

顶层 `README.md` 的每个 skill 条目，必须把 skill 名称链接到它的 `SKILL.md`。

每个类别目录都有一个 `README.md`，列出类别中的所有 skills，每项附一句描述，并把名称链接到对应的 `SKILL.md`。正式发布类别的 `README.md` 和顶层 `README.md` 按**用户调用**和**模型调用**分组。非正式发布类别（`misc/`、`in-progress/`）的 `README.md` 使用平铺列表。

`engineering/` 和 `productivity/` 中的 skills 还有面向人的文档页，路径为 `docs/<bucket>/<skill-name>.md`。文档目录镜像 `skills/` 下这两个类别目录。无论类别为何，发布 URL 都是 `https://aihero.dev/skills-<skill-name>`；文档路径只用于仓库组织。新增、重命名或修改这两个类别中 skill 的行为时，按 [.agents/writing-docs.md](./.agents/writing-docs.md) 创建或同步文档页。完整页面包含四节：**它做什么**、**何时使用**、**常见问题**和**有效运行的表现**。`writing-docs.md` 包含模板、章节顺序，以及查找问题的来源。非正式发布类别（`misc/`、`in-progress/`、`deprecated/`）中的 skills **没有**文档页。只有一种例外：正式发布后彻底删除的 skill 保留文档页，并标记为归档（参见 `writing-docs.md`）。

每个 `SKILL.md` 要么由用户调用（`disable-model-invocation: true`，加上 `agents/openai.yaml` 中的 `policy.allow_implicit_invocation: false`，只有人类可以触达），要么由模型调用（模型或用户都可触达）。参见 [.agents/invocation.md](./.agents/invocation.md)。

[`ask-matt`](../../claude-code-market/plugins/mattpocock-skills-zh/skills/ask-matt/SKILL.md) 是路由器，描述每个用户可触达的 skill，以及它们之间的关系。它与文档页采用相同的同步触发条件：新增、重命名、删除 skill，或修改用户可触达的 skill 在流程中的位置时，重新阅读 `ask-matt` 的 `SKILL.md` 并更新它，使映射保持准确。路由器漏掉新 skill，或仍然指向已经过时的 skill，就会给出错误信息。

要把 `deprecated/` 和 `misc/` 之外的每个 skill 链接或重新链接到本地代理运行环境的 skill 目录（`~/.claude/skills`、`~/.agents/skills`），运行 `scripts/link-skills.sh`。每个条目都是指向这个仓库的符号链接，因此 `git pull` 会让已安装的 skills 保持最新。新增、删除或重命名 skill 后，重新运行脚本。

仓库的自然语言内容中不使用长破折号，范围包括 `SKILL.md`、文档、`README.md`、`CHANGELOG.md`、ADRs、changesets 和代码注释。句子需要这种符号时，按语义改用逗号、冒号、句号、括号或连词，不能盲目替换字符。

## 代理 skills

### 分诊标签

标准名称保持原样。参见 `docs/agents/triage-labels.md`。Issues 按 [`SCOPE.md`](./SCOPE.md) 判断。
