---
description: 从 Ghost233/ghost-agent-market 在线安装全部 ZCode 用户级 role agent；默认保护已有文件。
argument-hint: "[--force]"
allowed-tools: Bash
---

执行全局 ZCode role agent 同步。这个命令只安装到用户级目录
`~/.zcode/agents/`，不创建项目级 agent，也不使用 clone、本地仓库、`--dest` 或离线文件。

默认执行下面的在线安装命令，不要自动添加 `--force`：

```bash
curl -fsSL https://raw.githubusercontent.com/Ghost233/ghost-agent-market/main/zcode-market/install-agents.py \
  | python3 -
```

脚本会先下载并检查全部模板，再开始写文件。已有文件内容不同于在线模板时，默认停止并列出冲突，不能覆盖已有用户修改；只有用户明确要求覆盖时，才执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Ghost233/ghost-agent-market/main/zcode-market/install-agents.py \
  | python3 - --force
```

不要在没有明确授权时重试 `--force`。完成后报告安装、覆盖和未变化的文件数量，并提示重启 ZCode 或开启新的 run 以加载更新。
