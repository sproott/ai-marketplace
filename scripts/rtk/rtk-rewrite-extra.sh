#!/usr/bin/env bash
# Companion to rtk's own native hook rewriter: auto-rewrites commands upstream
# has no rule for. Same input contract; answers in the host's own response schema.

set -euo pipefail

. "$(dirname "$0")/rtk-hook-io.sh"

PAYLOAD=$(cat)
FORMAT=$(hook_payload_format "$PAYLOAD")
CMD=$(hook_command "$FORMAT" "$PAYLOAD")

if [ -z "$CMD" ]; then
  exit 0
fi

case "$CMD" in
  rtk\ *|*/rtk\ *) exit 0 ;;
  *'<<'*) exit 0 ;;
esac

REWRITE=""

if echo "$CMD" | grep -qE '^\./build\.sh(\s|$)'; then
  REWRITE="rtk $CMD"
fi

if [ -z "$REWRITE" ]; then
  exit 0
fi

hook_rewrite_response "$FORMAT" "$PAYLOAD" "$REWRITE"
