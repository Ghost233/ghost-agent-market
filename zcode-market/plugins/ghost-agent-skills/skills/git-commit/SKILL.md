---
name: git-commit
description: 用户明确要求提交当前授权改动时使用；递归处理已授权的 dirty submodule 并由父仓库记录 gitlink。不用于解释 Git、push 或改写历史。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# Git 提交

在当前 checkout 内提交用户明确授权的改动。不要创建 worktree、切分支、push、amend 或回滚。

## 流程

1. 读取当前仓库和上层 `AGENTS.md`，确认授权路径以及要求的 `user.name`/`user.email`；身份不匹配就停止。
2. 解析 skill 目录，运行检查：

   ```text
   python3 <skill-dir>/scripts/git_commit.py inspect --diff --repo <start-directory>
   ```

3. `has_changes=false` 且没有 dirty submodule 时返回无改动。冲突、未初始化但有变化、暂存 gitlink 未检出、敏感文件、越权路径或内容不明时停止。
4. 用户已授权提交 dirty submodule 时，从最深层开始逐仓库重复本流程；每层提交后重新检查父仓库的 gitlink。没有授权时不扩大范围。
5. 审查完整 diff，按职责拆成中文 Conventional Commit 批次。只把授权路径放入 plan：

   ```json
   {"head":"<inspect.head>","fingerprint":"<inspect.fingerprint>","batches":[{"paths":["file"],"message":"fix(scope): 中文说明"}]}
   ```

6. 将 plan 写到仓库外的临时文件，运行：

   ```text
   python3 <skill-dir>/scripts/git_commit.py apply --repo <repo-root> <plan.json>
   ```

   只接受脚本收据。脚本负责临时 index、批次校验和实际提交；不要直接运行 `git add` 或 `git commit`，不要使用 `--no-verify`。
7. 每层完成后核对提交 hash、gitlink、剩余改动和排除项。任何一笔提交完成后又失败，保留现场并停止，不回滚或自动清理。

## 失败边界

- 只允许脚本明确支持的普通 UTF-8 尾随空白/EOF 修复和未提交前的 Git 元数据权限重试。
- 冲突标记、非 UTF-8、符号链接、范围漂移、hook 修改批次外路径、身份不匹配或未知错误都停止。
- stdout/脚本 JSON 是唯一结果来源；返回每笔提交的仓库、hash、message、paths、修复和剩余状态。
