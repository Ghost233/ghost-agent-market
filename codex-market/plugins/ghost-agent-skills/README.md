# Ghost Agent Skills：Codex 试用版

用户要求先在 Codex 验证本轮流程，Claude Code / ZCode 保留旧版，验证通过后再同步。Matt 原版技能保持独立。

| 入口 | 职责 |
| --- | --- |
| `$ghost-matt-spec` | 规划与修订规格，明确模块合同和验收标准 |
| `$ghost-matt-ticket` | 拆解任务、依赖与并行边界 |
| `$ghost-matt-implement` | 当前分支执行一轮开发、测试与反思审查，停下讨论修改方向 |
| `$ghost-matt-run-test` | 单独运行指定测试并分析，默认不修复 |
| `$ghost-matt-test-report` | 只读汇总已有测试证据，不重新测试 |

五个入口通过规格、工单及测试证据衔接，可从已有产物继续，不必重新开始。规格与工单沿用项目约定；未配置时使用 `docs/specs/<主题>/`。实施按小轮次推进，本轮测试期间冻结候选，收齐结果后形成反思审查结论并停止；讨论确认后，下一轮可修复或继续开发，不自动连续执行。

旧 Codex 入口 `ghost-implement-spec`、`ghos-matt-run-test`、`ghos-matt-test-report` 已由上述新入口替代，不保留会加载旧流程的别名。其他 Git 和功能知识技能保留。

每个技能目录自包含：必需规则位于自己的 `SKILL.md`，整轮测试等较长内容位于该技能的 `references/`，可单独复制使用，不引用插件根目录或兄弟技能的文件。运行测试仅在用户授权修复时加载修复参考。

更新安装后在新任务中调用这些入口。现有任务可能仍持有旧版技能上下文。

## .ghswitch 命令前 hook

在项目根目录创建 `.ghswitch`，内容只写一行 GitHub 用户名：

```text
Ghost233
```

先在终端用 `gh auth login --hostname github.com` 登录该账号。启用后的 hook 使用 Bash（兼容 macOS 自带的 3.2）、`jq` 和 `gh`，无需 Python；`jq` 用于解析 hook 的 JSON 输入，缺失时会阻止调用并提示安装。更新插件并新开任务后，在 Codex 的 hook 审阅界面信任新定义；CLI 可用 `/hooks`。安装插件本身不会自动信任 hook，详见 [OpenAI Hooks 文档](https://learn.chatgpt.com/docs/hooks)。

当 Bash 工具调用包含直接执行的 `git` 或 `gh` 时，hook 依次运行：

```bash
gh auth switch --hostname github.com --user Ghost233
gh api --hostname github.com user --jq .login
```

实际身份必须与 `.ghswitch` 一致。未登录、切换失败、API 校验失败、身份不符或配置无效都会返回拒绝，阻止原工具调用；成功不自动批准原命令，继续使用正常权限流程。继承的 `GH_TOKEN` / `GITHUB_TOKEN` 仍参与身份校验，hook 不删除或展示 token。命令内改变认证环境变量会被拒绝，请在启动 agent 前配置。

入口先从 hook 的当前工作目录向父目录查找 `.ghswitch`，遇到 `.git` 目录或文件停止。没有配置时，仅做 Shell 内建的文件存在性判断后直接放行，不启动 `ghswitch.sh`，不读取 JSON，也不检查 `jq` 或 `gh`。启用开关以当前会话的项目为准；跨项目工作时应在对应项目启动会话。

启用后，主脚本从命令的工作目录向父目录查找账号配置，遇到 `.git` 目录或文件停止，不继承外层仓库配置。支持子目录、工具 `workdir`、静态 `cd`、`git -C`、常见命令链与管道、`command` / `exec` / `env` 和 `sh` / `bash` / `zsh -c`。同一调用涉及不同配置账号时，需要拆成分别执行的工具调用；动态目录使用明确的 `workdir`。没有目标账号配置或不涉及 Git/GitHub 的命令不切换账号。

覆盖范围是 agent 的 Bash 工具调用，每次调用预检一次。它不会拦截普通终端输入、交互会话后续输入或脚本内部的 Git 子进程，也不是完整 shell 解释器；复杂脚本应把 Git/GitHub 命令拆成直接的工具调用。账号切换会影响 `gh` 的全局活动账号，不同账号的项目应串行执行。它不修改 Git 提交身份或 SSH key；Git 网络认证仍取决于项目的协议和 credential helper。
