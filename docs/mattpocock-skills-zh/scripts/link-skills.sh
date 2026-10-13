#!/usr/bin/env bash
# 译者说明：本文件是维护参考副本。执行请使用 upstream/mattpocock-skills
# 完整子模块中的原脚本；本参考目录未镜像正式发布的 skill 目录。
set -euo pipefail

# 注意：此脚本仅用于开发，面向本仓库维护者。
# 它不是受支持的安装器。对它的修改或修改请求均不会获批。
#
# 将仓库中的所有 skills 链接到各代理运行环境使用的本地 skill 目录：
#   - ~/.claude/skills：Claude Code
#   - ~/.agents/skills：Codex 和其他兼容 Agent Skills 的运行环境
# 每项都是指向本仓库的符号链接，只需 `git pull` 即可更新已安装的 skills。

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DESTS=("$HOME/.claude/skills" "$HOME/.agents/skills")

# 一次收集仓库 skills，链接到每个目标目录。`deprecated/` 已退役，
# `misc/` 则保留但很少使用、未正式发布（见各分类 README）。
# 两者均不属于日常使用的 skill 目录，所以在这里跳过；其他排除
# 未正式发布 skills 的地方也采用同样做法。`in-progress/` 仍会链接：
# 它刻意公开以征求反馈，本地安装正是运行该反馈循环的地方。
names=()
srcs=()
while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  names+=("$(basename "$src")")
  srcs+=("$src")
done < <(find "$REPO/skills" -name SKILL.md -not -path '*/node_modules/*' -not -path '*/deprecated/*' -not -path '*/misc/*' -print0)

for DEST in "${DESTS[@]}"; do
  # 若 $DEST 是解析后指向本仓库的符号链接，就会将各 skill 的符号链接
  # 写回仓库自身的 skills/ 目录。检测到这种情况时退出，避免污染工作副本。
  if [ -L "$DEST" ]; then
    resolved="$(readlink -f "$DEST")"
    case "$resolved" in
      "$REPO"|"$REPO"/*)
        echo "错误：$DEST 是指向本仓库的符号链接（$resolved）。" >&2
        echo "删除它（rm \"$DEST\"）后重跑；脚本会重新创建实际目录。" >&2
        exit 1
        ;;
    esac
  fi

  mkdir -p "$DEST"

  for i in "${!names[@]}"; do
    name="${names[$i]}"
    src="${srcs[$i]}"
    target="$DEST/$name"

    if [ -e "$target" ] && [ ! -L "$target" ]; then
      rm -rf "$target"
    fi

    ln -sfn "$src" "$target"
    echo "已链接 $name -> $src（$DEST）"
  done
done
