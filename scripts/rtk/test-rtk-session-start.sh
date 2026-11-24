#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

should_render_context_when_session_starts() {
  local host="$1" payload="$2" query="$3"
  local home="$TMP/$host" out
  mkdir -p "$home"

  out=$(printf '%s' "$payload" | HOME="$home" bash "$SCRIPT_DIR/rtk-shim-install.sh")

  if ! jq -e "$query" <<<"$out" >/dev/null; then
    echo "FAIL: should render context when $host session starts" >&2
    exit 1
  fi
  if [ ! -L "$home/.rtk/shim/rtk" ]; then
    echo "FAIL: should install shim in isolated HOME when $host session starts" >&2
    exit 1
  fi
  echo "PASS: should render context when $host session starts"
}

nested='.hookSpecificOutput | .hookEventName == "SessionStart" and (.additionalContext | contains("RTK") and contains("rtk gain") and (contains("rtk skill") | not))'
should_render_context_when_session_starts claude '{"hook_event_name":"SessionStart","session_id":"test","source":"startup"}' "$nested"
should_render_context_when_session_starts vscode '{"hook_event_name":"SessionStart","session_id":"test","timestamp":"2026-01-01T00:00:00Z"}' "$nested"
should_render_context_when_session_starts copilot '{"sessionId":"test","source":"startup"}' '.additionalContext | contains("RTK") and contains("rtk gain") and (contains("rtk skill") | not)'

bun "$SCRIPT_DIR/../build-rtk-package.ts" --out "$TMP/package" > "$TMP/build.log"

if [ -e "$TMP/package/.apm/skills" ] || [ -e "$TMP/package/.apm/instructions" ]; then
  echo 'FAIL: should generate hooks only when building RTK' >&2
  exit 1
fi
echo 'PASS: should generate hooks only when building RTK'
