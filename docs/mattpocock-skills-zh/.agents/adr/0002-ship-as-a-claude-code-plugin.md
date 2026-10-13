# 将 skill 集合作为原生 Claude Code 插件发布；暂缓原生 Codex 插件

这些 skills 一直支持通过 [skills.sh](https://skills.sh/mattpocock/skills) 安装（`npx skills add mattpocock/skills`）。它会把可编辑的 skill 文件复制到用户项目中，支持 Claude Code、Codex 和其他遵循 Agent Skills 标准的代理运行环境。用户反复要求一种**安装即可使用**的分发方式：订阅只读、持续更新的整套内容，无需自行编辑和维护副本。原生插件系统正好提供这种能力。

我们发布原生 **Claude Code 插件**，暂时**推迟**原生 **Codex 插件**。两者采用不同方案，是因为各自的插件清单选择 skills 的方式，无法同样适配本仓库按类别分目录的布局。

## 限制：分类存放的 skills 与单路径选择

Skills 存放在 `skills/` 下的分类目录中。`engineering/` 和 `productivity/` 已**正式发布**；`misc/`、`personal/`、`in-progress/` 和 `deprecated/` **未发布**。插件必须只暴露正式发布的内容，而这批内容分散在两个分类目录中。

- **Claude Code**：`.claude-plugin/plugin.json` 的 `skills` 接受**明确的 skill 目录路径数组**。我们逐项列出正式发布的 skills，准确排除其他内容，并增加 `.claude-plugin/marketplace.json`，让本仓库成为自己的单插件 marketplace。已完成全流程验证：`claude plugin validate . --strict` 通过，`marketplace add` → `install` 能解析全部正式发布的 skills。
- **Codex**：`.codex-plugin/plugin.json` 的 `skills` 只接受**单个路径字符串**。使用数组会报 `missing or invalid plugin.json`，Codex 会递归发现该路径下的 `SKILL.md`。单个路径无法指定两个分类目录，也无法筛选其中的部分内容。测试过以下两种替代办法，均未采用：
  - 指向 `./skills/` 会同时发布 `deprecated/`、`in-progress/`、`personal/` 和 `misc/`，包含我们刻意不正式发布的退役、草稿和个人 skills。
  - 在一个精选的扁平目录中创建指向分类目录的**符号链接**，安装后无法保留：Codex 将插件目录复制到缓存时会**丢弃符号链接**，最后 skills 为空。

要让 Codex 通过单路径只取得正式发布的内容，目前只有两种可靠办法：（a）**调整目录结构**，让 `skills/` 只含正式发布的 skills，将其他分类移出去；这会广泛影响 `CLAUDE.md`、`scripts/link-skills.sh`、各分类 README，以及依赖 `in-progress/` 和 `personal/` 的本地开发流程。（b）把正式发布的 skills **复制并提交**到一个扁平目录；这会带来同步负担和第二个事实来源。两者都属于结构性决策，不该与发布 Claude 插件一并实施。这很可能就是早先没有发布插件、却只模糊记得的原因：清单格式无法准确表达分类仓库中的精选子集。

## 决策

- 现在发布 **Claude Code 插件**（`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`），仅包含正式发布的内容，作为 v1.2 的主要交付项。
- 保留 **skills.sh** 作为通用安装入口。它目前已支持 Codex 和其他代理运行环境，Codex 用户仍有安装路径。
- **推迟**原生 Codex 插件，直到决定重构 `skills/` 使其仅包含正式内容，或提交生成的扁平副本。Codex 支持 `skills` 数组、包含列表，或安装时保留符号链接后，再评估。

## 由此确立的不变量

- 每个正式发布的 skill 都必须出现在 `.claude-plugin/plugin.json` 的 `skills` 数组中。此前这已是 `CLAUDE.md` 的规则，现在也决定插件的内容。
- `.claude-plugin/plugin.json` 的 `version` 跟随 `package.json` 的版本，发布时一并递增。Claude 通过插件的 `version` 决定已安装用户何时获得更新。

## 2026-08-05 更新

`mattpocock-skills` 已进入 **Claude Code 官方 marketplace**，配置名称为 `claude-plugins-official`，源仓库为 `anthropics/claude-plugins-official`。每次安装 Claude Code 都默认包含它。现在文档中的安装方式是 `claude plugins install mattpocock-skills`，取代上述 `marketplace add` → `install` 流程。安装用语保存在 [.agents/install-block.md](../install-block.md)。

官方条目指向本仓库的 Git URL，直接读取 `.claude-plugin/plugin.json`，不依赖 `.claude-plugin/marketplace.json`。保留后者，只作为直接安装仓库的备用入口，例如安装尚未发布的提交或 fork。

2026-08-05 在 Claude Code 2.1.222 上对线上条目完成以下验证：

- 无需先添加 marketplace，`claude plugins install mattpocock-skills` 即可解析，并显示 `mattpocock-skills@claude-plugins-official`。
- 随后执行 `claude plugin details mattpocock-skills`，显示版本 1.2.0，并加载正式发布的 skills。
- 条目的 `source` 是 `{"source": "url", "url": "https://github.com/mattpocock/skills.git", "sha": …}`。其中 **SHA 已固定**，已安装用户要等该指针更新才会收到发布版本，打 tag 的那一刻不会立即更新。写作时该指针落后 `main` 两个提交，所以列出 22 个 skills，而 `plugin.json` 中有 24 个。
- 会话内的 `/plugin install mattpocock-skills` **未测试**，因为无界面会话（`claude -p`）中不可用 `/plugin`。它使用与 CLI 相同的解析器，文档示例为 `/plugin install <name>@claude-plugins-official`。

## 2026-10-07 更新

上述 Codex 限制已不再成立。Codex 的 `main` 接受 `skills` 字符串数组，没有 `.codex-plugin/` 时会回退到 `.claude-plugin/`（见 [manifest.rs](https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/manifest.rs)）。Codex 仍会丢弃符号链接。

在 Codex 0.161.0 上，通过 `@mattpocock` marketplace 安装，会加载正式发布的模型调用型 skills，不会加载 `misc/` 或 `in-progress/` 中的内容。Copilot CLI 读取同样的清单，显示“Installed 27 skills”。

## 2026-10-08 更新：优先使用托管安装

Codex、Copilot 和 VS Code 现在优先使用 `@mattpocock`。Copilot 需要一次性启用自动更新。Claude Code 仍按 2026-08-05 的更新使用 `claude-plugins-official`，因为它默认自动更新，无需 `marketplace add`。

上述版本不变量现在适用于所有托管安装入口。`npm run version` 已通过执行 `scripts/sync-plugin-version.mjs` 保持一致。`marketplace.json` 没有 `version` 字段，所以不存在版本漂移。
