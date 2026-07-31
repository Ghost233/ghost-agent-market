#!/usr/bin/env bash
# git-merge-conflict 考古辅助脚本（只读，不修改任何文件）
#
# 用法：
#   archaeology.sh                   # 分析全部冲突文件
#   archaeology.sh <file>            # 只分析指定文件
#   archaeology.sh --markers         # 只扫冲突标记位置
#   archaeology.sh --context         # 只打印冲突上下文
#   archaeology.sh --base <commit>   # 为重放 merge commit 显式指定正确父提交
#
# 设计原则：以 merge-base 作为考古上界，只看 <base>..HEAD 和 <base>..THEIRS，
#          不无限回溯。base 太老时给出警告。

set -euo pipefail

MODE="all"
TARGET_FILE=""
BASE_OVERRIDE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --context)
      MODE="context"
      ;;
    --markers)
      MODE="markers"
      ;;
    --base)
      shift
      [ "$#" -gt 0 ] || { printf '错误: --base 需要一个 commit。\n' >&2; exit 2; }
      BASE_OVERRIDE="$1"
      ;;
    --base=*)
      BASE_OVERRIDE=${1#--base=}
      ;;
    --)
      shift
      [ "$#" -le 1 ] || { printf '错误: 只能指定一个文件。\n' >&2; exit 2; }
      if [ "$#" -eq 1 ]; then
        TARGET_FILE="$1"
        MODE="file"
      fi
      break
      ;;
    -* )
      printf '错误: 未知参数 %s\n' "$1" >&2
      exit 2
      ;;
    *)
      [ -z "$TARGET_FILE" ] || { printf '错误: 只能指定一个文件。\n' >&2; exit 2; }
      TARGET_FILE="$1"
      MODE="file"
      ;;
  esac
  shift
done

# ---------- 颜色（非 tty 时自动关闭）----------
if [ -t 1 ]; then
  C_HEAD='\033[1;36m'   # 标题
  C_OURS='\033[1;32m'   # ours（绿）
  C_THEIRS='\033[1;35m' # theirs（紫）
  C_BASE='\033[1;33m'   # base（黄）
  C_WARN='\033[1;31m'   # 警告（红）
  C_DIM='\033[2m'       # 暗淡
  C_RST='\033[0m'
else
  C_HEAD=''; C_OURS=''; C_THEIRS=''; C_BASE=''; C_WARN=''; C_DIM=''; C_RST=''
fi

# ---------- 固定仓库根目录，避免从子目录运行时漏掉冲突 ----------
START_PREFIX=$(git rev-parse --show-prefix 2>/dev/null) || {
  printf "${C_WARN}当前目录不在 Git 工作区中。${C_RST}\n" >&2
  exit 1
}
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1

