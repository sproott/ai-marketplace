#!/usr/bin/env bash
# Audit every APM package in a repo. `apm audit` only sees the dir it runs from,
# so in a monorepo a root-only audit misses stale package mirrors. This walks
# every apm.yml directory and audits each one.
#
# Usage: audit-all.sh [root]   (root defaults to the current directory)
# Exit:  0 if every package is clean, 1 if any package fails or errors.
set -u

root=${1:-.}
if ! command -v apm >/dev/null 2>&1; then
  echo "error: 'apm' not found on PATH" >&2
  exit 2
fi

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
  out=$(cd "$dir" && apm audit --ci 2>&1)
  code=$?
  drift=$(printf '%s\n' "$out" | grep -oE 'Drift detected: [0-9]+ file' | head -1)
  if [ $code -eq 0 ]; then
    printf 'PASS  %s\n' "$dir"
  else
    fail=1
    printf 'FAIL  %s  %s\n' "$dir" "${drift:-(exit $code)}"
  fi
done

exit $fail
