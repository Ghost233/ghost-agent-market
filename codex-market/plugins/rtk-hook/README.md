# rtk-hook

Codex plugin marketplace entry for the RTK `PreToolUse` hook.

This ports `Ghost233/rtk-hook` into `ghost-agent-market`. The hook asks `rtk rewrite` to classify every shell command and uses RTK's returned rewrite when one is supported. Unsupported and already-rewritten commands are left unchanged. Codex executes the result directly, without a denial or retry message.

The hook runs as a POSIX shell script and requires `jq` and `rtk` on `PATH`; Python is not required. Hook-side parse errors, missing commands, unsupported rewrites, and timeouts fail open so the original command can continue through Codex's normal flow.

## Install

```sh
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
codex plugin add rtk-hook@ghost-agent-market
```

Start a new Codex thread, then run `/hooks` and trust the `RTK Hook` hook.

## Update

```sh
codex plugin add rtk-hook@ghost-agent-market
```

Start a new thread after updating. If the hook changed, trust it again with `/hooks`.
