---
name: setup-owner-mode
description: 把 owner 模式运行时文件（owner-worker agent 定义 + enforce-scope/place-binding 两个 hook）铺设到当前项目。用户要求"启用 owner 模式""配置 owner-worker""setup owner"，或 start-owner-team 前置检查发现文件缺失时使用。幂等。
---

# Setup Owner Mode

owner 模式（start-owner-team）要求项目里有三个文件，CC 才能加载 `owner-worker` subagent 并让 enforce-scope hook 真正触发。这些文件随插件以 resources/ 形式发布，但 CC 会忽略 plugin agent 的 frontmatter hooks，所以必须由本 skill 脚本复制进项目 `.claude/agents/` 与 `.ghost-agent-workflow/hooks/`。

## 执行

取得当前 workspace 绝对路径（通常是 cwd 或 `$CLAUDE_PROJECT_DIR`），调用：

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-owner-mode.mjs" <workspace>
```

脚本幂等，行为：
- `resources/owner-worker.md` → `<workspace>/.claude/agents/owner-worker.md`
- `resources/hooks/enforce-scope.sh` → `<workspace>/.ghost-agent-workflow/hooks/enforce-scope.sh`（保留可执行位）
- `resources/hooks/place-binding.sh` → `<workspace>/.ghost-agent-workflow/hooks/place-binding.sh`（保留可执行位）
- 内容一致 → 跳过；内容不同 → 提示冲突、不覆盖、退出码 2。

## 完成后

- **若脚本提示"首次新建了 .claude/agents/"**：必须**重启 Claude Code 会话**，CC 才会加载 `owner-worker` subagent。重启前 `subagent_type="owner-worker"` 不可用。
- 若 `.claude/agents/` 早已存在（非首次），无需重启。
- 提示用户下一步：在 `<workspace>/.ghost-agent-workflow/owners/` 下创建 owner 定义（`<id>.md`，含 `id`/`responsibility`/`scope` frontmatter），然后跑 `/start-owner-team`。

## 不做

- 不创建 owner 定义（那是用户按任务边界划分的职责）。
- 不修改 `start-owner-team` skill 或任何脚本逻辑。
- 不在 codex 端做对应动作（codex 无 owner 模式）。
