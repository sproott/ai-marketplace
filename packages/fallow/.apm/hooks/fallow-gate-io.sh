#!/usr/bin/env bash
# Harness I/O for the vendored fallow-gate.sh, which reads only Claude Code's payload
# (`.tool_input.command`) and blocks by exit 2 with the reason on stderr/stdout.
#
#   Claude Code, VS Code Copilot Chat, Copilot CLI PascalCase: passed through untouched.
#   Copilot CLI camelCase (`toolArgs` JSON string): reshaped into the Claude payload on the
#   way in; a block comes back out as a top-level `permissionDecision: "deny"`.
#
# The gate audits its own working directory; from another worktree or a subdirectory it
# would judge a different tree against a different base.

set -uo pipefail

GATE="$(cd "$(dirname "$0")" && pwd)/fallow-gate.sh"
PAYLOAD=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exec "$GATE" <<<"$PAYLOAD"
fi

COPILOT=0
if jq -e 'has("toolArgs")' >/dev/null 2>&1 <<<"$PAYLOAD"; then
  COPILOT=1
  PAYLOAD=$(jq -c '{
    hook_event_name: "PreToolUse",
    session_id: .sessionId,
    cwd: .cwd,
    tool_name: .toolName,
    tool_input: (try (.toolArgs | fromjson) catch {})
  }' <<<"$PAYLOAD")
fi

# Move into the checkout the command commits to: `cd <dir> &&` or `git -C <dir>`, else the
# payload's cwd. Then up to the nearest fallow config, else the repository root.
cd "$(jq -r '.cwd // empty' <<<"$PAYLOAD")" 2>/dev/null

# xargs splits on shell quoting without running anything; an unbalanced quote yields no words.
mapfile -t WORDS < <(jq -r '.tool_input.command // empty' <<<"$PAYLOAD" | xargs -n1 printf '%s\n' 2>/dev/null)
if [ "${WORDS[0]:-}" = cd ] && [ "${WORDS[2]:-}" = "&&" ]; then
  cd "${WORDS[1]}" 2>/dev/null
fi
for i in "${!WORDS[@]}"; do
  if [ "${WORDS[i]}" = git ] && [ "${WORDS[i + 1]:-}" = -C ]; then
    cd "${WORDS[i + 2]:-.}" 2>/dev/null
  fi
done

has_fallow_config() {
  [ -f fallow.toml ] || [ -f .fallowrc.json ] || [ -f .fallowrc.jsonc ]
}

if REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) && cd -P .; then
  while ! has_fallow_config && [ "$PWD" != "$REPO_ROOT" ]; do
    cd ..
  done
fi

if [ "$COPILOT" -eq 0 ]; then
  exec "$GATE" <<<"$PAYLOAD"
fi

OUT=$("$GATE" 2>&1 <<<"$PAYLOAD")
STATUS=$?

if [ "$STATUS" -eq 2 ]; then
  jq -cn --arg reason "$OUT" '{permissionDecision: "deny", permissionDecisionReason: $reason}'
  exit 0
fi
[ -n "$OUT" ] && printf '%s\n' "$OUT" >&2
exit "$STATUS"
