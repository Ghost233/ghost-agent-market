#!/usr/bin/env bash
set -euo pipefail

# 从仓库根构建 WorkBuddy marketplace 可用的 release zip。
#
# 关键约束：zip 根必须【直接】包含 `.codebuddy-plugin/marketplace.json` 与 `plugins/`，
# 不能套一层仓库目录。原因：GitHub 自动生成的 archive.zip 会在最外层套一个
# `<repo>-<ref>/` 前缀，导致 WorkBuddy 找不到市场清单。所以这里只精准打包
# 市场布局所需的目录，而不是整个仓库。
#
# 用法：
#   ./tooling/build-workbuddy-marketplace-zip.sh [输出zip路径]
#   默认输出：仓库根/ghost-workflow-marketplace.zip

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT="${1:-ghost-workflow-marketplace.zip}"
rm -f "$OUT"

if [ ! -f .codebuddy-plugin/marketplace.json ]; then
  echo "❌ 未找到 .codebuddy-plugin/marketplace.json（请在仓库根执行或检查路径）" >&2
  exit 1
fi
if [ ! -d plugins/ghost-workflow-team ]; then
  echo "❌ 未找到 plugins/ghost-workflow-team（包源码缺失）" >&2
  exit 1
fi

zip -r "$OUT" .codebuddy-plugin plugins >/dev/null

echo "✅ 已生成 $OUT"
echo "   根目录内容（应只有 .codebuddy-plugin/ 与 plugins/）："
unzip -l "$OUT" | sed -n '4,40p'
