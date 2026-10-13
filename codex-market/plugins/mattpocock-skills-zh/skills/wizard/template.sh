#!/usr/bin/env bash
#
# 向导逐步引导人类完成手工流程。
# 由 wizard skill 生成。
#
# “STAGES” 标记上方是向导库，不要手工修改。
# 在标记下方编写每个步骤对应的阶段。

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# 向导库：统一的交互体验，每个向导保持一致。
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi

# 编写者在阶段区块开头设置此值。
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # 本次写入 ENV_FILE 的 KEY
WRITTEN_SECRET=() # 本次设置的 secret NAME
SKIPPED=()        # 未能完成的事项（如缺少 gh）

# _clear 清空终端，让屏幕只显示当前步骤。
# 输出不指向终端时不清屏，让管道日志保持可读。
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1 && tput clear 2>/dev/null; then return 0; fi
  printf '\033[2J\033[3J\033[H'
}

# banner "Title" 显示开场说明，介绍向导用途。
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s 个阶段%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  由你操作浏览器；向导会说明具体步骤，\n' "$DIM"
  printf '  并记录你复制回来的值。随时按 Ctrl-C 停止，\n'
  printf '  稍后再次运行，已保存的值会被保留。%s\n' "$RESET"
  pause "准备开始了吗？"
}

# stage "Name" 清屏，再说明当前阶段和进度。
# 清屏使屏幕只保留当前步骤。
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ 阶段 %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." 输出普通说明行。
say()  { printf '  %s\n' "$1"; }
# step "..." 表示人类应在浏览器执行的一项操作。
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL 在用户浏览器中打开地址，跨平台并支持 WSL。
open_url() {
  local url="$1"
  printf '  %s↗ 正在打开%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else false; fi
  } >/dev/null 2>&1 || warn "无法打开浏览器，请手动访问： $url"
}

# pause "msg" 等待人类确认已完成手工操作。
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-按回车继续}" "$RESET"
  read -r _ || true
}

# confirm "question" 是 y/N 确认关卡，回答 yes 时返回成功。
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY 读取 ENV_FILE 中 KEY 的当前值，
# 还原 write_env 的单引号或普通 dotenv 双引号值。
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line value sq="'\\''"; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  value="${line#*=}"
  if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//"$sq"/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    [[ "$value" == *[\\\$\"]* ]] && return 1   # 含转义、$ 或双引号，无法安全还原，重新询问
  fi
  printf '%s' "$value"
}

# ask KEY "Prompt" 将输入存到 $KEY；再次运行时，
# 将现有 .env 值作为默认值（回车保留）。输入可见，适用于非 secret，
# 通过 Readline 编辑。遇到 EOF 且没有输入时失败。
ask() {
  local key="$1" prompt="$2" current input s=$'\001' e=$'\002' p rc=0
  current=$(_existing "$key" || true)
  # Readline 需要把颜色代码包在 \001..\002 中，才能正确定位光标。
  p="  $s$BOLD$e$prompt$s$RESET$e "
  [[ -n "$current" ]] && p+="$s$DIM$e[回车保留当前值]$s$RESET$e "
  read -e -r -p "$p" input || rc=1
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" 与 ask 相同，但隐藏输入。
ask_secret() {
  local key="$1" prompt="$2" current input rc=0
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[回车保留当前值]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || rc=1
  printf '\n'
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE 向 ENV_FILE 新增或更新 KEY='VALUE'，替换已有行，
# 并设置 $KEY，保持幂等。新建 ENV_FILE 使用权限 0600；
# 写入符号链接的目标，并保留已有文件权限。
write_env() {
  local key="$1" value="$2" tmp sq="'\\''"
  [[ -e "$ENV_FILE" ]] || (umask 077 && : > "$ENV_FILE")
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "${value//\'/$sq}" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  printf -v "$key" '%s' "$value"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ 已写入%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE 通过 gh 设置 GitHub Actions 仓库 secret。
# gh 不可用或未登录时，输出警告并记录待办。
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ 已设置%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (请手动设置： gh secret set $name)")
  warn "已跳过 GitHub secret $name：gh 尚未就绪，请稍后设置"
}

# set_var NAME VALUE 设置 GitHub Actions 仓库变量（非 secret）。
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ 已设置%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "已跳过 GitHub variable $name：gh 尚未就绪，请稍后设置"
}

# finish 清屏，再汇总已完成的配置。
finish() {
  _clear
  printf '\n%s%s  ✓ 配置完成%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "已向 $ENV_FILE 写入 ${#WRITTEN_ENV[@]} 个值： ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "已设置 ${#WRITTEN_SECRET[@]} 个 GitHub secret： ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "仍需手动完成："
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES：编写这个区块，人类每一步操作对应一个 stage()。
# 替换下方示例，将 TOTAL_STAGES 设为实际阶段数。
# 所有阶段都放在 run_wizard 内，并保留最后一行；这样 Bash 会在
# 第一次提示前解析整个文件，运行中编辑文件不会破坏后续解析。
# ──────────────────────────────────────────────────────────────────────────

run_wizard() {

TOTAL_STAGES=1

banner "Stripe 配置"

# ── 示例阶段：替换为实际步骤 ───────────────────────────
stage "Stripe：API keys"
say "获取 Stripe 测试密钥，保存到本地开发环境和 CI。"
open_url "https://dashboard.stripe.com/test/apikeys"
step "在 API keys 页面复制 Publishable key（以 pk_test_ 开头）。"
ask STRIPE_PUBLISHABLE_KEY "粘贴 Publishable key："
step "在 Secret key 行点击 Reveal test key，再复制它。"
ask_secret STRIPE_SECRET_KEY "粘贴 Secret key："
write_env STRIPE_PUBLISHABLE_KEY "$STRIPE_PUBLISHABLE_KEY"
write_env STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
set_secret STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"   # CI 需要这个值
# ──────────────────────────────────────────────────────────────────────────

finish
}

run_wizard "$@"; exit
