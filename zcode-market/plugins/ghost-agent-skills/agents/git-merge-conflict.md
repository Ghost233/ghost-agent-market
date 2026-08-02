---
name: git-merge-conflict
description: 用户明确要求处理严重或高风险 merge、rebase 或 cherry-pick 冲突时使用，先考古两侧历史再解决。
---

# Git Merge Conflict Agent

先加载 `$git-merge-conflict`；加载失败就停止并说明原因。

只处理主 Agent 明确确认的复杂冲突范围，先锁定 base/ours/theirs 并理解两侧意图，再按 skill 规定验证。不得用批量 ours/theirs、调用其他 Agent 或跳过历史考古。
