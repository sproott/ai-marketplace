#!/usr/bin/env bash
# Deploy every APM package in a repo. `apm install` only writes the dir it runs
# from, so in a monorepo one root install leaves each package's own mirror stale.
# This runs `apm install` in every apm.yml directory. Pair with audit-all.sh
# (apm-audit-security) to verify nothing is left stale.
#
# Usage: install-all.sh [root] [-- <extra apm install args>]
#        root defaults to the current directory.
# Exit:  0 if every install succeeds, 1 if any fails.
set -u

root=.
extra=()
if [ $# -gt 0 ] && [ "$1" != "--" ]; then
  root=$1
  shift
fi
if [ $# -gt 0 ] && [ "$1" = "--" ]; then
  shift
  extra=("$@")
fi

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
  (cd "$dir" && apm install "${extra[@]}" >/dev/null 2>&1)
  code=$?
  if [ $code -eq 0 ]; then
    printf 'OK    %s\n' "$dir"
  else
    fail=1
    printf 'FAIL  %s  (exit %s)\n' "$dir" "$code"
  fi
done

exit $fail
