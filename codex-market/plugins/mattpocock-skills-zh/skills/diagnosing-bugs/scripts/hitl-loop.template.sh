#!/usr/bin/env bash
# 有人参与的复现循环。
# 复制本文件，编辑下方步骤后运行。
# 代理运行脚本；用户在自己的终端按提示操作。
#
# 用法：
#   bash hitl-loop.template.sh
#
# 两个辅助函数：
#   step "<instruction>"          → 显示说明，等待回车
#   capture VAR "<question>"      → 显示问题，将回答读入 VAR
#
# 最后将记录值按 KEY=VALUE 输出，供代理解析。
#
# `capture` 会把记录值输出到终端供代理读取，
# 因此只记录观察结果，登录操作应作为 `step` 交给用户。

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [完成后按回车] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- 编辑下方 ---------------------------------------------------------

step "打开 http://localhost:3000 中的应用并登录。"

capture ERRORED "点击 Export 按钮。是否发生错误？（y/n）"

capture ERROR_MSG "粘贴错误信息（或输入 none）："

# --- 编辑上方 ---------------------------------------------------------

printf '\n--- 已记录 ---\n'
printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
