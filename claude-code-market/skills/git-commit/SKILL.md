---
name: git-commit
description: 自动分析当前仓库未提交代码并直接提交。触发词：/git-commit、"提交代码"、"commit"。Claude Code 环境下由当前主会话直接执行只读 diff / submodule 分析、stage 和 commit；执行面固定为当前 checkout / same-directory，并严格按 submodule 到主工程顺序提交（无需确认）。
---

# Git 智能提交

自动分析未提交代码变更，生成提交信息并**直接提交**。当前 Claude Code 会话保留所有 git 读写操作，执行面固定为当前 checkout / same-directory。

提交顺序是硬约束：

1. 先提交 `git submodule`
2. 再提交主工程

主工程提交只在相关 submodule 提交完成后进行。

## 执行约束

- 执行面固定为当前 checkout / same-directory。
- 执行前用 `pwd` 确认在仓库根目录。
- 敏感文件保持未暂存：`.env`、credentials、密钥、token、证书。
- 提交前确认 Git identity 符合仓库要求。

## 工作流程

1. `pwd` - 确认当前目录。
2. `git status` - 查看主工程未提交文件。
3. `git diff --stat` 和 `git diff` - 分析主工程变更范围、风险和提交类型。
4. `git submodule status` - 判断是否存在 submodule 指针变更或脏 submodule。
5. 若存在脏 submodule：
   - 进入每个 submodule 查看 `git status` / `git diff`
   - 先在 submodule 内完成提交
   - 如果有嵌套 submodule，按最深层开始逐层向外提交
6. 回到主工程重新检查 `git status`。
7. 分析主工程剩余变更，包括新的 submodule 指针。
8. 生成中文提交信息：`<type>(<scope>): <描述>`。
9. stage 本批次文件并提交。
10. 显示提交结果和剩余工作区状态。

## Submodule 规则

- 只要 submodule 内有未提交改动，必须先提交 submodule，再提交主工程的 submodule 指针。
- submodule 提交和主工程提交拆成两笔独立提交。
- 如果用户要求“按顺序提交”，默认顺序就是：`submodule -> 主工程`。
- 如果 submodule 已提交、主工程只剩指针变更，主工程再单独提交一笔。
- 如果没有 submodule 改动，按普通单仓库提交流程执行。

## 提交类型

| 类型 | 触发词 |
|------|--------|
| feat | 新增、添加、创建、实现 |
| fix | 修复、解决、处理 |
| refactor | 重构、优化、改进 |
| docs | 文档、注释 |
| style | 格式 |
| test | 测试 |
| chore | 配置、依赖 |

## Scope 判断

- **ui**: 界面、视图、组件
- **api**: 接口、网络
- **data**: 数据、存储
- **util**: 工具
- **config**: 配置

## 合作者

每次提交末尾添加：

```text
Co-Authored-By: Nexus <nexus@xfinite.global>
```

## 注意

- 使用中文提交信息。
- 改动过大时按风险和职责拆分提交。
- 提交后显示 `git status` 和新提交 hash。
