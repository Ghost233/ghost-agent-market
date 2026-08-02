# rtk-hook（ZCode）

这是 `rtk-hook` 的 ZCode 独立实现，单独放在 ZCode marketplace 中，之后可以
独立演进，不会自动同步 Codex 版本。

它注册一个 ZCode `PreToolUse` hook，匹配 `Bash` 工具，并把 shell 命令交给
本机的 `rtk rewrite`。RTK 支持改写时，hook 通过 ZCode 的 `updatedInput`
协议替换完整的工具输入；不支持、未改变、超时或 RTK 不可用时原样放行。

## 前置条件

需要先把 `rtk` 安装到 ZCode 能继承的 `PATH` 中，并确认以下命令可用：

```sh
rtk rewrite "git status"
```

## 在线安装

在 ZCode 中通过 `Settings -> Plugins -> Create -> Add marketplace` 添加在线
marketplace：

```text
Ghost233/ghost-agent-market
```

找到 `rtk-hook` 后点击 `Get` 并启用。启用或更新后请开启新的 ZCode session，
因为 hook 配置会在 session 启动时建立快照。

## 更新

在 ZCode 的 Marketplace sources 中刷新
`https://github.com/Ghost233/ghost-agent-market`，再检查插件更新并重新加载
新的 session。插件 hook 的源代码和 `hooks/hooks.json` 会以只读方式显示在
ZCode 的 Hook 设置中。

启用第三方 plugin 会授予其脚本本地执行权限；使用前应审查
`hooks/hooks.json`、`scripts/rtk-zcode-hook.py` 和 `rules.json`。
