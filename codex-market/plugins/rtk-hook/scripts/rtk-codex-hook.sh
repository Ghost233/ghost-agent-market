#!/bin/sh

# Fail open: a hook-side error must never block the original shell command.

truthy_jq='def value_truthy:
  if . == null or . == false then false
  elif type == "number" then . != 0
  elif type == "string" or type == "array" or type == "object" then length > 0
  else true
  end;'

resolve_plugin_root() {
  if [ -n "${PLUGIN_ROOT:-}" ]; then
    printf '%s\n' "$PLUGIN_ROOT"
    return 0
  fi

  script_directory=$(CDPATH= cd -P "$(dirname "$0")" 2>/dev/null && pwd -P) || return 1
  dirname "$script_directory"
}

read_shell_command() {
  printf '%s' "$hook_payload" | jq -er "
    $truthy_jq
    .tool_input? as \$snake_input
    | .toolInput? as \$camel_input
    | (if (\$snake_input | value_truthy) then \$snake_input
       elif (\$camel_input | value_truthy) then \$camel_input
       else {}
       end) as \$tool_input
    | if (\$tool_input | type) != \"object\" then \"\"
      else [\$tool_input.cmd?, \$tool_input.command?, .cmd?, .command?]
        | map(select(value_truthy))
        | (.[0] // \"\")
        | tostring
        | gsub(\"^\\\\s+|\\\\s+\$\"; \"\")
      end
  " 2>/dev/null
}

load_rules() {
  rtk_prefix=$(jq -er '
    if type != "object" then error("rules must be an object")
    elif has("prefix") then .prefix | select(type == "string" and length > 0)
    else "rtk"
    end
  ' "$rules_file" 2>/dev/null) || return 1

  rewrite_timeout=$(jq -er '
    if has("rewrite_timeout_seconds") then
      .rewrite_timeout_seconds | select(type == "number" and . > 0) | tostring
    else "3"
    end
  ' "$rules_file" 2>/dev/null) || return 1

  skip_unchanged=$(jq -er "
    $truthy_jq
    if has(\"skip_unchanged\") then (.skip_unchanged | value_truthy | tostring)
    else \"true\"
    end
  " "$rules_file" 2>/dev/null) || return 1
}

cleanup_runtime() {
  if [ -n "${rewrite_pid:-}" ]; then
    kill -KILL "$rewrite_pid" 2>/dev/null || true
  fi
  if [ -n "${timeout_pid:-}" ]; then
    kill "$timeout_pid" 2>/dev/null || true
  fi
  if [ -n "${rewrite_output_file:-}" ]; then
    rm -f "$rewrite_output_file"
  fi
}

run_rewrite() {
  "$rtk_prefix" rewrite "$shell_command" >"$rewrite_output_file" 2>/dev/null &
  rewrite_pid=$!

  (
    timer_sleep_pid=
    trap '
      if [ -n "${timer_sleep_pid:-}" ]; then
        kill "$timer_sleep_pid" 2>/dev/null || true
      fi
      exit 0
    ' 1 2 15
    sleep "$rewrite_timeout" &
    timer_sleep_pid=$!
    wait "$timer_sleep_pid" || exit 0
    timer_sleep_pid=
    kill -KILL "$rewrite_pid" 2>/dev/null
  ) </dev/null >/dev/null 2>&1 &
  timeout_pid=$!

  wait "$rewrite_pid"
  rewrite_status=$?
  rewrite_pid=

  kill "$timeout_pid" 2>/dev/null || true
  wait "$timeout_pid" 2>/dev/null || true
  timeout_pid=

  case "$rewrite_status" in
    0|3) return 0 ;;
    *) return 1 ;;
  esac
}

emit_rewrite() {
  jq -cn --arg command "$rewritten_command" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {command: $command}
    }
  }'
}

main() {
  command -v jq >/dev/null 2>&1 || return 0

  plugin_root=$(resolve_plugin_root) || return 0
  rules_file=$plugin_root/rules.json
  hook_payload=$(cat) || return 0
  shell_command=$(read_shell_command) || return 0
  [ -n "$shell_command" ] || return 0
  load_rules || return 0

  rewrite_output_file=$(mktemp "${TMPDIR:-/tmp}/rtk-codex-hook.XXXXXX") || return 0
  rewrite_pid=
  timeout_pid=
  trap cleanup_runtime 0
  trap 'exit 0' 1 2 15

  run_rewrite || return 0

  rewritten_command=$(jq -Rrs 'gsub("^\\s+|\\s+$"; "")' <"$rewrite_output_file" 2>/dev/null) || return 0
  [ -n "$rewritten_command" ] || return 0
  if [ "$skip_unchanged" = "true" ] && [ "$rewritten_command" = "$shell_command" ]; then
    return 0
  fi

  emit_rewrite 2>/dev/null || true
}

main "$@"
