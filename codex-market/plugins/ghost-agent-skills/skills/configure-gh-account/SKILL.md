---
name: configure-gh-account
description: "为项目配置独立的 gh 账号环境，复用已登录凭据并将 GH_CONFIG_DIR 写入项目的 .codex/config.toml；用于多个仓库并行操作 GitHub 时固定各自账号。"
---

# 配置项目 GitHub 账号

为目标仓库配置 GitHub.com 账号，配置入口固定为项目根目录的 `.codex/config.toml`。账号配置目录位于用户目录，项目文件只保存绝对路径。默认 gh 配置和其他项目的账号选择保持不变。

平台范围：本 skill 在 Claude Code 和 Codex 发布同一内容；Claude Code / ZCode 调用时也配置目标项目的 Codex 环境，配置不会自动作用于它们自身或普通终端。

## 1. 确定项目与账号

- 按用户指定路径定位 Git 根目录；未指定时使用当前仓库。只处理获准的目标项目。
- 读取目标项目的账号约束、已有 `.codex/config.toml`、根目录 `.gitignore` 和有效的 shell 环境设置。用 `git ls-files -- .codex/config.toml` 确认配置是否已跟踪；保留模型、权限、MCP、插件等其他配置，以及 TOML 注释。
- 账号以用户明确选择或项目明确约束为准；已有 `GH_CONFIG_DIR` 中的实际登录可用于确认当前绑定。仓库 owner、组织名和提交邮箱不能替代登录身份。选择仍不明确时，列出已登录账号并询问一次。
- 查询已登录账号时显式指定凭据来源目录，并清除本次命令的 `GH_TOKEN`、`GITHUB_TOKEN` 覆盖。使用隐藏 token 的 `gh auth status` 输出；凭据仅在后续导入过程中读取。

完成条件：目标根目录、GitHub 登录名、凭据来源目录和账号配置目录都已确定。默认账号目录为 `${XDG_CONFIG_HOME:-$HOME/.config}/gh-profiles/<登录名>`，写入 TOML 前展开为绝对路径。

## 2. 复用并验证登录

已有账号目录时，在该目录的环境中运行 `gh api --hostname github.com user --jq .login`，清除 token 覆盖，并忽略大小写比较实际登录与所选账号。匹配则复用。

需要初始化或纠正账号目录时，读取 [账号目录初始化](references/profile.md)，从指定账号的已有 gh 凭据导入。只有目标目录内的账号配置允许改变；所有登录、切换和校验命令显式设置 `GH_CONFIG_DIR`。项目规则要求 `gh auth switch` 时，也只在目标目录中执行。缺少登录、导入失败或身份不匹配时，报告原因，保留项目原配置，不启动交互网页登录或创建新 token。

完成条件：所选账号目录的真实 API 登录已匹配；初始化没有改写凭据来源目录的配置文件。读取 token 成功本身不构成身份验证。

## 3. 合并项目配置

添加或原位更新以下内容；路径使用步骤 1 确定的真实绝对路径，不把 `~`、`$HOME` 或示例占位符写入 TOML：

```toml
[shell_environment_policy.set]
GH_CONFIG_DIR = "/absolute/account/config/directory"

[shell_environment_policy.filters]
GH_TOKEN = "exclude"
GITHUB_TOKEN = "exclude"
```

- 使用 TOML 解析和保留注释的局部编辑；同名表只保留一份，修改前后均须可解析。不存在时创建项目的 `.codex/config.toml`。
- 沿用当前文件已有的环境过滤表示。已有旧式 `exclude` / `include_only` 数组时，将两种 token 变量追加到 `exclude`，保留原数组；同一配置层不混用旧式数组与 `filters` 表。
- 存在 include 白名单时，将 `GH_CONFIG_DIR` 纳入白名单，保留其他条目；规范过滤键按大小写不敏感处理，避免重复键。
- 显式 `set` 在排除之后生效。检查项目层及继承层是否设置了这两个 token；有覆盖时，在项目的 `set` 中将对应值设为空字符串，避免继承凭据恢复。其他环境变量保持原值。
- 项目层若已有无效 TOML、互斥过滤配置或受管理策略限制，先报告具体问题；只修复本次账号配置所需的部分，不重写整个配置文件。
- 将本机配置加入目标仓库根目录 `.gitignore`：已有有效忽略规则则复用，否则追加精确规则 `/.codex/config.toml`。保留其他规则与注释，不重复添加条目，也不扩大为忽略整个 `.codex/`。
- `.gitignore` 对已跟踪文件不生效。配置已跟踪时，先说明现有配置可能包含共享设置；用户已明确要求停止跟踪时，执行 `git rm --cached -- .codex/config.toml` 并保留磁盘文件。授权不明确时，先交付忽略规则，报告仍在跟踪，待用户决定后再写入本机账号路径。
- 用 `git check-ignore -q -- .codex/config.toml` 和 `git ls-files -- .codex/config.toml` 核对配置确实被忽略且未被跟踪；需要定位规则时使用 `git check-ignore -v`。已跟踪文件只添加了规则时，不能报告忽略已经生效。

完成条件：有效设置选择目标账号目录，token 覆盖已消除，配置已被 Git 忽略且未被跟踪，原有环境过滤和其他配置仍保留。已跟踪状态未解决时明确交付剩余事项。此操作不安装命令 hook，也不改变用户级 Codex 默认配置。

## 4. 核对 Git 与交付

配置影响 Codex 启动的命令，不会自动改变当前聊天已经加载的环境。先以显式账号目录验证 `gh api ... user --jq .login`，再核对项目文件；说明新开该仓库的聊天后用 `printenv GH_CONFIG_DIR` 和同一 API 命令确认实际加载。项目需受信任；不替用户全局信任目录。

检查 Git 远程协议和有效 credential helper。HTTPS 经 `gh auth git-credential` 获取凭据时可继承该环境；其他 helper 可能抢先提供凭据，SSH 则使用自己的 key。只配置 Codex 环境时保留 Git 作者、远程地址及 helper；若 Git 认证接线不足，明确报告尚需配置。只有用户同时要求配置 Git 认证时，才修改对应仓库的本地 helper，保留其他 host 的设置。

`git ls-remote origin HEAD` 可验证远程读取；公开仓库读取成功不能证明认证账号，也不能证明推送权限。只在实际协议和 helper 接线有证据时报告 Git 已使用所选账号。多项目请求分别验证各自目录与实际登录，默认 gh 配置保持不变。

交付目标配置文件、账号与目录、`.gitignore` 规则及实际跟踪状态、验证结果，以及新聊天的生效检查或 Git 尚需处理的部分。仅创建本 skill 时，不执行真实账号配置；账号目录初始化是调用本 skill 时的工作。

官方依据：[gh 环境变量](https://cli.github.com/manual/gh_help_environment)、[Codex 项目配置与 shell 环境](https://learn.chatgpt.com/docs/config-file/config-advanced)。
