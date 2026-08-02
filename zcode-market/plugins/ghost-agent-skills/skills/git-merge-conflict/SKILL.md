---
name: git-merge-conflict
description: 用户明确要求处理严重或高风险 merge、rebase 或 cherry-pick 冲突时使用；先考古两侧历史和共同基点，再逐块解决并验证。不用于简单空白、生成文件或 1–2 处 trivial 冲突。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# 高风险 Git 冲突考古

这是一条手动触发的高风险流程。没有历史证据，不得修改冲突内容；不得批量选择 ours/theirs，也不调用其他 Agent。

## 0. 锁定操作和考古边界

先在目标仓库运行：

```text
bash <skill-dir>/scripts/archaeology.sh --context
bash <skill-dir>/scripts/archaeology.sh --markers
```

记录 `operation`、`ours`、`theirs`、`base` 和冲突文件。若脚本没有检测到进行中的 merge/rebase/cherry-pick，停止。merge 使用唯一 merge-base；rebase/cherry-pick 使用被重放提交的父提交；重放 merge commit 必须由用户用 `--base <commit>` 指定正确父提交。

分歧很大时只增加考古深度，不改变安全规则：按目录在当前 Agent 内串行分析。

## 1. 逐文件理解意图

对每个冲突文件或冲突块：

1. 读取三方内容：
   ```text
   git show :1:<file>   # base
   git show :2:<file>   # ours/current
   git show :3:<file>   # theirs/incoming
   ```
2. 只在 `base..ours` 和 `base..theirs` 范围内运行 `git log --oneline`、`git log -p -S` 和必要的 `git blame`。
3. 记录每一侧的 commit、改动原因、影响范围和与另一侧的关系：正交、同目标不同方案、超集或无法判断。
4. 生成一张逐块决策表；无法解释的块保持未解决并请求用户判断。

## 2. 选择逐块策略

| 证据 | 策略 |
| --- | --- |
| 两侧修改不同路径且可同时成立 | 手动 union，复核依赖和副作用 |
| 一侧是另一侧的明确超集 | 只在该文件/区块采用超集，并记录理由 |
| 两侧解决同一问题但方案不同 | 基于历史和当前契约做取舍，不凭 diff 外观选择 |
| lock、生成代码或构建产物 | 从合并后的声明重新生成，不手改 |
| `project.pbxproj`、`xcodeproj` 或持久化 schema | 语义合并，随后运行项目级验证 |

只有考古证明改动互不冲突时才允许 union。任何策略都必须精确到文件或区块。

## 3. 执行和验证

手动编辑或对确认过的单个文件使用精确操作；禁止：

```text
git checkout --ours .
git checkout --theirs .
git merge -Xours
git merge -Xtheirs
```

每个文件完成后检查：

```text
git diff --check
git diff --name-only --diff-filter=U
rg -n '^<<<<<<<|^=======|^>>>>>>>' .
```

再按项目运行编译、类型检查和完整测试。测试失败时回到对应冲突块重新考古，不用测试结果掩盖未解释的意图。

## 4. 返回

报告 operation、ours/theirs/base、每个文件的考古结论和解决策略、验证命令及结果。除非用户明确要求，不自动创建 merge commit；未完成的冲突必须明确保留现场。
