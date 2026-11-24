#!/usr/bin/env bash
# Audit every APM package in a repo. `apm audit` only sees the dir it runs from,
# so in a monorepo a root-only audit misses stale package mirrors. This walks
# every apm.yml directory and audits each one.
#
# Usage: audit-all.sh [root]   (root defaults to the current directory)
# Exit:  0 if every package is clean, 1 if any package fails or errors.
set -u

root=${1:-.}
for tool in apm jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' not found on PATH" >&2
    exit 2
  fi
done

# Discover apm.yml dirs, pruning vendored trees and build output.
mapfile -t manifests < <(
  find "$root" \
    \( -name apm_modules -o -name node_modules -o -name .git -o -name build -o -name dist \) -prune -o \
    -name apm.yml -print | sort
)

if [ ${#manifests[@]} -eq 0 ]; then
  echo "no apm.yml found under $root" >&2
  exit 2
fi

fail=0
for manifest in "${manifests[@]}"; do
  dir=$(dirname "$manifest")
  out=$(cd "$dir" && apm audit --ci --format json 2>/dev/null)
  code=$?
  if [ $code -eq 0 ]; then
    printf 'PASS  %s\n' "$dir"
  else
    fail=1
    printf 'FAIL  %s  (exit %s)\n' "$dir" "$code"
    printf '%s\n' "$out" | jq -r '.checks[] | select(.passed | not) | "      \(.name): \(.message)", (.details[] | "        - \(.)")' 2>/dev/null \
      || printf '      (no JSON report; run `apm audit --ci` in %s)\n' "$dir"
  fi
done

exit $fail
