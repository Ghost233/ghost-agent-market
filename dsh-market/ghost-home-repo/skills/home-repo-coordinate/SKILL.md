---
name: home-repo-coordinate
description: 协调跨仓库 feature：创建 worktree、启动子代理、同步进度。
---

# Home Repo 跨仓库协调

这个 skill 协调跨仓库 feature 的开发，使用 DSH 原生子代理实现并行开发。

## 前置条件

- 当前目录是 Home Repo（已用 `home-repo-init` 初始化）
- 已经在 Home Repo 创建了总 issue
- 已经拆任务到各仓库，创建了仓库 issue（引用总 issue）

## 核心原则

**方案 B：Lead Agent 协调模式**

- Lead agent 在 Home Repo 里运行，负责协调
- 每个子代理只负责一个仓库的一个 issue
- 子代理之间不直接通信，所有跨仓库协调通过 lead agent
- 子代理的 prompt 里预先提供所有需要的上下文

## 流程

### 1. 读取总规格

```bash
gh issue view <issue-number> --repo <org>/<home-repo> --json body
```

### 2. 创建 worktree

对每个需要开发的仓库：

```bash
./scripts/create-worktree.sh <repo-path> <issue-number> <slug>
```

### 3. 准备子代理上下文

对每个子代理，准备：
- worktree 路径
- 仓库 issue 的详细需求
- 总规格的关键部分
- 项目规范（仓库的 AGENTS.md）
- 需要的接口定义（如果跨仓库依赖）

### 4. 启动子代理

用 DSH 的 `subagent` 工具：

```typescript
await tools.subagent({
  description: "<repo>: <task-summary>",
  cwd: "<worktree-path>",
  prompt: `按 templates/subagent-prompt.md 模板生成`
});
```

### 5. 协调

子代理运行期间：
- 定期检查进度
- 处理跨仓库的协调请求
- 如果发现子代理跑偏，发送纠正消息

### 6. 验证

子代理完成后：
- 检查它改的文件是否都在 worktree 里
- 确认没有改其他仓库的文件

### 7. 整合

- 更新总 issue 的 task list
- 合并各仓库的 PR

## 子代理 Prompt 模板

见 `templates/subagent-prompt.md`。

关键规则：
1. 只在指定 worktree 目录下工作
2. 不要读其他仓库的文件
3. 需要其他仓库信息时，在回复里告诉 lead agent
4. 完成后报告改了哪些文件、做了什么

## Worktree 上下文文件

每个 worktree 里有 `.agent-context.md`，记录：
- 当前任务的 issue
- 总规格的链接
- 分支名
- 职责范围

子代理启动时先读这个文件确认上下文。

## 故障处理

### 子代理跑偏了

发送纠正消息：

```typescript
await tools.send_message({
  agent: "<subagent-name>",
  message: "你改了其他仓库的文件，这超出了你的范围。请撤销这些改动，只改 <repo> 的文件。"
});
```

### 子代理需要其他仓库的信息

子代理会在回复里说明，lead agent 提供所需信息。

### 跨仓库接口变更

在总 issue 里讨论，更新总规格，然后通知所有相关子代理。
