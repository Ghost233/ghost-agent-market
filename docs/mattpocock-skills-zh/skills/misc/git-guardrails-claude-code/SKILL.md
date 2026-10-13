---
name: git-guardrails-claude-code
description: 配置 Claude Code hooks，在执行前拦截危险 Git 命令，例如 push、reset --hard、clean 和 branch -D。用户希望防止破坏性 Git 操作、添加 Git 安全 hooks，或在 Claude Code 中拦截 git push/reset 时使用。
---

# 配置 Git 防护

配置 PreToolUse hook，在 Claude 执行危险 Git 命令之前拦截。

## 拦截内容

- `git push`，包括 `--force` 在内的全部变体。
- `git reset --hard`。
- `git clean -f` / `git clean -fd`。
- `git branch -D`。
- `git checkout .` / `git restore .`。

拦截时，Claude 会看到一条消息，说明它无权使用这些命令。

## 步骤

### 1. 询问范围

询问用户：仅为**当前项目**安装（`.claude/settings.json`），还是为**所有项目**安装（`~/.claude/settings.json`）？

### 2. 复制 hook 脚本

随包脚本位于 [scripts/block-dangerous-git.sh](scripts/block-dangerous-git.sh)。

根据范围复制到目标位置：

- **项目**：`.claude/hooks/block-dangerous-git.sh`。
- **全局**：`~/.claude/hooks/block-dangerous-git.sh`。

用 `chmod +x` 设置可执行权限。

### 3. 在设置中添加 hook

添加到相应设置文件：

**项目**（`.claude/settings.json`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-dangerous-git.sh"
          }
        ]
      }
    ]
  }
}
```

**全局**（`~/.claude/settings.json`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/block-dangerous-git.sh"
          }
        ]
      }
    ]
  }
}
```

设置文件已存在时，将 hook 合并到已有 `hooks.PreToolUse` 数组，不覆盖其他设置。

### 4. 询问自定义要求

询问用户是否要在拦截列表中添加或移除模式，据此编辑复制后的脚本。

### 5. 验证

运行快速测试：

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | <path-to-script>
```

应以退出码 2 结束，并向 stderr 打印 BLOCKED 消息。
