#!/bin/bash
# Switch and verify the project GitHub account before a Bash tool call.
# Compatible with macOS Bash 3.2. Never evaluate the pending command.

# A missing config is the normal disabled state, before dependencies or input.
ghswitch_dir=$(pwd -P)
while :; do
  [[ -e $ghswitch_dir/.ghswitch ]] && break
  [[ -e $ghswitch_dir/.git || $ghswitch_dir == / ]] && exit 0
  ghswitch_dir=${ghswitch_dir%/*}
  ghswitch_dir=${ghswitch_dir:-/}
done

deny() {
  jq -cn --arg reason "ghswitch: $1" '{hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: $reason
  }}'
  exit 0
}

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'ghswitch: 需要 jq 解析 hook JSON；请安装 jq。' >&2
  exit 2
fi
payload=$(cat)
if ! jq -e 'type == "object"' >/dev/null 2>&1 <<< "$payload"; then
  deny 'hook JSON 输入无效。'
fi
tool_name=$(jq -r '.tool_name // ""' <<< "$payload")
case "$tool_name" in
  Bash|exec_command|shell|shell_command) ;;
  *) exit 0 ;;
esac
pending=$(jq -r '.tool_input | (.command // .cmd // "") |
  if type == "array" then map(@sh) | join(" ")
  elif type == "string" then . else "" end' <<< "$payload" 2>/dev/null) || deny 'hook 命令输入无效。'
hook_cwd=$(jq -r '.cwd // ""' <<< "$payload")
workdir=$(jq -r '.tool_input.workdir // .tool_input.cwd // "."' <<< "$payload")

directory_at() {
  local base=$1 value=$2
  case "$value" in
    *'$'*|*'`'*|-) return ;;
    '~') value=$HOME ;;
    '~/'*) value=$HOME/${value#\~/} ;;
    '~'*) return ;;
  esac
  if [[ $value != /* ]]; then
    [[ -n $base ]] || return
    value=$base/$value
  fi
  (cd -P -- "$value" 2>/dev/null && pwd -P)
}

target_dirs=()

inspect_words() {
  local -a words=("$@")
  local index=0 count=${#words[@]} name option target
  while (( index < count )); do
    if [[ ${words[index]} =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      (( index += 1 ))
    else
      case "${words[index]}" in
        '!'|if|then|elif|do|'{'|'}') (( index += 1 )) ;;
        *) break ;;
      esac
    fi
  done
  while (( index < count )); do
    name=${words[index]##*/}
    case "$name" in
      command|exec|env) (( index += 1 )) ;;
      *) break ;;
    esac
    while (( index < count )); do
      option=${words[index]}
      if [[ $option == -* || $option =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        (( index += 1 ))
        case "$option" in -u|--unset) (( index += 1 )) ;; esac
      else
        break
      fi
    done
  done
  (( index < count )) || return 0
  name=${words[index]##*/}
  (( index += 1 ))
  case "$name" in
    cd)
      if (( index < count )); then
        location=$(directory_at "$location" "${words[count-1]}")
      fi
      ;;
    sh|bash|zsh)
      while (( index + 1 < count )); do
        if [[ ${words[index]} == -*c* ]]; then
          scan_commands "${words[index+1]}" "$location"
          break
        fi
        (( index += 1 ))
      done
      ;;
    git|gh)
      target=$location
      if [[ $name == git ]]; then
        while (( index < count )) && [[ ${words[index]} == -* ]]; do
          option=${words[index]}
          case "$option" in
            -C)
              (( index += 1 ))
              target=$(directory_at "$target" "${words[index]}")
              ;;
            -C?*) target=$(directory_at "$target" "${option#-C}") ;;
            -c|--git-dir|--work-tree|--namespace|--config-env) (( index += 1 )) ;;
          esac
          (( index += 1 ))
        done
      fi
      [[ -n $target ]] || deny '无法确定 git/gh 的工作目录；请使用工具的 workdir 或绝对路径分别执行。'
      target_dirs+=("$target")
      ;;
  esac
}

