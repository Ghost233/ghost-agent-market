# Home Repo

跨仓库协调中心。

## 仓库地图

| 仓库 | 路径 | 说明 |
|------|------|------|
| GhostNexus | ../Ghost233Code/GhostNexus | Flutter VPN app |
| GhostSplash | ../Ghost233Code/GhostSplash | 启动画面 |
| GhostModelDeck | ../Ghost233Code/GhostModelDeck | 模型管理 |
| ... | ... | ... |

## 跨仓库 Feature 流程

1. 在本仓库讨论总设计，创建总 issue
2. 拆任务到各仓库，创建仓库 issue（引用总 issue）
3. 用 `scripts/create-worktree.sh` 创建 worktree
4. 启动子代理，prompt 里包含完整上下文
5. 子代理完成后，更新总 issue

## 子代理 Prompt 模板

见 templates/subagent-prompt.md。

## Agent Team 协作约定

### 目录结构

- 主 checkout：`<repo>/`，只用于参考，不给 agent 工作
- Worktree：`<repo>.worktrees/<issue>-<slug>/`，agent 的工作区

### 子代理权限

每个子代理的 prompt 必须包含：

```
你的工作目录是 <worktree-path>。

权限：
- 读写：只允许在这个 worktree 里
- 只读：可以读其他仓库的主 checkout（../<repo>/），但不能改
- 禁止：不要读其他仓库的 worktree（../<repo>.worktrees/）和 .agent-context.md

如果需要其他仓库的配合，在总 issue 里评论。
```

### .agent-context.md 格式

每个 worktree 的 .agent-context.md 必须以这段开头：

```markdown
# 当前任务上下文

**这个文件属于 <repo> 的 <task-name> 任务。**
**如果你不是被分派到这个任务的 agent，请忽略这个文件。**
```

## 规范

跨仓库规范见 docs/standards/。