if [ -n "$TARGET_FILE" ]; then
  case "$TARGET_FILE" in
    "$REPO_ROOT"/*) TARGET_FILE=${TARGET_FILE#"$REPO_ROOT"/} ;;
    /*) printf "${C_WARN}指定文件不在当前仓库内: %s${C_RST}\n" "$TARGET_FILE" >&2; exit 2 ;;
    *) TARGET_FILE="${START_PREFIX}${TARGET_FILE}" ;;
  esac
fi
cd "$REPO_ROOT"

# ---------- 定位冲突操作的两侧 ----------
# stage 2 始终对应 HEAD/current，stage 3 对应下方检测出的 incoming ref。
OURS_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
OURS_FULL=$(git rev-parse HEAD 2>/dev/null || echo "")
BRANCH_OURS=$(git branch --show-current 2>/dev/null || echo "(detached)")
[ -n "$BRANCH_OURS" ] || BRANCH_OURS="(detached)"

THEIRS_FULL=""
THEIRS_REF=""
OPERATION=""
if git rev-parse --verify -q MERGE_HEAD >/dev/null 2>&1; then
  THEIRS_FULL=$(git rev-parse MERGE_HEAD)
  THEIRS_REF="MERGE_HEAD"
  OPERATION="merge"
elif git rev-parse --verify -q REBASE_HEAD >/dev/null 2>&1; then
  THEIRS_FULL=$(git rev-parse REBASE_HEAD)
  THEIRS_REF="REBASE_HEAD"
  OPERATION="rebase"
elif git rev-parse --verify -q CHERRY_PICK_HEAD >/dev/null 2>&1; then
  THEIRS_FULL=$(git rev-parse CHERRY_PICK_HEAD)
  THEIRS_REF="CHERRY_PICK_HEAD"
  OPERATION="cherry-pick"
fi

THEIRS_SHORT=$( [ -n "$THEIRS_FULL" ] && git rev-parse --short "$THEIRS_FULL" || echo "?" )

if [ -z "$THEIRS_FULL" ]; then
  printf "${C_WARN}未检测到进行中的 merge / rebase / cherry-pick。请在冲突状态下运行此脚本。${C_RST}\n" >&2
  printf "${C_DIM}提示：若想预演冲突，可用 git merge-tree <base> <ours> <theirs>。${C_RST}\n" >&2
  exit 1
fi

# merge 的三方 base 是 merge-base；rebase/cherry-pick 重放单个普通提交时，
# base 是被重放提交的父提交。重放 merge commit 时必须由调用者指定 mainline 父提交。
BASE_KIND=""
if [ -n "$BASE_OVERRIDE" ]; then
  BASE_FULL=$(git rev-parse --verify "$BASE_OVERRIDE^{commit}" 2>/dev/null) || {
    printf "${C_WARN}无法解析 --base 指定的 commit: %s${C_RST}\n" "$BASE_OVERRIDE" >&2
    exit 2
  }
  BASE_KIND="显式指定"
elif [ "$OPERATION" = "merge" ]; then
  merge_bases=$(git merge-base --all "$OURS_FULL" "$THEIRS_FULL" 2>/dev/null || echo "")
  base_count=$(printf '%s\n' "$merge_bases" | awk 'NF { count++ } END { print count + 0 }')
  if [ "$base_count" -gt 1 ]; then
    printf "${C_WARN}检测到 %s 个 merge-base，index stage 1 可能是递归合成的虚拟 base；无法自动选择唯一历史上界。请核对后用 --base <commit> 显式指定。${C_RST}\n" \
      "$base_count" >&2
    printf '%s\n' "$merge_bases" >&2
    exit 2
  fi
  BASE_FULL="$merge_bases"
  BASE_KIND="merge-base"
else
  parent_count=$(git rev-list --parents --max-count=1 "$THEIRS_FULL" | awk '{print NF - 1}')
  if [ "$parent_count" -ne 1 ]; then
    printf "${C_WARN}%s 正在重放一个有 %s 个父提交的 commit；无法自动判断 mainline。请用 --base <正确父提交> 重试。${C_RST}\n" \
      "$OPERATION" "$parent_count" >&2
    exit 2
  fi
  BASE_FULL=$(git rev-parse "$THEIRS_FULL^" 2>/dev/null || echo "")
  BASE_KIND="被重放提交的父提交"
fi

[ -n "$BASE_FULL" ] || {
  printf "${C_WARN}无法确定冲突 base；停止考古，避免使用错误历史范围。${C_RST}\n" >&2
  exit 2
}
BASE_SHORT=$( [ -n "$BASE_FULL" ] && git rev-parse --short "$BASE_FULL" || echo "?" )

# ---------- 分歧距离（考古边界的关键指标）----------
ours_ahead=0; theirs_ahead=0; base_age_days="?"
if [ -n "$BASE_FULL" ]; then
  ours_ahead=$(git rev-list --count "$BASE_FULL".."$OURS_FULL" 2>/dev/null || echo 0)
  theirs_ahead=$(git rev-list --count "$BASE_FULL".."$THEIRS_FULL" 2>/dev/null || echo 0)
  # base 距今天数
  base_ts=$(git log -1 --format=%ct "$BASE_FULL" 2>/dev/null || echo 0)
  if [ "$base_ts" != "0" ]; then
    now_ts=$(date +%s)
    base_age_days=$(( (now_ts - base_ts) / 86400 ))
  fi
fi

# ---------- 冲突文件列表（兼容 bash 3.2；diff-files 不刷新/写入 index）----------
CONFLICT_FILES=()
while IFS= read -r -d '' line; do
  [ -n "$line" ] && CONFLICT_FILES+=("$line")
done < <(git diff-files --name-only --diff-filter=U -z 2>/dev/null || true)

# ============================================================
# 函数：打印合并上下文
# ============================================================
print_context() {
  printf "\n${C_HEAD}═══ 冲突上下文 ═══${C_RST}\n"
  printf "operation = %s\n" "$OPERATION"
  printf "${C_OURS}ours/current (stage 2)${C_RST}   = %s  (%s)\n" "$OURS_SHORT" "$BRANCH_OURS"
  printf "${C_THEIRS}theirs/incoming (stage 3)${C_RST} = %s  (%s)\n" "$THEIRS_SHORT" "$THEIRS_REF"
  printf "${C_BASE}history base${C_RST}              = %s  ${C_DIM}(%s，考古上界；index stage 1 内容用 git show :1:<file> 查看)${C_RST}\n" "$BASE_SHORT" "$BASE_KIND"
  if [ "$OPERATION" = "rebase" ]; then
    printf "${C_WARN}注意: rebase 中 ours 是已重放到 upstream 的当前序列，theirs 是正在重放的工作分支 commit；与按分支名称理解的两侧相反。${C_RST}\n"
  fi
  printf "\n"
  printf "${C_HEAD}── 分歧距离（base 之后的提交数）──${C_RST}\n"
  printf "  ours   领先 base: ${C_OURS}%s${C_RST} 个提交\n" "$ours_ahead"
  printf "  theirs 领先 base: ${C_THEIRS}%s${C_RST} 个提交\n" "$theirs_ahead"
  printf "  base 距今:        %s 天\n" "$base_age_days"

  # 边界警告：base 太老，考古会困难
  local warn=""
  if [ "$base_age_days" != "?" ] && [ "$base_age_days" -gt 180 ]; then
    warn="${warn}base 超过 180 天，两条分支可能已显著漂移；"
  fi
  local total=$((ours_ahead + theirs_ahead))
  if [ "$total" -gt 300 ]; then
    warn="${warn}两侧累计 ${total} 个提交，建议用子代理并行考古；"
  fi
  if [ -n "$warn" ]; then
    printf "\n${C_WARN}⚠ %s${C_RST}\n" "$warn"
  fi
  printf "\n"
}

# ============================================================
# 函数：扫描冲突标记位置
# ============================================================
print_markers() {
  printf "${C_HEAD}═══ 冲突标记位置 ═══${C_RST}\n"
  if [ ${#CONFLICT_FILES[@]} -eq 0 ]; then
    printf "${C_DIM}无未合并文件（git diff --diff-filter=U 为空）。${C_RST}\n"
    return
  fi
  local count=0
  for f in "${CONFLICT_FILES[@]}"; do
    [ -f "$f" ] || continue
    # 统计该文件的冲突块数（<<<<<<< 的个数）
    local n
    n=$(grep -c '^<<<<<<<' "$f" 2>/dev/null || true)
    n=${n:-0}
    printf "${C_WARN}  %s${C_RST}  ${C_DIM}(%s 处冲突块)${C_RST}\n" "$f" "$n"
    # 列出每处冲突块的行号
    while IFS=: read -r ln _; do
      [ -n "$ln" ] || continue
      printf "      ${C_DIM}L%s${C_RST}\n" "$ln"
    done < <(grep -n '^<<<<<<<' "$f" 2>/dev/null || true)
    count=$((count + n))
  done
  printf "\n${C_DIM}共 %s 个文件，%s 处冲突块。${C_RST}\n\n" "${#CONFLICT_FILES[@]}" "$count"
}

# ============================================================
# 函数：对单个文件做有界考古
#   只看 <base>..ours 和 <base>..theirs，不无限回溯
# ============================================================
print_file_archaeology() {
  local f="$1"
  local has_worktree_file=1
  if [ ! -f "$f" ]; then
    has_worktree_file=0
    printf "${C_WARN}工作树中没有普通文件: %s（可能是 delete/modify 或类型冲突，仍继续检查历史）。${C_RST}\n" "$f"
  fi

  printf "\n${C_HEAD}────────────────────────────────────────${C_RST}\n"
  printf "${C_HEAD}文件: %s${C_RST}\n" "$f"
  printf "${C_HEAD}────────────────────────────────────────${C_RST}\n"

  local n
  n=0
  if [ "$has_worktree_file" -eq 1 ]; then
    n=$(grep -c '^<<<<<<<' "$f" 2>/dev/null || true)
    n=${n:-0}
  fi
  printf "冲突块数: ${C_WARN}%s${C_RST}\n\n" "$n"

  # --- ours 侧：base 之后的提交（有界）---
  printf "${C_OURS}[ours 侧改动]${C_RST} ${C_DIM}base..%s${C_RST}\n" "$OURS_SHORT"
  if [ -n "$BASE_FULL" ]; then
    local ours_hits
    ours_hits=$(git log --oneline --no-decorate "$BASE_FULL".."$OURS_FULL" -- "$f" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$ours_hits" -eq 0 ]; then
      printf "  ${C_DIM}(无) — ours 自 base 起未改此文件${C_RST}\n"
    else
      git log -20 --oneline --no-decorate "$BASE_FULL".."$OURS_FULL" -- "$f" 2>/dev/null \
        | sed 's/^/  /'
      [ "$ours_hits" -gt 20 ] && printf "  ${C_DIM}... 还有 %s 个（仅显示前 20）${C_RST}\n" $((ours_hits - 20))
    fi
  fi

  # --- theirs 侧 ---
  printf "\n${C_THEIRS}[theirs 侧改动]${C_RST} ${C_DIM}base..%s${C_RST}\n" "$THEIRS_SHORT"
  if [ -n "$BASE_FULL" ]; then
    local theirs_hits
    theirs_hits=$(git log --oneline --no-decorate "$BASE_FULL".."$THEIRS_FULL" -- "$f" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$theirs_hits" -eq 0 ]; then
      printf "  ${C_DIM}(无) — theirs 自 base 起未改此文件${C_RST}\n"
    else
      git log -20 --oneline --no-decorate "$BASE_FULL".."$THEIRS_FULL" -- "$f" 2>/dev/null \
        | sed 's/^/  /'
      [ "$theirs_hits" -gt 20 ] && printf "  ${C_DIM}... 还有 %s 个（仅显示前 20）${C_RST}\n" $((theirs_hits - 20))
    fi
  fi

  # --- 冲突块代码摘要（前 3 处，每处 ours/theirs 各前几行）---
  printf "\n${C_DIM}[冲突块代码摘要]${C_RST}\n"
  if [ "$has_worktree_file" -eq 1 ]; then
    awk '
      /^<<<<<<< / {
        block++
        if (block > 3) { print "  ... 更多冲突块省略"; exit }
        side="ours"; shown_ours=0; shown_theirs=0
        print "  ── 块 " block " (L" NR") ──"
        next
      }
      /^=======$/ { side="theirs"; next }
      /^>>>>>>> / { side=""; next }
      side=="ours"   && shown_ours   < 5 { print "    ours  | " $0; shown_ours++; next }
      side=="theirs" && shown_theirs < 5 { print "    theirs| " $0; shown_theirs++; next }
    ' "$f" 2>/dev/null | sed 's/^/  /'
  else
    printf "  ${C_DIM}(无工作树文本可摘要；使用 git show :1:/:2:/:3: 检查索引 stages)${C_RST}\n"
  fi
  printf "\n"
}

# ============================================================
# 主逻辑
# ============================================================
case "$MODE" in
  context)
    print_context
    ;;
  markers)
    print_markers
    ;;
  all)
    # 默认：全部
    print_context
    print_markers
    if [ ${#CONFLICT_FILES[@]} -gt 0 ]; then
      printf "${C_HEAD}═══ 逐文件考古（base 为上界，不无限回溯）═══${C_RST}\n"
      for f in "${CONFLICT_FILES[@]}"; do
        print_file_archaeology "$f"
      done
    fi
    ;;
  file)
    # 指定文件
    print_context
    print_file_archaeology "$TARGET_FILE"
    ;;
esac

printf "${C_DIM}提示：先用 git show :1:<file> / :2:<file> / :3:<file> 查看三方，再在 %s..<ours|theirs> 范围内用 git log -p -S \"<代码片段>\" -- <file> 深挖。${C_RST}\n" "$BASE_SHORT"
