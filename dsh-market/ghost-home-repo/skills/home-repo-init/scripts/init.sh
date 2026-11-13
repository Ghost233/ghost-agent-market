#!/bin/bash
# init.sh - 初始化 Home Repo

set -e

echo "=== Home Repo 初始化 ==="
echo ""

# 1. 检查是否是 git 仓库
if [ ! -d .git ]; then
  echo "初始化 git 仓库..."
  git init
  echo "✓ git 仓库初始化完成"
else
  echo "✓ 当前目录已经是 git 仓库"
fi

echo ""

# 2. 创建目录结构
echo "创建目录结构..."
mkdir -p scripts templates docs/standards
echo "✓ 目录结构创建完成"

echo ""

# 3. 创建 AGENTS.md
if [ -f AGENTS.md ]; then
  echo "⚠ AGENTS.md 已存在，跳过创建"
else
  echo "创建 AGENTS.md..."
  cat > AGENTS.md << 'AGENTSEOF'
# Home Repo

跨仓库协调中心。

## 仓库地图

| 仓库 | 路径 | 说明 |
|------|------|------|
| 示例仓库 | ../path/to/repo | 仓库说明 |

## 跨仓库 Feature 流程

1. 在本仓库讨论总设计，创建总 issue
2. 拆任务到各仓库，创建仓库 issue（引用总 issue）
3. 用 scripts/create-worktree.sh 创建 worktree
4. 启动子代理，prompt 里包含完整上下文
5. 子代理完成后，更新总 issue

## 子代理 Prompt 模板

见 templates/subagent-prompt.md。

## 规范

跨仓库规范见 docs/standards/。
AGENTSEOF
  echo "✓ AGENTS.md 创建完成"
fi

echo ""

# 4. 创建 .gitignore
if [ -f .gitignore ]; then
  echo "⚠ .gitignore 已存在，跳过创建"
else
  echo "创建 .gitignore..."
  cat > .gitignore << 'GITEOF'
# macOS
.DS_Store

# 构建产物
**/node_modules/
**/build/
**/dist/
**/target/
**/.dart_tool/
**/Pods/
**/.gradle/

# 临时文件
*.log
*.tmp
GITEOF
  echo "✓ .gitignore 创建完成"
fi

echo ""

# 5. 创建 create-worktree.sh
echo "创建 scripts/create-worktree.sh..."
  cat > scripts/create-worktree.sh << 'WTEOF'
#!/bin/bash
# create-worktree.sh <repo-path> <issue-number> <slug>
# 例如: ./scripts/create-worktree.sh ../Ghost233Code/GhostNexus 45 vpn-reconnect

set -e

REPO_PATH=$1
ISSUE=$2
SLUG=$3

if [ -z "$REPO_PATH" ] || [ -z "$ISSUE" ] || [ -z "$SLUG" ]; then
  echo "用法: $0 <repo-path> <issue-number> <slug>"
  echo "例如: $0 ../Ghost233Code/GhostNexus 45 vpn-reconnect"
  exit 1
fi

# 解析为绝对路径
REPO_PATH="$(cd "$REPO_PATH" && pwd)"
REPO_NAME=$(basename "$REPO_PATH")
WORKTREE_BASE="${REPO_PATH}.worktrees"
WORKTREE_DIR="${WORKTREE_BASE}/${ISSUE}-${SLUG}"

# 创建 worktree 父目录
mkdir -p "$WORKTREE_BASE"

# 创建 worktree
echo "创建 worktree: $WORKTREE_DIR"
git -C "$REPO_PATH" worktree add "$WORKTREE_DIR" -b "fix/${ISSUE}-${SLUG}"

# 写上下文文件
cat > "$WORKTREE_DIR/.agent-context.md" << CTXEOF
# 当前任务上下文

**这个文件属于 ${REPO_NAME} 的 Issue #${ISSUE} 任务。**
**如果你不是被分派到这个任务的 agent，请忽略这个文件。**

---

- issue: ${REPO_NAME}#${ISSUE}
- branch: fix/${ISSUE}-${SLUG}
- worktree: ${WORKTREE_DIR}
- created: $(date +%Y-%m-%d)
CTXEOF

echo "✓ Worktree 创建完成: $WORKTREE_DIR"
echo "✓ 上下文文件已写入: $WORKTREE_DIR/.agent-context.md"
WTEOF

chmod +x scripts/create-worktree.sh
echo "✓ create-worktree.sh 创建完成"

echo ""
echo "=== 初始化完成 ==="
echo ""
echo "下一步："
echo "1. 编辑 AGENTS.md，填写你的仓库地图"
echo "2. 提交到 git"
echo "3. 使用 home-repo-coordinate skill 协调跨仓库 feature"
