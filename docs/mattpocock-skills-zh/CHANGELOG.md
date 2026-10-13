# mattpocock-skills

## 1.3.1

### 补丁变更

- [#1121](https://github.com/mattpocock/skills/pull/1121) [`c5b9869`](https://github.com/mattpocock/skills/commit/c5b98691982c4f0d3a5e40ab09566b3b84721e00) 感谢 [@mattpocock](https://github.com/mattpocock)。 `ask-matt` 不再说 `diagnosing-bugs` 会在事后复盘中交给 `improve-codebase-architecture`，该步骤已经删除。现在它会在修复后建议运行 `/retro`，思考什么措施本可防止缺陷；发现缺少接缝时，建议 `/improve-codebase-architecture`。`diagnosing-bugs` 文档页也删除了相同的过时交接说明。感谢 @Ygilany 发现这个问题（[#1117](https://github.com/mattpocock/skills/issues/1117)）。

## 1.3.0

### 次版本变更

- [#1120](https://github.com/mattpocock/skills/pull/1120) [`2aecca1`](https://github.com/mattpocock/skills/commit/2aecca12ea9ff047f76c8178cb64dfeafd192abe) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`implement-spec`** 转为正式发布的**工程** skill，使它随 Claude Code 插件发布，拥有文档页，并由 `ask-matt` 将其路由为逐工单 `implement` 的并行替代方案。

  `implement-spec` 由用户调用，一次运行实施整个 spec。它把工单读作**任务图**，让实施子代理在各自 worktree 中沿就绪**前沿**工作，把全部内容合入一条**集成分支**，最后用 `code-review` 收尾。正式发布前作了以下调整：

  - 目标现在是集成分支。只有问题跟踪器通过 PR 关闭工作，或你明确要求时，才打开草稿 PR，而且必须在首次合并后打开，因为没有领先 main 提交的分支无法开 PR。不使用 PR 时，按跟踪器的方式解决工单。
  - 与同类 skills 一样通过指针找到问题跟踪器。没有提供配置时，要求你运行 `/setup-matt-pocock-skills`，不会静默默认使用 `gh`。
  - 每个实施者确认 worktree 基于集成分支，用 `tdd` 构建工单，报告完成前把集成分支最新提交合入自己的分支，使每次合并都是 fast-forward。

- [#1120](https://github.com/mattpocock/skills/pull/1120) [`2aecca1`](https://github.com/mattpocock/skills/commit/2aecca12ea9ff047f76c8178cb64dfeafd192abe) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`pr`** 转为正式发布的**工程** skill，使它随 Claude Code 插件发布，拥有文档页，并由 `ask-matt` 将其路由为 PR 正文收尾工具。

  `pr` 由模型调用，定义 PR 正文形式：用能说清变更的最小可视化作摘要（伪代码、调用树、文件树、Mermaid 或 diff），提供运行有效的前后证据，判断合并危险程度（单向门或双向门，以及影响范围）。摘要可视化改编自 Dex Horthy 的 `show-me`，在 skill 的 `CREDITS.md` 中署名。

- [#1120](https://github.com/mattpocock/skills/pull/1120) [`2aecca1`](https://github.com/mattpocock/skills/commit/2aecca12ea9ff047f76c8178cb64dfeafd192abe) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`retro`** 转为正式发布的**工程** skill，使它随 Claude Code 插件发布，拥有文档页，并由 `ask-matt` 将其路由为主要流程中 `code-review` 之后的最后一步。

  `retro` 由用户调用，回看编码会话，对代理环境提出改进建议，包括导航指针、自动化检查、编码标准、引导文件、工具使用效率和信息访问。它先分类每项编码标准问题：机械性违规增加确定性检查，例如 linter 规则、pre-commit hook 或 CI 任务；`CODING_STANDARDS.md` 用于需要判断的情况。仓库完全没有护栏，本身也算一个发现。

- [#1120](https://github.com/mattpocock/skills/pull/1120) [`daa01d8`](https://github.com/mattpocock/skills/commit/daa01d8aa68ad5c61b68970ec2018d0ce9567be6) 感谢 [@mattpocock](https://github.com/mattpocock)。 删除 **`resolving-merge-conflicts`** skill。已经不再需要，也没有替代 skill：代理无需专用 skill 就能处理正在进行的 merge 或 rebase 冲突。它从 Claude Code 插件、README 和 `ask-matt` 路由器中移除。文档页 `https://aihero.dev/skills-resolving-merge-conflicts` 保留，并标记归档。

- [#1120](https://github.com/mattpocock/skills/pull/1120) [`006a52b`](https://github.com/mattpocock/skills/commit/006a52be23e0178375e083e30535fa8224471f3e) 感谢 [@mattpocock](https://github.com/mattpocock)。 把领域文档约定 `CONTEXT.md`/`CONTEXT-MAP.md` 改名为 `GLOSSARY.md`/`GLOSSARY-MAP.md`，覆盖所有读取和写入这些文件的 skills：`domain-modeling`、`grill-with-docs`、`improve-codebase-architecture`、`setup-matt-pocock-skills`、`triage`、`tdd`、`diagnosing-bugs`、`ask-matt`、`codebase-design`、`wait-what` 和 `pr`，以及文档页和本仓库根术语表。

  如果已有改名前生成的 `CONTEXT.md` 或 `CONTEXT-MAP.md`，用 `git mv` 改为新名称。今后 skills 只查找 `GLOSSARY.md`/`GLOSSARY-MAP.md`。

### 补丁变更

- [#848](https://github.com/mattpocock/skills/pull/848) [`f02e2ed`](https://github.com/mattpocock/skills/commit/f02e2ed3624d031272f8547742d23bf6bca8b072) 感谢 [@mattpocock](https://github.com/mattpocock)。 domain-modeling：讨论代码库术语，或直接编写、编辑 `GLOSSARY.md` 和 ADR 时触发，替换范围更窄的“确定领域术语或通用语言”与“记录架构决策”措辞。也删除“另一个 skill 需要维护领域模型”的条件，因为这应由调用方 skill 明确说明，不属于本 description 的职责。

- [#911](https://github.com/mattpocock/skills/pull/911) [`4f28947`](https://github.com/mattpocock/skills/commit/4f289474bad013fe2be8f8769d733f59d9103d6b) 感谢 [@mattpocock](https://github.com/mattpocock)。 给 `to-spec`、`code-review`、`setup-matt-pocock-skills`、`writing-fragments`、`writing-shape` 和 `wait-what` 的 frontmatter `description` 加引号。[#905](https://github.com/mattpocock/skills/issues/905) 清理长破折号时留下的未加引号“冒号加空格”，使这些块变成无效 YAML。`skills.sh` 发现时跳过全部六项，导致无法通过 `npx skills` 列出或安装。

- [#917](https://github.com/mattpocock/skills/pull/917) [`85f83d3`](https://github.com/mattpocock/skills/commit/85f83d3fde1d3a90d5c9a657f6998c79a6c37308) 感谢 [@mattpocock](https://github.com/mattpocock)。 grilling：更新轮次模板，相邻问题用水平线 `---` 分隔，避免连在一起。

- [#879](https://github.com/mattpocock/skills/pull/879) [`d419977`](https://github.com/mattpocock/skills/commit/d419977fe07d9e1607d3523f3579310bbb076b93) 感谢 [@mattpocock](https://github.com/mattpocock)。 grilling：移除 `SKILL.md` 的长破折号，改用冒号和分号，让指令读起来像普通文本。

- [#905](https://github.com/mattpocock/skills/pull/905) [`e6e9577`](https://github.com/mattpocock/skills/commit/e6e957797d8cceb5b351c0dc840369523f9fb8fb) 感谢 [@mattpocock](https://github.com/mattpocock)。 移除仓库自然语言中的所有长破折号，涵盖文档、`SKILL.md`、ADRs、`README.md`、脚本和 JSON/YAML 元数据。逐句人工改用逗号、冒号、句号、括号或连词，而非机械替换字符。`CLAUDE.md`/`AGENTS.md` 现在要求不要重新引入。

- [#878](https://github.com/mattpocock/skills/pull/878) [`e3e547b`](https://github.com/mattpocock/skills/commit/e3e547b57d549110a0aa6ff40fd7b871c01c76c9) 感谢 [@mattpocock](https://github.com/mattpocock)。 跨 skill 调用统一采用明确的“调用 Skill 工具”指令，替换裸 `/skill` 式表述，范围包括 `code-review`、`diagnosing-bugs`、`grill-with-docs`、`grill-me`、`improve-codebase-architecture`、`tdd`、`to-spec`、`to-tickets`、`triage` 和 `wayfinder`。

  - Skill 在正文中提到另一个 skill，例如“运行 `/grilling` skill”，不能可靠地触发加载。这正是 `grill-with-docs` 最常报告问题背后的已知缺口。直接命名工具（“调用 Skill 工具，参数为 `grilling`”）旨在提高触发率。去掉前导 `/` 也让指令更适用于不同运行环境，因为无需假设 Claude Code 的触发语法。
  - 一步需要多个 skills 时，明确要求多次调用，例如“分别为 `grilling` 和 `domain-modeling` 调用 Skill 工具”，而非一次调用携带两个名称。
  - 在 `.agents/invocation.md` 记录约定，供后续 skills 遵循。

- [#880](https://github.com/mattpocock/skills/pull/880) [`1dab982`](https://github.com/mattpocock/skills/commit/1dab98299c3b81f560026c01b7ebf55ed5d91373) 感谢 [@mattpocock](https://github.com/mattpocock)。 阻止 skills 通过 Skill 工具触达用户调用 skills。修复 `to-spec`、`wayfinder`、`to-tickets`、`triage`、`code-review` 和 `diagnosing-bugs` 中违反 `.agents/invocation.md`“其他 skill 不能调用它”不变量的跨 skill 引用。

  - `to-spec`、`wayfinder`、`to-tickets`、`triage` 和 `code-review` 都有一个前提：“如果没有配置，运行 `/setup-matt-pocock-skills`”。PR [#878](https://github.com/mattpocock/skills/issues/878) 把它改成了字面指令“调用 Skill 工具，参数为 `setup-matt-pocock-skills`”。但该 skill 由用户调用，所以任何其他 skill，无论用户调用还是模型调用，都不能调用它。五处全部改为要求代理告诉人类自行运行。
  - `diagnosing-bugs` 第 6 阶段事后复盘向 `improve-codebase-architecture` 的交接也一样，后者同样由用户调用。这个自主、经常无人值守的缺陷修复流程中，没有人类在场发现失败调用。由于实际很少触发，直接删除交接，而非弱化措辞。第 6 阶段现在只做“清理”，机械检查清单不变。
  - 在 `.agents/invocation.md` 的“二者间依赖”章节添加例外说明：“调用 Skill 工具，参数为 `name`”仅适用于模型调用 skill。PR [#878](https://github.com/mattpocock/skills/issues/878) 新增这一约定时，没有与八行前的调用不变量协调，这是错误传播到六个调用位置的主要原因。

  修复 [#453](https://github.com/mattpocock/skills/issues/453)。

- [#904](https://github.com/mattpocock/skills/pull/904) [`594f0f8`](https://github.com/mattpocock/skills/commit/594f0f83188921a60d45d63d6cdac509de20df2c) 感谢 [@mattpocock](https://github.com/mattpocock)。 wait-what：仓库用 `GLOSSARY-MAP.md` 索引多个上下文，而非只保留根目录单个 `GLOSSARY.md` 时，跟随映射找到正确的术语表。

## 1.2.3

### 补丁变更

- [#779](https://github.com/mattpocock/skills/pull/779) [`efce423`](https://github.com/mattpocock/skills/commit/efce423018fc6468a3239621f1c1bcaacc723801) 感谢 [@mattpocock](https://github.com/mattpocock)。 让 `diagnosing-bugs` 脱敏秘密。

  - 在 `SKILL.md` 添加**脱敏**章节。Skill 要求代理展示命令、输出和捕获产物；现在每次展示都先脱敏：写成 `<REDACTED>`，基于环境变量构建循环，让凭据留在环境中，捕获产物只引用携带有效信号的行。
  - 第 1 阶段完成标准原为“粘贴调用与输出”，现在要求展示脱敏版本，也向用户索取**脱敏的**捕获产物。
  - `scripts/hitl-loop.template.sh` 说明 `capture` 会把值回显到终端，因此它用来记录观察结果，登录仍作为 `step`。

- [#781](https://github.com/mattpocock/skills/pull/781) [`14bfbbd`](https://github.com/mattpocock/skills/commit/14bfbbd8654a8d2910299e1a004c19c1979687d8) 感谢 [@mattpocock](https://github.com/mattpocock)。 从 `code-review`、`codebase-design` 和 `improve-codebase-architecture` 的子代理派发指令中移除 Claude Code 的工具名与代理类型名，使步骤可在 Codex 及其他运行环境中执行。

- [#783](https://github.com/mattpocock/skills/pull/783) [`c0fd1e9`](https://github.com/mattpocock/skills/commit/c0fd1e973e040347d424e09934099f1bd6c2dee0) 感谢 [@mattpocock](https://github.com/mattpocock)。 wizard：删除时间估算。模板移除 `TOTAL_MINUTES` 和剩余时间显示，`stage` 只接受名称，进度按阶段计数。

## 1.2.2

### 补丁变更

- [#766](https://github.com/mattpocock/skills/pull/766) [`4aaccb5`](https://github.com/mattpocock/skills/commit/4aaccb58d40559d7e3c59a029b2290ae5ba538de) 感谢 [@mattpocock](https://github.com/mattpocock)。 让 `writing-for-agents` 在 Codex 中恢复模型调用。

  - 从 `agents/openai.yaml` 移除 `policy.allow_implicit_invocation: false`。Codex 之前把 skill 排除在模型可见列表之外，description 无法触发，只有显式 `$writing-for-agents` 提及有效。
  - 更新过时的 `interface.display_name` 和 `interface.short_description`，原值仍使用旧名称 `writing-great-skills`。
  - 在 `README.md` 和 `skills/productivity/README.md` 中，从**用户调用**列表移到**模型调用**列表。

## 1.2.0

### 次版本变更

- [#551](https://github.com/mattpocock/skills/pull/551) [`697d4ce`](https://github.com/mattpocock/skills/commit/697d4ce9742da558fd1ba6697c8e9775e2e302dd) 感谢 [@mattpocock](https://github.com/mattpocock)。 在每个 skill 的 Claude Code frontmatter 旁增加 Codex 元数据，使整套 skills 无需生成副本就能在两种运行环境中工作。

  - 每个 `SKILL.md` 旁新增 `agents/openai.yaml`，包含 Codex UI 元数据 `interface.display_name` 和 `interface.short_description`。
  - 每个用户调用 skill 标记 `policy.allow_implicit_invocation: false`，对应 Claude Code 的 `disable-model-invocation: true`。Codex 排除隐式调用，但显式 `$skill` 仍然有效。
  - 在 `.agents/invocation.md`、`CLAUDE.md` 和正式发布类别 README 中记录双运行环境调用模型。
  - 新增 `AGENTS.md`，作为指向 `CLAUDE.md` 的符号链接，让 Codex 读取相同仓库指引。

- [#593](https://github.com/mattpocock/skills/pull/593) [`0f2bdbd`](https://github.com/mattpocock/skills/commit/0f2bdbdb06220d2df3718b8f0483157c6c8a8600) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`to-questionnaire`** 从 `in-progress/` 转为正式发布的**效率工具** skill，随插件发布。它把你无法独自回答的决策，变成给那个能回答的人的 Markdown 问卷，可异步填写，也可开会时一起完成。

  核心做法是追问**发送安排**：普通追问会话询问主题，而这正是你无法回答的内容。因此访谈只问发给谁、需要什么回复，再让每个问题针对两者间缺口。

  已接入正式发布范围：插件条目、顶层与效率工具 README 的**用户调用**列表、`docs/productivity/to-questionnaire.md` 文档页，以及 `ask-matt` 的独立工具路由。它被描述为 `/grill-me` 的反向用途：从别人那里获取答案。

- [#680](https://github.com/mattpocock/skills/pull/680) [`b3376f8`](https://github.com/mattpocock/skills/commit/b3376f8d39848dd08572ec2667da4739a67c8c04) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`wizard`** 从 `in-progress/` 转为正式发布的**工程** skill，随插件发布，并改为模型调用。它生成交互式 Bash 脚本，引导人类完成手动流程，例如第三方配置、一次性迁移、A→B 状态转换。脚本打开 URL，说明点击内容，捕获值，并写入 `.env` 文件和 GitHub Actions secrets。

  配套 `template.sh` 已实现交互体验：显示进度和剩余时间、确认门槛、跨平台打开 URL（包括 WSL）、隐藏 secret 输入、幂等更新 `.env`、在不可用时适当降级的 `gh secret`/`gh variable` 写入，以及结束时的跳过项摘要。`STAGES` 标记以上全部是固定库，不手动编辑。Skill 只负责确定流程范围，编写**阶段**。

  放在工程类别，是因为它读取 `.env*`、`docker-compose*`、框架配置，以及 `.github/workflows/` 中每个 `secrets.*`/`vars.*` 引用来确定范围，写入 CI secrets，并用 `bash -n` 与 `shellcheck` 验证输出。

  改为模型调用后，代理遇到只有人类能做的步骤时就可以使用它。输入 `/wizard` 仍和以前一样有效，模型调用只增加代理自行使用的能力。Description 是决定触发的指针：说明产物，列出四种触发分支（准备基础设施、设置凭据或 CI secrets、操作陌生第三方控制台、一次性迁移或切换），并明确排除代理能自行完成的步骤。代理能做的工作应由代理做；向导负责不能交给代理的点击、批准和控制台操作。写代码前确认阶段列表，也作为代理在构建中途触发它时的提案。

  已接入正式发布范围：插件条目、顶层与工程 README 的**模型调用**列表、`docs/engineering/wizard.md` 文档页，以及 `ask-matt` 中针对人类专属步骤的独立工具路由。模型调用也让它不受 [#693](https://github.com/mattpocock/skills/issues/693) 影响，该问题让用户调用 skills 从 Claude 桌面版和网页版列表中消失。

- [#763](https://github.com/mattpocock/skills/pull/763) [`77d207e`](https://github.com/mattpocock/skills/commit/77d207ef03219cc603e2832e1159cbdd1c91818e) 感谢 [@mattpocock](https://github.com/mattpocock)。 围绕两个概念重塑 **`prototype`**：演示是**单个可分享 HTML 文件**，原型是**一手来源**。

  逻辑分支现在生成自包含文件，使用原生 HTML/CSS/JS，无需构建与服务，不再生成终端应用。非开发者双击就能打开，并用自己的领域语言操作：带标签的状态面板、始终可用的自由操作按钮，以及带标签页的**引导演练**，每项场景下面都有按顺序点击的按钮。可迁移的纯逻辑模块仍可移进实际代码，HTML 外壳是一次性部分。

  一次性不再意味着删除。原型回答问题后，作为可运行证据保存在 main 之外的一次性分支 `prototype/<name>`，并在实施 issue 中留下上下文指针。Main 只保留已验证决策，探索过程仍可查找。答案（结论加问题）仍持久记录在 issue、ADR 或提交中。

- [#536](https://github.com/mattpocock/skills/pull/536) [`42a5b70`](https://github.com/mattpocock/skills/commit/42a5b70fcacc7baff1977b13f3919fb2f63af14e) 感谢 [@mattpocock](https://github.com/mattpocock)。 将 skill 集合作为原生 **Claude Code 插件**发布，列入 Claude Code 官方 marketplace。现在可以订阅受管理的只读正式发布包：

  ```bash
  claude plugins install mattpocock-skills
  ```

  或在会话中：

  ```
  /plugin install mattpocock-skills
  ```

  无需先添加 marketplace，官方 marketplace 默认已配置。

  `.claude-plugin/plugin.json` 包含完整插件元数据，包括版本、描述、作者、授权和关键词，以及显式正式发布 skill 列表。`skills.sh` 仍是通用安装器，也是当时 Codex 及其他运行环境的安装路径。原生 Codex 插件暂缓，原因见 `.agents/adr/0002-ship-as-a-claude-code-plugin.md`。

- [#751](https://github.com/mattpocock/skills/pull/751) [`355fa74`](https://github.com/mattpocock/skills/commit/355fa7420b418af838998f7ec4365ceda1c8dfcc) 感谢 [@mattpocock](https://github.com/mattpocock)。 新增 **`wait-what`**，用一个词纠正模型啰嗦。消息没听懂时立即输入，代理就重新解释：补少量背景，使用 ASD-STE100 简化技术英语和 `CONTEXT.md` 中的通用语言。由用户调用，只有三行。

  名称就是机制。简洁 skills 会因不断变长而失败，400 行 skill 仍让模型啰嗦，因此这里只有一个准确引导词。描述*输出*的名称，例如 `/tldr`、`/no-fluff`，会让模型删词，使你更难理解。描述*听众*状态，则同时要求更少的词和缺失的背景。它还复用全局 `CLAUDE.md` 已有引导词，让 skill、`CLAUDE.md` 和每份 `CONTEXT.md` 使用相同 tokens。

  它修复一条消息，不会预防下一条。术语问题的根本解决是用 `/grill-with-docs` 提前建立共享语言；还没有共享语言时，就用这个工具。

- [#763](https://github.com/mattpocock/skills/pull/763) [`77d207e`](https://github.com/mattpocock/skills/commit/77d207ef03219cc603e2832e1159cbdd1c91818e) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 `/wayfinder` 的工作单元命名为**决策工单**，并用子代理解决调研工单。

  人们常把 wayfinder 工单理解为普通*实施*工单，即待执行的构建切片。但 wayfinder 使用的是**决策工单**，解决结果是决策的问题。Skill description 和首句现在引入术语并说明区别，`ask-matt`、工程 README 的简介和文档页同步更新。术语确定后，日常仍简称“工单”。`CONTEXT.md` 把**决策工单**记录为领域术语，使“避免使用 ticket”的建议与 wayfinder 的有意用法不再冲突。

  调研工单不再等待另开会话。Research 仍是正式工单类型：它是下游决策依赖的真实共享阻塞项，而前沿的阻塞关系正是为了展示这种依赖。变化在于解决方式：调研属于 AFK，绘图会话不暂停去阅读。创建工单后，绘图会话为每个调研工单派发 `/research` 子代理，并行解决，把发现保存到一次性 `research/<name>` 分支，留下上下文指针。调研工单是*每会话一个工单*的唯一例外。

- [#763](https://github.com/mattpocock/skills/pull/763) [`77d207e`](https://github.com/mattpocock/skills/commit/77d207ef03219cc603e2832e1159cbdd1c91818e) 感谢 [@mattpocock](https://github.com/mattpocock)。 **不兼容变更：** **`writing-great-skills`** 改名为 **`writing-for-agents`**，重组内容，并新增一个引导词。

  参考现在覆盖代理读取的任何文档，包括 skills、`AGENTS.md`/`CLAUDE.md` 和指针后的文档。`GLOSSARY.md` 合入 `SKILL.md`，每个术语只有一处权威说明，删除 `_Avoid_` 同义词列表与独立的可预测性定义。Skill 专属机制，包括 frontmatter、模型调用与用户调用、路由 skills、按调用方式拆分，延迟披露到新的 `SKILL-MECHANICS.md`。Skill 改为**模型调用**，在创建或编辑 skill，修改 `AGENTS.md`/`CLAUDE.md` 时触发。`ask-matt` 指针同步更新。请用新名称重新安装，旧名称已删除，没有别名。

  剪枝章节新增**缓存**。单一事实来源延伸到环境：`package.json` 脚本、配置、目录布局和 `--help` 输出本身就是权威来源。复述它们的文档是查询缓存，只有查询昂贵时才值得承担负载。目标是缓存代理无法直接查明的内容，例如未成文约定、选择原因、配置不会暴露的陷阱。单文件、单命令即可查询的事实留在环境中，避免过时。

- [#533](https://github.com/mattpocock/skills/pull/533) [`45afd80`](https://github.com/mattpocock/skills/commit/45afd8074a8b7de5fe073845d080fa9dd6c429fa) 感谢 [@mattpocock](https://github.com/mattpocock)。 给 **`improve-codebase-architecture`** 的 Explore 步骤新增 YAGNI 范围筛选。现在聚焦实际发生变更的位置：你指定方向时按该方向，否则读取最近约 20 条提交消息，把探索偏向活跃开发路径。无人修改代码中的深化机会，是永远无法兑现收益的重构；只有持续编辑的地方才有收益，因此报告不再整理仓库休眠角落。

### 补丁变更

- [#763](https://github.com/mattpocock/skills/pull/763) [`77d207e`](https://github.com/mattpocock/skills/commit/77d207ef03219cc603e2832e1159cbdd1c91818e) 感谢 [@mattpocock](https://github.com/mattpocock)。 打磨 `/ask-matt`，路由器现在覆盖阶段边界、两种 wayfinder 错误，以及以前未提及的两个 skills。

  **阶段边界。** **阶段**是会话中的一块工作，例如追问、实施或 QA。两阶段间的边界，是决定如何处理已建立上下文的地方。原来两项的 `Crossing sessions` 章节，替换为按顺序包含五种选项的决策树：**继续**、`/clear`、`/handoff`、**子代理**、`/compact`。理由延迟披露在新文件 `PHASE-BOUNDARIES.md` 中，同时修复三点：

  - **`/handoff` 的适用范围被夸大。** 原说明把它当成上下文窗口间的通用桥梁。实际范围很窄：只有内容需要*转移*到新运行环境、新目录、同事，或阶段中途分出的旁支任务时才需要。它提供可迁移性。
  - **`/compact` 是默认落点。** 它在树最底部，位于四个更便宜或更准确的问题之后。先压缩，可能让会话对摘要抹平的内容形成错误却自信的理解。
  - **两种分支完全缺失。** 首先排除**继续**，因为只有它保留对话作为一手来源。范围足够明确、可以无人值守执行的内容，由**子代理**处理。

  上下文卫生的退出办法现在是 `/compact`：同运行环境、同目录、阶段边界，交接条件不适用。聪明区数字从约 120k 更新为约 150k tokens。

  **Wayfinder 路由。** 这是最重、认知要求最高的流程，人们最常犯两种错误：

  - **过度使用。** 它比单次追问更慢、更密集，所以明确标为最重流程，只留给确实无法放进单次会话的想法。范围清晰的功能应使用 `/grill-with-docs`。
  - **交接时迷失方向。** 地图清晰后，wayfinder 交接，不开始构建。应在 `/to-spec` 接入主要流程，将地图链接的决策综合为可实施计划。只有工作最终确实很小时，才直接进入 `/implement`。

  **补足路由。** 路由器原本完全没有 `/grilling` 与 `/resolving-merge-conflicts`，现在已加入；`grill-me` 与 `grill-with-docs` 按是否在工作目录中区分。

- [#502](https://github.com/mattpocock/skills/pull/502) [`44eed54`](https://github.com/mattpocock/skills/commit/44eed545186ffd0263e8004867750b80cfddd215) 感谢 [@mattpocock](https://github.com/mattpocock)。 让 `/setup-matt-pocock-skills` 更易用，并使本地 Markdown 跟踪器符合当前 spec。

  - 只在安装了 `triage` 时询问**分诊标签**，合并为一个推荐回答“是”的问题：“保留默认分诊标签吗？”，不再逐项追问覆盖值。未安装 `triage` 时，跳过章节和 `docs/agents/triage-labels.md`。
  - **把外部 PR 作为需求入口**不再是配置问题。GitHub/GitLab 模板仍包含开关，默认关闭。用户可以之后在 `docs/agents/issue-tracker.md` 修改。
  - **领域文档**默认使用单上下文，无需询问。只有仓库表现出 monorepo 特征时，才提供多上下文选项。
  - **本地 Markdown 工单**现在一项一个文件，位于 `.scratch/<feature>/issues/<NN>-<slug>.md`，永远不合并为单个 `tickets.md`。`/to-tickets` 与本地跟踪器模板现在一致，spec 文件使用 `spec.md`，以对应 `/to-spec`，不再使用 `PRD.md`。

  同步 `setup-matt-pocock-skills` 与 `to-tickets` 的文档页。

- [#532](https://github.com/mattpocock/skills/pull/532) [`170ad48`](https://github.com/mattpocock/skills/commit/170ad48655825783d0193e850e31a9aac957bb95) 感谢 [@mattpocock](https://github.com/mattpocock)。 调整 **`grilling`** 措辞，使其适用于通用场景。Description 和正文不再把访谈限制为软件计划：“this plan”改为“this”，“enact the plan”改为“act on it”，“exploring the codebase”改为“exploring the environment”。方法不变，现在表述为对任何计划、决策或想法作压力测试。

- [#593](https://github.com/mattpocock/skills/pull/593) [`a4b2009`](https://github.com/mattpocock/skills/commit/a4b2009a1a3ac9575506c10b4c84f08f9bba7a38) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`grilling`** 从一次一个问题改为分轮提问。它绘制决策树，在一个编号轮次中询问整个**前沿**，即所有前置条件已经确定的问题，再根据用户答案重新计算前沿，进入下一轮。同样 13 个问题由约三轮完成。环境能确定的事实交给后台子代理调查，调研不阻塞整轮，只有依赖正在进行的探索的问题等待。前沿清空时，会话结束。

  每个问题用固定形式输出：`❓ **Q1** - **<title>**`，然后正文（文字或多选项），最后推荐独占一行 `➡️`。整轮是可扫读的编号列表，推荐与问题视觉分开，便于按编号回答。

  `grill-me`、`grill-with-docs` 和 `triage` 也逐轮运行前沿；`triage` 的追问步骤和 `grilling` 的 Codex `short_description` 同步改为新节奏。在全局 `CLAUDE.md` 加一行恢复一次一个问题的办法不变。

- [#752](https://github.com/mattpocock/skills/pull/752) [`c66bdee`](https://github.com/mattpocock/skills/commit/c66bdeeee002d81e3f8b21403c07f9a0d7bea6da) 感谢 [@mattpocock](https://github.com/mattpocock)。 从仓库删除六个 skills。它们都不在 Claude Code 插件中，但都可以通过 [skills.sh](https://skills.sh/mattpocock/skills) 安装，因为该平台提供仓库中的每个 skill。下面记录从列表移除的内容及其去向。

  四个退役 skills，已由更适合的 skill 吸收：

  - **`ubiquitous-language`** → **`/domain-modeling`**。后者构建并维护整个领域模型，而非从一次对话导出术语表。
  - **`design-an-interface`** → **`/codebase-design`**。没有内容损失：Ousterhout 的“设计两次”方法，让并行子代理产生差异明显的设计，已经作为 `DESIGN-IT-TWICE.md` 包含在该 skill 中。
  - **`qa`** → **`/triage`** 和 **`/to-tickets`**。
  - **`request-refactor-plan`** → **`/to-spec`** 和 **`/improve-codebase-architecture`**。

  另外两个仅供我自己使用，绑定我的机器，从未打算给其他人使用。`personal/` 类别一起删除：

  - **`edit-article`**
  - **`obsidian-vault`**，其中硬编码了我的 Obsidian vault 路径。

  `skills/deprecated/` 保留类别，现在为空。`skills/in-progress/` 不变，现在按实际用途描述：主动发布的测试版渠道，可以通过 skills.sh 逐个安装。

- [#734](https://github.com/mattpocock/skills/pull/734) [`a2f9333`](https://github.com/mattpocock/skills/commit/a2f9333669ff53db762c87ecda5a15442060a3be) 感谢 [@mattpocock](https://github.com/mattpocock)。 完成 `to-prd` → `to-spec` 重命名。发布文本中只使用“spec”。

  - **`to-spec`** 的 skill 和文档页，不再以“你可能把这种文档称为 PRD”开头。本地 Markdown 跟踪器模板也删除相同附带说明。
  - **`code-review`** 的 frontmatter description、双轴摘要和 spec 来源查找顺序，改为来源 issue/spec。两份 README 同步更新。
  - **GitHub 与 GitLab 跟踪器模板**现在写“本仓库 issues 和 specs 位于 GitHub/GitLab issues”。本地模板更新时，它们仍保留“PRDs”，导致过时术语传播到使用模板的每个仓库。
  - **`docs/engineering/research.md`** 原来指向已重命名 skill 的失效地址 `https://aihero.dev/skills-to-prd`，现在与其他 19 个文档页一样链接 `to-spec`。

  CHANGELOG 与现有 changesets 在记录重命名本身时仍使用 PRDs，这样是正确的。

## 1.1.0

### 次版本变更

- [#406](https://github.com/mattpocock/skills/pull/406) [`930a450`](https://github.com/mattpocock/skills/commit/930a450089f77a49af09001d955db8452a4b867d) 感谢 [@mattpocock](https://github.com/mattpocock)。 让 **`ask-matt`** 路由器跟上整套 skills。它现在包含之前漏掉的五个 skills：**`tdd`**（融入主要流程，作为 `implement` 驱动的红 → 绿引擎）、**`diagnosing-bugs`**（新增“东西坏了”入口，以前没有缺陷路由）、**`domain-modeling`** 和 **`codebase-design`**（新增“底层词汇”章节），以及 **`grilling`**（共享访谈原语）。补足 `prototype` 独立工具说明，description 从“用户调用 skills”扩展为“skills”。`CLAUDE.md` 在文档页同步规则旁新增维护规则：未来新增、重命名、删除 skill 或改变流程时，都重新检查 `ask-matt`。

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) 感谢 [@mattpocock](https://github.com/mattpocock)。 正式发布并加强 **`code-review`**。开发中的 **`review`** 改名为 **`code-review`**，从 `in-progress/` 移到 `engineering/`。它现在随插件发布，列入顶层和工程 README 的模型调用列表，并拥有 `docs/engineering/code-review.md` 文档页。`/implement` skill 和文档改为指向 `/code-review`。

  Standards 轴也新增始终适用的 **Fowler 坏味道基线**：约 12 种高信号代码坏味道，包含神秘命名（Mysterious Name）、重复代码（Duplicated Code）、依恋情结（Feature Envy）、数据泥团（Data Clumps）、基本类型偏执（Primitive Obsession）、重复 switch（Repeated Switches）、霰弹式修改（Shotgun Surgery）、发散式变化（Divergent Change）、夸夸其谈的通用性（Speculative Generality）、消息链（Message Chains）、中间人（Middle Man）和被拒绝的遗赠（Refused Bequest）。基线内联于 `SKILL.md`，与仓库已有标准一起使用，不新增第三个轴。两条约束保证安全：仓库成文标准优先于基线；每种坏味道都以判断性意见报告，不能当成硬性违规。

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) 感谢 [@mattpocock](https://github.com/mattpocock)。 从两个方面打磨 **`grilling`**。

  **确认门槛。** 你确认已达成共同理解前，代理不得执行计划。原有“共同理解”完成标准变成显式停止门槛。Description 也引入预训练已有的 **`grill`** 引导词，“持续深入追问用户”，强化调用。文档页同步更新。

  **事实与决策。** Grilling 现在区分*事实*（探索代码库查明）和*决策*（逐项交给人类，等待答案）。旧的笼统指令“如果问题能通过探索代码库回答，就探索代码库”原为人类在线场景编写。但当其他 skill 把 grilling 放在“解决工单”框架内运行时，它会被理解为允许自主回答*决策*。区分二者，防止代理抢先自行回答。

- [#463](https://github.com/mattpocock/skills/pull/463) [`af6d692`](https://github.com/mattpocock/skills/commit/af6d6922c3e2b5288eef155346cbe319e4ed3bd0) 感谢 [@mattpocock](https://github.com/mattpocock)。 给 **`writing-great-skills`** 新增两个相邻的引导失败方式，说明你以为没有作用的语言仍会引导代理。**否定**对应*大象*：用禁令引导，点名不能做的行为，会把行为拉进上下文，使其更容易出现，例如“不要想大象”，因此应使用**正向**提示。**负空间**对应空缺：忽视未写内容也会引导，每个 skill 没有规定的决定都会交给代理先验，并非保持中立。修复方式是检查草稿中未说明的内容，有意决定每个遗漏：补充，或留作真实**分支**。二者保持独立，因为诊断与修复不同。每项都有完整 `GLOSSARY.md` 条目与 `SKILL.md` 失败方式列表项，与其他失败方式的记录方式一致。

- [`850873c`](https://github.com/mattpocock/skills/commit/850873cd73d5f81826ebf512ad35d2b1e113001f) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`prototype`** 改为模型调用，让代理和其他 skills 可以自主使用。Description 围绕*原型*引导词重写：用一次性代码回答设计问题，每个分支只保留一个触发条件，即状态/逻辑合理性检查，或 UI 探索。

- [#409](https://github.com/mattpocock/skills/pull/409) [`0d74d01`](https://github.com/mattpocock/skills/commit/0d74d01cbc64ca27778a49b38599f70c534e76a0) 感谢 [@mattpocock](https://github.com/mattpocock)。 新增 **`research`**，一个小型模型调用 skill，启动**后台代理**，通过**一手来源**调查问题，包括官方文档、源代码、specs 和第一方 APIs，随后在仓库存放此类笔记的位置留下单个带引用的 Markdown 文件。这是可以委派的阅读工作：它阅读时你继续工作，之后获得可以用于追问、规划或设计的文档。列入顶层与工程 README 的模型调用列表，加入 `.claude-plugin/plugin.json`，创建 `docs/engineering/research.md` 文档页，并在 `ask-matt` 中作为独立工具路由。

- [#469](https://github.com/mattpocock/skills/pull/469) [`a0329ba`](https://github.com/mattpocock/skills/commit/a0329ba95751f58566ed7ab484475917a68f1629) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`to-issues`** 拆为简洁的**流程**与**参考**章节，并教它处理**广泛重构**：单个机械变更，例如重命名列，**影响范围**扩散到整个代码库，一次破坏数千个调用位置，任何垂直切片都无法单独变绿。起草步骤现在指向两个共置参考块：用于普通曳光弹的**垂直切片规则**，以及**广泛重构**。后者采用**扩展与收缩**拆分：在旧形式旁扩展新形式，按影响范围分批迁移调用位置，再收缩删除旧形式，使每批 CI 保持绿色。无法逐批变绿时，只在最后的集成验证 issue 中要求绿色。Issue 正文模板也移入参考章节。

- [#464](https://github.com/mattpocock/skills/pull/464) [`386d4ff`](https://github.com/mattpocock/skills/commit/386d4ff719a7c420ad1454232d0436b01f1b8c17) 感谢 [@mattpocock](https://github.com/mattpocock)。 统一规划 skills。**`to-prd` 改名为 `to-spec`**，“spec”成为贯穿全程的单一术语。为便于发现，开头仍保留“你可能把这种文档称为 PRD”。**`to-plan` 和 `to-issues` 合并为 `to-tickets`，删除 `to-issues`。**

  `to-tickets` 把计划、spec 或对话拆成一组**工单**，即曳光弹垂直切片，每项声明**阻塞关系**。同一产物根据 `/setup-matt-pocock-skills` 配置的跟踪器有两种形式：**本地文件** `tickets.md` 用文字写关系，由你从上到下手动处理；**真实跟踪器**使用原生阻塞链接，所以所有阻塞项已完成的工单都处于前沿，多个代理可以同时工作。关系始终位于工单中，介质只决定是否据此并行行动。

  发布时优先用跟踪器**原生子问题**表达父项到切片，用**原生阻塞关系**表达 `Blocked by`。不支持时，保留正文中的 `## Parent` 和 `## Blocked by` 章节作为后备。`What to build` 模板指向 `/prototype` 代码的位置，不内联代码片段。

  `ask-matt` 主要流程现在是 `idea → /to-spec → /to-tickets → /implement`，并创建面向人的 `docs/engineering/to-spec.md` 与 `docs/engineering/to-tickets.md` 文档页。

- [#464](https://github.com/mattpocock/skills/pull/464) [`0557d57`](https://github.com/mattpocock/skills/commit/0557d57579d9b3d39839fdaf8d4a6542b17539ce) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 wayfinder 在文档中的位置确定为**按情形使用的入口**。以追问为起点的*想法 → 交付*流程仍为主入口，把 wayfinder 升为默认主线属于 v2 规模变更，而非 1.1。**`ask-matt`** 现在列出具体触发条件：新项目，或规模大到单次会话容纳不下的功能。两个追问入口 **`grill-me`** 与 **`grill-with-docs`** 对单次会话无法容纳的工作引导到 wayfinder，使读者能从实际起点发现这个入口。

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) 感谢 [@mattpocock](https://github.com/mattpocock)。 正式发布并重塑 **`wayfinder`**，用于规划单个代理会话容纳不下的大规模工作。它从 `in-progress/` 移到 `engineering/`，加入插件，在顶层与工程 README 的**用户调用**列表中出现，创建 `docs/engineering/wayfinder.md` 文档页，并加入 `ask-matt` 路由。以下重命名与重塑使它成为成熟 skill：

  - **`decision-mapping` 改名为 `wayfinder`**，通过 `/wayfinder` 调用。“Decision map”术语化且不准确，实际只有一种工单类型是决策。新表达改为在模糊问题中找路线，使用一组统一引导词：**战争迷雾**、**前沿**、**地图**。
  - **目的地作为引导词。** Wayfinding 寻找通向目的地的*路线*。命名目的地是绘图的第一步，确定范围并影响每个工单。因此地图新增 `## Destination` 字段，每次会话据此定位，分诊也在创建工单前先确定它。
  - **规划。** 地图产出**决策**。实施前没有待决内容时完成。某项工作可在 Notes 中覆盖这一约定。
  - **地图是索引。** 决策只存在于工单中，地图只写要旨与链接，不重复说明。迷雾转为工单时，清除已经转出的部分，避免两处残留。
  - **默认协作。** 地图从本地 Markdown 文件移到问题跟踪器中，成为单个 `wayfinder:map` issue，工单作为子问题，共享一个团队可关注的 URL。会话先低分辨率加载地图，再按需深入工单。Wayfinder 通过 `docs/agents/issue-tracker.md` 指针保持与跟踪器无关，支持 GitHub、GitLab 和本地 Markdown。`setup-matt-pocock-skills` 初始化 `Wayfinding operations` 章节。
  - **通过指派领取。** 会话把工单指派给主导开发者，受派者本身就代表领取，标签只需保留 `wayfinder:<type>`。
  - **原生阻塞。** 优先使用跟踪器原生依赖关系，在其 UI 中直接显示前沿，让人类无需打开地图就知道可以领取什么。GitHub 和 GitLab 模板写明原生操作，正文约定作为后备。
  - **区分迷雾和范围外。** 地图新增两个名称清楚的章节：`## Not yet specified` 表示范围内迷雾，随前沿推进转为工单；`## Out of scope` 表示超出目的地的工作，已排除，永远不转为工单。目的地之外的工作不再看起来像可领取前沿。
  - **第四种工单类型 `task`。** 表示阻碍决策的实际手动工作，例如准备访问权限、搬迁数据、注册服务。它是唯一执行而非决策的类型，以解锁决策作为存在理由。
  - **HITL / AFK 分类。** 每种工单属于 **HITL**（人类参与，例如追问、原型）或 **AFK**（代理独自完成，例如调研；task 可以属于任一类）。HITL 只能通过在线交流解决，因此标签自然要求“等待人类”。自行回答的追问代理按定义已违反 HITL。这样修复学生报告的 `/wayfinder` 追问自己而非人类的问题。
  - **恢复没有迷雾时的提前退出。** 初始广度优先追问未发现迷雾，说明工作可以放进一次会话。此时停止，询问你如何继续，不创建无人需要的地图。

### 补丁变更

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`tdd`** 重塑为纯参考 skill，并补充缺失的反模式。

  **纯参考。** 模型已持有红 → 绿 → 重构循环的引导词，逐步 Workflow 大多是在复述。删除 Workflow 和每轮检查清单，把其中持久有效的垂直切片/曳光弹概念，合入反模式章节和简短循环规则列表。引入**接缝**，用于引导测试位置：仅在预先约定、写测试前与用户确认的接缝处测试。也移除重构阶段，TDD 现在为红 → 绿，重构属于审查阶段。重构规则和 `refactoring.md` 移到 `code-review`。

  **同义反复测试。** 新增该反模式：断言按代码相同计算方式重新生成，必然通过，不提供信心；它区别于已有的实现耦合反模式。在相同位置作为同级项增加：Philosophy 原则要求预期值来自独立事实来源，检查清单新增门槛，`tests.md` 新增 BAD/GOOD 示例对。

- [`e00eadb`](https://github.com/mattpocock/skills/commit/e00eadb4bb32c3d5a631ead1a5ed5d6a7c5f74e2) 感谢 [@mattpocock](https://github.com/mattpocock)。 扩展 **`triage`**，分诊外部 PR，把 PR 视为附带代码的 issue，经过相同角色与状态机。PR 与 issues 一起流转，由各仓库配置开关控制；发现阶段只收集外部 PR。原来仅用于缺陷的“复现”步骤，泛化为单个“验证主张”步骤。冗余检查把已经实现的请求归为 `wontfix`，不污染范围外知识库。`setup-matt-pocock-skills` 为 GitHub/GitLab 新增将 PR 作为需求入口的开关。

- [#472](https://github.com/mattpocock/skills/pull/472) [`d869d45`](https://github.com/mattpocock/skills/commit/d869d45afc32beab1c2d1350f8de5e81589512cd) 感谢 [@mattpocock](https://github.com/mattpocock)。 修复 **`wayfinder`** 硬编码问题跟踪器文档路径的问题，它破坏了其余 skills 依赖的间接引用。

  `to-issues`、`to-prd` 和 `triage` 不点名路径，而是通过 `setup-matt-pocock-skills` 写进 `CLAUDE.md`/`AGENTS.md` 的 `### Issue tracker` 块解析跟踪器。块指向文档，无论实际位置为何。Wayfinder 原来固定使用 `docs/agents/issue-tracker.md`，所以代理文档放在别处的仓库，即使 `CLAUDE.md` 明确声明 GitHub issues，也静默退回本地 Markdown 跟踪器。现在它通过相同指针解析，按名称读取 `Wayfinding operations` 章节，使间接引用在整套 skills 中保持一致。

## 1.0.1

### 补丁变更

- [`d20ee26`](https://github.com/mattpocock/skills/commit/d20ee2684e2a9442698ac3c1e0f2c5b68c4cf296) 感谢 [@mattpocock](https://github.com/mattpocock)。 让 **`teach`** 优先复用。课程现在使用 `./assets/` 中可复用的**组件**构建，包括样式表、测验控件、模拟器和图表辅助工具。代理写课程前先读取 `./assets/`，使用已有内容，新且可复用的内容提取为组件。

## 1.0.0

### 主版本变更

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 新增 **`ask-matt`**，一个用户调用路由器，根据你的情形指向合适 skill 或流程。

  **不兼容变更：** `ask-matt` 路由到仓库中其他用户调用 skills，因此要求它们已经安装。

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 新增共享设计 skills，让现有 skills 使用它们。

  - 新增 **`codebase-design`**，提供深模块词汇（模块、接口、深度、接缝、适配器），以及把大量行为放在小接口后的原则。原来 `improve-codebase-architecture/LANGUAGE.md` 中的语言移到这里，并泛化以供多个 skills 复用。
  - 新增 **`domain-modeling`**，主动构建并打磨项目领域模型，用术语表测试术语，并保持 `CONTEXT.md` 和 ADRs 最新。
  - `improve-codebase-architecture` 从 `/codebase-design` 获得架构词汇，从 `/domain-modeling` 获得领域模型。
  - `tdd` 使用 `/codebase-design` 的接口设计指导，删除内联的 `deep-modules.md`/`interface-design.md`，改用共享 skill。
  - `grill-with-docs` 通过 `/domain-modeling` 在会话中直接构建领域模型。

  **不兼容变更：** 这些 skills 现在依赖新的 `codebase-design` 和 `domain-modeling`，必须一并安装。

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 删除 **`caveman`** 和 **`zoom-out`**。

  - `caveman` 与我测试中的另一个 skill 重复，从未打算公开。
  - `zoom-out` 实际无人使用，所以从仓库删除。

  **不兼容变更：** 两个 skills 都已删除。

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 把 **`diagnose`** 改名为 **`diagnosing-bugs`**。

  **不兼容变更：** 通过 `/diagnosing-bugs` 调用，旧 `/diagnose` 名称不再存在。

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 用 **`writing-great-skills`** 替换 **`write-a-skill`**。

  - 删除 `write-a-skill`。
  - 新增 `writing-great-skills` 及其 `GLOSSARY.md`，作为编写、编辑 skills 的参考：让 skill 行为可预测的词汇与原则，逐句寻找空操作。
  - 将 `grilling` 暴露为模型调用 skill，作为 `grill-me` 和 `grill-with-docs` 背后的可复用访谈循环。

  **不兼容变更：** `write-a-skill` 已删除，改用 `writing-great-skills`。

### 次版本变更

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 新增 **`resolving-merge-conflicts`**，用于解决正在进行的 Git merge 或 rebase 冲突的循环。独立使用，不依赖其他 skills。

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 文档中的 skill 分类从 **Commands / Skills** 改为**用户调用 / 模型调用**，并新增 `docs/invocation.md` 定义区别：用户调用 skills 只有人类输入时才能触达，负责组织流程；模型调用 skills 在任务适合时也可自动触达。用户调用 skill 可以调用模型调用 skill，但不能调用另一个用户调用 skill。

### 补丁变更

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) 感谢 [@mattpocock](https://github.com/mattpocock)。 收紧 **`review`**：快速失败的 ref 检查、单一事实来源的规则，以及空操作删除。
