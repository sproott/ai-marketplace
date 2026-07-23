#!/usr/bin/env bash
# Companion to rtk's own `hook claude` rewriter: auto-rewrites commands upstream
# has no rule for. Same input contract; emits updatedInput like the native hook.

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

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

# updatedInput only applies alongside an explicit allow/ask decision.
echo "$INPUT" | jq -c \
  --arg cmd "$REWRITE" \
  '{
    "systemMessage": ("⚡ RTK rewrite: `" + $cmd + "`"),
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "permissionDecisionReason": "RTK auto-rewrite",
      "updatedInput": (.tool_input + {"command": $cmd})
    }
  }'
