# GLOSSARY — ghost-home-repo 插件

## 子仓库 Skill（Subrepo Skill）

位于 Home Repo 一层子目录（即某个成员仓库）内的 .dsh/skills/ 或
.agents/skills/ 下的 skill。由本插件的发现 Provider 扫描并以带前缀名称
注册进 Home Repo 会话的 catalog。与"主目录 Skill"相对。

## 主目录 Skill（Root Skill）

位于 Home Repo 根目录自身 .dsh/skills/ 下的 skill，由 DSH 原生加载，
名字不带仓库前缀。本插件不介入。

## 名称归一化（Name Normalization）

将仓库目录名转为合法 skill 名前缀的规则：转小写 → 删除非小写字母与
非连字符字符 → 合并连续连字符 → 去首尾连字符。不分词、不拆驼峰。
见 ADR 0001 D2。

## 仓库标签（Repo Tag）

子仓库 Skill 的 description 前缀 "[原仓库名] "，是菜单中区分同名
skill 归属的显示手段（DSH catalog 无独立 displayName 字段）。
见 ADR 0001 D3。

## 发现 Provider（Discovery Provider）

本插件注册的动态 SkillProvider：list() 按 cwd 现场扫描子仓库 skill，
get() 懒读 SKILL.md，chokidar 监听变更并 invalidate catalog。
