#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${SKILLOPT_PYTHON:-}" ]]; then
  PYTHON="$SKILLOPT_PYTHON"
else
  PYTHON=""
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      version="$($candidate -c 'import sys; print(sys.version_info >= (3, 10))' 2>/dev/null || true)"
      if [[ "$version" == "True" ]]; then
        PYTHON="$candidate"
        break
      fi
    fi
  done
fi

if [[ -z "$PYTHON" ]]; then
  echo "skillopt-reinforce-10: Python 3.10 or later is required" >&2
  exit 1
fi

exec "$PYTHON" "$SCRIPT_DIR/reinforce_ten_rounds.py" "$@"
