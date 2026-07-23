#!/usr/bin/env bash
# Standalone unit tests for rtk-rewrite-extra.sh — no vendor/rtk, no APM involved.
# Run: bash scripts/rtk/test-rtk-rewrite-extra.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/rtk-rewrite-extra.sh"

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

# ---- fixtures ----

run_hook() {
  local command="$1"
  jq -n --arg cmd "$command" '{"tool_input":{"command":$cmd}}' | "$HOOK"
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
    "$name" "$tmp"
  )
  if [ -f "$tmp/.failed" ]; then
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
  rm -rf "$tmp"
}

# ---- tests: rules ----

test_rewrites_build_sh_to_rtk() {
  local out
  out=$(run_hook "./build.sh")
  assert_contains "$out" '"updatedInput"' "rewrite must ride in updatedInput"
  assert_contains "$out" '"command":"rtk ./build.sh"' "should rewrite ./build.sh to rtk ./build.sh"
  assert_contains "$out" '"permissionDecision":"allow"' \
    "updatedInput only applies alongside an explicit allow/ask decision"
}

test_preserves_arguments_in_rewrite() {
  local out
  out=$(run_hook "./build.sh --release --target x86")
  assert_contains "$out" '"command":"rtk ./build.sh --release --target x86"' \
    "rewrite should carry the full command including arguments"
}

test_preserves_other_tool_input_fields() {
  local out
  out=$(jq -n '{"tool_input":{"command":"./build.sh","description":"Build project","timeout":60000}}' | "$HOOK")
  assert_contains "$out" '"description":"Build project"' \
    "updatedInput must keep tool_input fields other than command"
  assert_contains "$out" '"timeout":60000' \
    "updatedInput must keep tool_input fields other than command"
}

test_does_not_match_other_build_scripts() {
  local out
  out=$(run_hook "./scripts/build.sh")
  assert_eq "$out" "" "anchored pattern should not match ./scripts/build.sh"
}

# ---- tests: skip conditions ----

test_no_rewrite_for_unmatched_command() {
  local out
  out=$(run_hook "make all")
  assert_eq "$out" "" "unmatched command should produce no output"
}

test_skips_rtk_prefixed_command() {
  local out
  out=$(run_hook "rtk err ./build.sh")
  assert_eq "$out" "" "command already using rtk should be skipped"
}

test_skips_heredoc_command() {
  local out
  out=$(run_hook "./build.sh <<EOF
stuff
EOF")
  assert_eq "$out" "" "command containing a heredoc should be skipped"
}

test_empty_command_exits_zero_silently() {
  local out
  out=$(echo '{"tool_input":{}}' | "$HOOK")
  local status=$?
  assert_eq "$status" "0" "missing command should exit 0"
  assert_eq "$out" "" "missing command should produce no output"
}

# ---- run ----

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t"
done

echo
echo "Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]