scan_commands() {
  local text=$1 location=$2 char next quote='' word='' started=0 index
  local -a words=() stack=()
  # Split only unquoted operators and whitespace; retain quoted argument text.
  for (( index=0; index<${#text}; index++ )); do
    char=${text:index:1}
    if [[ $quote == "'" ]]; then
      if [[ $char == "'" ]]; then quote=''; else word+=$char; fi
      continue
    fi
    if [[ $quote == '"' ]]; then
      case "$char" in
        '"') quote='' ;;
        '\')
          next=${text:index+1:1}
          case "$next" in
            '$'|'`'|'"'|'\') word+=$next; (( index += 1 )) ;;
            $'\n') (( index += 1 )) ;;
            *) word+=$char ;;
          esac
          ;;
        *) word+=$char ;;
      esac
      continue
    fi
    case "$char" in
      "'"|'"') quote=$char; started=1 ;;
      '\')
        (( index += 1 ))
        next=${text:index:1}
        if [[ $next != $'\n' ]]; then word+=$next; started=1; fi
        ;;
      '#')
        if (( started )); then
          word+=$char
        else
          while (( index < ${#text} )) && [[ ${text:index:1} != $'\n' ]]; do
            (( index += 1 ))
          done
          inspect_words "${words[@]}"
          words=()
        fi
        ;;
      ' '|$'\t'|$'\r')
        if (( started )); then words+=("$word"); word=''; started=0; fi
        ;;
      ';'|'&'|'|'|'('|')'|$'\n')
        if (( started )); then words+=("$word"); word=''; started=0; fi
        inspect_words "${words[@]}"
        words=()
        if [[ $char == '(' ]]; then
          stack+=("$location")
        elif [[ $char == ')' && ${#stack[@]} -gt 0 ]]; then
          location=${stack[${#stack[@]}-1]}
          unset "stack[${#stack[@]}-1]"
        fi
        ;;
      *) word+=$char; started=1 ;;
    esac
  done
  [[ -z $quote ]] || deny '命令引号未闭合；请分别执行简单命令。'
  if (( started )); then words+=("$word"); fi
  inspect_words "${words[@]}"
}

hook_cwd=$(directory_at "${hook_cwd:-$PWD}" "$workdir")
scan_commands "$pending" "$hook_cwd"
expected_user=''
for directory in "${target_dirs[@]}"; do
  while :; do
    config=$directory/.ghswitch
    if [[ -e $config ]]; then
      [[ -f $config && -r $config ]] || deny "$config 必须是可读文件。"
      user=$(cat "$config")
      user=${user#"${user%%[![:space:]]*}"}
      user=${user%"${user##*[![:space:]]}"}
      username_pattern='^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
      [[ $user =~ $username_pattern ]] || deny "$config 必须只包含一行 GitHub 用户名，例如 Ghost233。"
      if [[ -n $expected_user && $expected_user != "$user" ]]; then
        deny '同一工具调用涉及不同 .ghswitch 用户；请按项目分别执行。'
      fi
      expected_user=$user
      break
    fi
    [[ -e $directory/.git || $directory == / ]] && break
    directory=${directory%/*}
    directory=${directory:-/}
  done
done
[[ -n $expected_user ]] || exit 0
auth_names='(GH_TOKEN|GITHUB_TOKEN|GH_HOST|GH_CONFIG_DIR)'
auth_pattern="(^|[^A-Za-z0-9_])${auth_names}[[:space:]]*=|(-u[[:space:]]+|--unset[=[:space:]]+|unset[[:space:]]+)${auth_names}([^A-Za-z0-9_]|$)"
[[ ! $pending =~ $auth_pattern ]] || deny '命令中改变认证环境会使预检身份失效；请在启动 agent 前配置环境变量。'
[[ ${GH_HOST:-github.com} == github.com ]] || deny '当前 GH_HOST 环境不是 github.com；.ghswitch 目前只支持 github.com。'
command -v gh >/dev/null 2>&1 || deny '无法执行 gh；请检查 gh 安装和登录。'

result_file=$(mktemp "${TMPDIR:-/tmp}/ghswitch.XXXXXX") || deny '无法创建身份校验临时文件。'
trap 'rm -f "$result_file"' EXIT
run_gh() {
  local gh_pid guard_pid status
  gh "$@" > "$result_file" 2>/dev/null &
  gh_pid=$!
  (
    trap 'kill "$sleep_pid" 2>/dev/null; exit' TERM
    sleep 10 &
    sleep_pid=$!
    wait "$sleep_pid"
    kill "$gh_pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  guard_pid=$!
  wait "$gh_pid"
  status=$?
  kill "$guard_pid" 2>/dev/null
  wait "$guard_pid" 2>/dev/null
  return "$status"
}
run_gh auth switch --hostname github.com --user "$expected_user" ||
  deny "gh auth switch 失败或超时；请先登录 $expected_user，并检查 GH_TOKEN/GITHUB_TOKEN 是否覆盖了账号。"
run_gh api --hostname github.com user --jq .login ||
  deny 'gh api 失败或超时；请检查登录和网络。'
actual_user=$(tr '[:upper:]' '[:lower:]' < "$result_file")
expected_lower=$(printf '%s' "$expected_user" | tr '[:upper:]' '[:lower:]')
[[ $actual_user == "$expected_lower" ]] ||
  deny "实际 GitHub 身份与 .ghswitch 指定的 $expected_user 不符；请检查 GH_TOKEN/GITHUB_TOKEN 和 gh 登录。"
# Silence leaves the original command's normal permission flow in place.
