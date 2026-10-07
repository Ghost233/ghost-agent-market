# 账号目录初始化

仅在目标账号目录缺少所选登录或实际登录不符时读取本文件。

先确定 `profile_account`（GitHub 登录名）、`profile_source_dir`（保存该账号现有登录的 gh 配置目录）和 `profile_dir`（目标账号目录）。凭据来源优先沿用用户提供的目录或现有 `GH_CONFIG_DIR`；未提供时检查 gh 默认目录 `${XDG_CONFIG_HOME:-$HOME/.config}/gh`。目录名不是登录证据，目标目录验证通过后才能绑定项目。

来源与目标目录先规范化为真实绝对路径。两者相同时，若该目录已登录所选账号，仅在目标目录执行 `gh auth switch --hostname github.com --user <登录名>` 后验证；否则从其他已有登录目录获取凭据，保留来源配置。

记录来源目录中 `hosts.yml`、`config.yml` 是否存在及其文件摘要，用于操作后核对；不输出文件内容。复用已有 token，不刷新其权限或撤销登录。

在同一次 Bash 调用中设置上述三个已确定的变量，再执行以下流程。token 只保存在进程内并通过标准输入导入，命令文本、输出和项目文件中均不写 token。避免开启 shell trace 或 `GH_DEBUG`。

```bash
(
  set +x
  : "${profile_account:?}" "${profile_source_dir:?}" "${profile_dir:?}"
  [ "$profile_source_dir" != "$profile_dir" ] || exit 1

  profile_token=$(env -u GH_TOKEN -u GITHUB_TOKEN -u GH_DEBUG \
    GH_CONFIG_DIR="$profile_source_dir" \
    gh auth token --hostname github.com --user "$profile_account") || exit 1
  [ -n "$profile_token" ] || exit 1

  mkdir -p "$profile_dir" || exit 1
  chmod 700 "$profile_dir" || exit 1

  printf '%s\n' "$profile_token" |
    env -u GH_TOKEN -u GITHUB_TOKEN -u GH_DEBUG \
      GH_CONFIG_DIR="$profile_dir" \
      gh auth login --hostname github.com --git-protocol https --with-token || exit 1
)
```

导入后，在清除 token 覆盖的目标目录环境中查询真实登录：

```bash
env -u GH_TOKEN -u GITHUB_TOKEN -u GH_DEBUG \
  GH_CONFIG_DIR="$profile_dir" \
  gh api --hostname github.com user --jq .login
```

只有实际登录与所选账号匹配、来源配置文件摘要仍一致时，继续修改项目 TOML。导入失败时保留已完成的实际结果，报告失败步骤，不用新 token、网页登录或全局账号切换绕过问题。gh 若采用文件存储，文件仍留在用户级账号目录，不复制到仓库。

依据：[读取指定账号的凭据](https://cli.github.com/manual/gh_auth_token)、[通过标准输入登录](https://cli.github.com/manual/gh_auth_login)。
