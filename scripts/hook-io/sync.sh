#!/usr/bin/env bash
# Copies the canonical hook_io.py into every package hooks dir whose scripts import it.
# APM deploys each package's hooks dir on its own, so the module cannot be shared by path.
# Run: bash scripts/hook-io/sync.sh [--check]

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CANONICAL="$ROOT/scripts/hook-io/hook_io.py"

status=0
for dir in $(grep -l '^import hook_io' "$ROOT"/packages/*/.apm/hooks/*.py | xargs -n1 dirname | sort -u); do
  if [ "${1:-}" = --check ]; then
    cmp -s "$CANONICAL" "$dir/hook_io.py" || { echo "drift: ${dir#"$ROOT"/}/hook_io.py" >&2; status=1; }
  else
    cp "$CANONICAL" "$dir/hook_io.py"
    echo "synced ${dir#"$ROOT"/}/hook_io.py"
  fi
done
exit "$status"
