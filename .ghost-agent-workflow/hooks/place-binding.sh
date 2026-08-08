#!/bin/sh
# place-binding.sh —— teammate 首条指令自投放 owner 绑定指针。
# 用法: place-binding.sh <owner-id>
# 在当前 worktree（cwd）的 .ghost-agent-workflow/.runtime/owner-binding/ 写 pointer.json。
set -e
OWNER_ID="$1"
[ -z "$OWNER_ID" ] && { echo "place-binding: 缺 owner-id" >&2; exit 1; }

# 当前 worktree 根 = git 仓库根
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "place-binding: 不在 git 仓库内" >&2; exit 1; }

BINDING_DIR="$ROOT/.ghost-agent-workflow/.runtime/owner-binding"
mkdir -p "$BINDING_DIR"
cat > "$BINDING_DIR/pointer.json" <<EOF
{"owner_id":"$OWNER_ID","worktree":"$ROOT"}
EOF
echo "place-binding: 已投放 owner=$OWNER_ID 指针到 $BINDING_DIR/pointer.json"
