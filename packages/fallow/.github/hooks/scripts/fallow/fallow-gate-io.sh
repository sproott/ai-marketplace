#!/usr/bin/env bash
# Harness I/O for the vendored fallow-gate.sh, which reads only Claude Code's payload
# (`.tool_input.command`) and blocks by exit 2 with the reason on stderr/stdout.
#
#   Claude Code, VS Code Copilot Chat, Copilot CLI PascalCase: passed through untouched.
#   Copilot CLI camelCase (`toolArgs` JSON string): reshaped into the Claude payload on the
#   way in; a block comes back out as a top-level `permissionDecision: "deny"`.

set -uo pipefail

GATE="$(dirname "$0")/fallow-gate.sh"
PAYLOAD=$(cat)

if ! command -v jq >/dev/null 2>&1 || ! jq -e 'has("toolArgs")' >/dev/null 2>&1 <<<"$PAYLOAD"; then
  exec "$GATE" <<<"$PAYLOAD"
fi

CLAUDE_PAYLOAD=$(jq -c '{
  hook_event_name: "PreToolUse",
  session_id: .sessionId,
  cwd: .cwd,
  tool_name: .toolName,
  tool_input: (try (.toolArgs | fromjson) catch {})
}' <<<"$PAYLOAD")

OUT=$("$GATE" 2>&1 <<<"$CLAUDE_PAYLOAD")
STATUS=$?

if [ "$STATUS" -eq 2 ]; then
  jq -cn --arg reason "$OUT" '{permissionDecision: "deny", permissionDecisionReason: $reason}'
  exit 0
fi
[ -n "$OUT" ] && printf '%s\n' "$OUT" >&2
exit "$STATUS"
