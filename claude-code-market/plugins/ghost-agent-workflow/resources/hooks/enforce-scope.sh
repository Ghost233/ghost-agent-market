#!/bin/sh
# enforce-scope.sh —— 层 B-1 hook（正式版，阶段0验证通过）
# 从 stdin 读 PreToolUse payload，按 cwd → 绑定指针 → owner 定义 → scope 判断 file_path 是否越界。
# 越界或查不到身份 → deny（fail-closed）。scope 内 → exit 0 放行。
#
# 阶段0验证结论：
# - hook 进程环境有 CLAUDE_PROJECT_DIR（指向主仓库根），enforce-scope.sh 可用它找 owner 定义。
# - subagent 的 Bash 环境无 CLAUDE_PROJECT_DIR，故 place-binding.sh 不能依赖它（用 git rev-parse）。
# - cwd = worktree 根（CC 锚定正确）。
# - 绑定指针由 teammate 首条指令自投放（place-binding.sh），投放前任何写都被 fail-closed 拒绝。

INPUT=$(cat)

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

deny() {
  jq -nc --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# fail-closed: 关键字段缺失即拒绝
[ -z "$CWD" ] && deny "enforce-scope: cwd 缺失（fail-closed）"
[ -z "$FILE_PATH" ] && exit 0  # 非文件写工具，放行

# 1. 找 worktree 内的 owner 绑定指针
POINTER="$CWD/.ghost-agent-workflow/.runtime/owner-binding/pointer.json"
[ ! -f "$POINTER" ] && deny "enforce-scope: worktree 内无 owner 绑定指针——fail-closed（请先投放 place-binding）"
OWNER_ID=$(jq -r '.owner_id // empty' "$POINTER" 2>/dev/null)
[ -z "$OWNER_ID" ] && deny "enforce-scope: 绑定指针无 owner_id——fail-closed"

# 2. 读 owner 定义（CLAUDE_PROJECT_DIR 在 hook 进程内有值，指向主仓库根）
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
[ -z "$PROJECT_DIR" ] && PROJECT_DIR=$(cd "$CWD" && git rev-parse --show-toplevel 2>/dev/null)
OWNER_DEF="$PROJECT_DIR/.ghost-agent-workflow/owners/$OWNER_ID.md"
[ ! -f "$OWNER_DEF" ] && deny "enforce-scope: 找不到 owner 定义 $OWNER_DEF——fail-closed"

# 3. 从 owner 定义 frontmatter 读 scope（YAML scope 列表）
SCOPE=$(sed -n '/^scope:/,/^[^[:space:]-]/p' "$OWNER_DEF" | grep -E '^[[:space:]]*-[[:space:]]' | sed 's/^[[:space:]]*-[[:space:]]*//' | sed 's/[[:space:]]*$//')

# 4. 判断 file_path 相对 CWD 后是否落在 scope 内（目录前缀匹配，第一版不支持 glob）
case "$FILE_PATH" in
  "$CWD"/*) REL="${FILE_PATH#$CWD/}" ;;
  *) REL="$FILE_PATH" ;;
esac

IN_SCOPE=0
for pat in $SCOPE; do
  pat_clean=$(echo "$pat" | sed 's:/*$::')
  case "$REL" in
    "$pat_clean"/*|"$pat_clean") IN_SCOPE=1; break ;;
  esac
done

[ "$IN_SCOPE" = "1" ] && exit 0
deny "enforce-scope: $REL 不在 owner $OWNER_ID 的 scope 内"
