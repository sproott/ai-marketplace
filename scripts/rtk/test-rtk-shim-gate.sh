#!/usr/bin/env bash
# Standalone unit tests for rtk-shim-gate.sh — no vendor/rtk, no APM involved.
# Run: bash scripts/rtk/test-rtk-shim-gate.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/rtk-shim-gate.sh"

PASS=0
FAIL=0

# ---- assertion helpers ----

fail() {
  echo "FAIL: ${CURRENT_TEST}: $1" >&2
  : > "$FAILMARKER"
}

assert_eq() {
  local actual="$1" expected="$2" msg="$3"
  [ "$actual" = "$expected" ] || fail "$msg (expected [$expected], got [$actual])"
}

assert_contains() {
  local haystack="$1" needle="$2" msg="$3"
  case "$haystack" in
    *"$needle"*) ;;
    *) fail "$msg (expected to find [$needle] in [$haystack])" ;;
  esac
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="$3"
  case "$haystack" in
    *"$needle"*) fail "$msg (expected not to find [$needle] in [$haystack])" ;;
  esac
}

# ---- fixtures ----

nested_payload() {
  jq -nc '{"tool_name":"Bash","tool_input":{"command":"git status"}}'
}

copilot_cli_payload() {
  jq -nc --arg args '{"command":"git status"}' '{"toolName":"bash","toolArgs":$args}'
}

copilot_ide_payload() {
  jq -nc --arg args '{"command":"git status"}' '{"toolName":"run_in_terminal","toolArgs":$args}'
}

# Each test runs isolated in a subshell: fresh tmp dir, own HOME. Failures are
# recorded via a marker file, not a shared variable — subshell writes to
# variables don't propagate back to this process.
run_test() {
  local name="$1"
  local tmp
  tmp=$(mktemp -d)
  (
    export CURRENT_TEST="$name"
    export FAILMARKER="$tmp/.failed"
    export HOME="$tmp/home"
    mkdir -p "$HOME"
    export PATH="$PATH"
    "$name" "$tmp"
  )
  if [ -f "$tmp/.failed" ]; then
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
  rm -rf "$tmp"
}

# ---- tests: shim already active ----

test_passes_silently_when_shim_on_path() {
  export PATH="$HOME/.rtk/shim:$PATH"
  local out
  out=$("$HOOK" <<<"$(nested_payload)")
  local status=$?
  assert_eq "$status" "0" "an activated shim must not block Bash"
  assert_eq "$out" "" "an activated shim must produce no output"
}

# ---- tests: deny response schemas ----

test_denies_nested_host_under_hook_specific_output() {
  local out
  out=$("$HOOK" <<<"$(nested_payload)")
  assert_contains "$out" '"hookSpecificOutput"' \
    "Claude Code and VS Code Copilot Chat read the decision under hookSpecificOutput"
  assert_contains "$out" '"permissionDecision":"deny"' "should deny while the shim is off PATH"
  assert_contains "$out" "RTK shim not on PATH" "deny reason must state why Bash is blocked"
  assert_contains "$out" '.rtk/shim' "deny reason must carry the PATH line the user has to add"
}

test_denies_copilot_cli_at_top_level() {
  local out
  out=$("$HOOK" <<<"$(copilot_cli_payload)")
  assert_contains "$out" '"permissionDecision":"deny"' "should deny while the shim is off PATH"
  assert_not_contains "$out" '"hookSpecificOutput"' \
    "Copilot CLI reads the decision from the top level only"
}

test_denies_copilot_ide_at_top_level() {
  local out
  out=$("$HOOK" <<<"$(copilot_ide_payload)")
  assert_contains "$out" '"permissionDecision":"deny"' "should deny while the shim is off PATH"
  assert_not_contains "$out" '"hookSpecificOutput"' \
    "JetBrains Copilot reads the decision from the top level only"
}

test_denies_unrecognized_payload_in_every_schema() {
  local out
  out=$("$HOOK" <<<'{"unexpected":true}')
  assert_contains "$out" '"hookSpecificOutput"' \
    "an unplaceable payload must still deny for a nested-schema host"
  assert_contains "$out" '"permissionDecisionReason"' \
    "an unplaceable payload must still deny for a top-level-schema host"
}

test_denies_empty_payload() {
  local out
  out=$("$HOOK" </dev/null)
  assert_contains "$out" '"permissionDecision":"deny"' \
    "a host that pipes nothing must still be blocked, not waved through"
}

# ---- run ----

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t"
done

echo
echo "Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]
