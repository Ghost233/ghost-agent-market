# Ghost Agent Skills Claude Code 插件

包含与 Owner/DAG 工作流解耦的 \`ghost-implement-spec\`、\`compile-feature-knowledge\`、\`git-commit\` 和 \`git-merge-conflict\` skill。\`ghost-implement-spec\` 复用 Matt 的 \`implement-spec\`，只覆盖全部子代理为 Sonnet。

推荐入口：

\`\`\`text
/ghost-agent-skills:ghost-implement-spec 按关联工单实施这份规格
/ghost-agent-skills:compile-feature-knowledge 整理当前功能知识
/ghost-agent-skills:git-commit 检查当前改动并创建清晰的 Git 提交
/ghost-agent-skills:git-merge-conflict 考古两侧历史并解决当前严重的 Git 冲突
\`\`\`

## .ghswitch 命令前 hook

在项目根目录创建 `.ghswitch`，内容只写一行 GitHub 用户名：

```text
Ghost233
```

先在终端用 `gh auth login --hostname github.com` 登录该账号。启用后的 hook 使用 Bash（兼容 macOS 自带的 3.2）、`jq` 和 `gh`，无需 Python；`jq` 用于解析 hook 的 JSON 输入，缺失时会阻止调用并提示安装。更新插件并重启 Claude Code 会话后，插件默认加载 `hooks/hooks.json`，详见 [Claude Code Hooks 文档](https://code.claude.com/docs/en/hooks)。

当 Bash 工具调用包含直接执行的 `git` 或 `gh` 时，hook 依次运行：

```bash
gh auth switch --hostname github.com --user Ghost233
gh api --hostname github.com user --jq .login
```

实际身份必须与 `.ghswitch` 一致。未登录、切换失败、API 校验失败、身份不符或配置无效都会返回拒绝，阻止原工具调用；成功不自动批准原命令，继续使用正常权限流程。继承的 `GH_TOKEN` / `GITHUB_TOKEN` 仍参与身份校验，hook 不删除或展示 token。命令内改变认证环境变量会被拒绝，请在启动 agent 前配置。

入口先从 hook 的当前工作目录向父目录查找 `.ghswitch`，遇到 `.git` 目录或文件停止。没有配置时，仅做 Shell 内建的文件存在性判断后直接放行，不启动 `ghswitch.sh`，不读取 JSON，也不检查 `jq` 或 `gh`。启用开关以当前会话的项目为准；跨项目工作时应在对应项目启动会话。

启用后，主脚本从命令的工作目录向父目录查找账号配置，遇到 `.git` 目录或文件停止，不继承外层仓库配置。支持子目录、工具 `workdir`、静态 `cd`、`git -C`、常见命令链与管道、`command` / `exec` / `env` 和 `sh` / `bash` / `zsh -c`。同一调用涉及不同配置账号时，需要拆成分别执行的工具调用；动态目录使用明确的 `workdir`。没有目标账号配置或不涉及 Git/GitHub 的命令不切换账号。

覆盖范围是 agent 的 Bash 工具调用，每次调用预检一次。它不会拦截普通终端输入、交互会话后续输入或脚本内部的 Git 子进程，也不是完整 shell 解释器；复杂脚本应把 Git/GitHub 命令拆成直接的工具调用。账号切换会影响 `gh` 的全局活动账号，不同账号的项目应串行执行。它不修改 Git 提交身份或 SSH key；Git 网络认证仍取决于项目的协议和 credential helper。
