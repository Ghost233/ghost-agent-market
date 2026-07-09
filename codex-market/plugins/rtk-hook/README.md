# rtk-hook

Codex plugin marketplace entry for the RTK `PreToolUse` hook.

This ports `Ghost233/rtk-hook` into `ghost-agent-market`. The hook reads `rules.json`. Any shell command that is not already prefixed with `rtk` is blocked with a retry suggestion.

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
