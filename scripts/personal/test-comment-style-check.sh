#!/usr/bin/env bash
# Standalone unit tests for the personal package's comment_style_check.py hook.
# Run: bash scripts/personal/test-comment-style-check.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/../../packages/personal/.apm/hooks/comment_style_check.py"

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

EDIT_ARGS='{"path":"x.py","old_str":"a = 1","new_str":"a = 1\n# previously b"}'
SUCCESS_RESULT='{"resultType":"success","textResultForLlm":"File updated."}'

claude_payload() {
  jq -nc --argjson args "$EDIT_ARGS" '{"tool_name":"Edit","tool_input":$args}'
}

copilot_payload() {
  jq -nc --arg args "$EDIT_ARGS" '{"toolName":"edit","toolArgs":$args}'
}

copilot_payload_with_result() {
  jq -nc --arg args "$EDIT_ARGS" --argjson result "$SUCCESS_RESULT" \
    '{"toolName":"edit","toolArgs":$args,"toolResult":$result}'
}

copilot_payload_with_string_result() {
  jq -nc --arg args "$EDIT_ARGS" --arg result "$SUCCESS_RESULT" \
    '{"toolName":"edit","toolArgs":$args,"toolResult":$result}'
}

# Each test runs isolated in a subshell inside its own tmp dir, so the edited path
# resolves outside any git repo. Failures are recorded via a marker file.
run_test() {
  local name="$1"
  local tmp
  tmp=$(mktemp -d)
  (
    export CURRENT_TEST="$name"
    export FAILMARKER="$tmp/.failed"
    cd "$tmp" || exit 1
    "$name" "$tmp"
  )
  if [ -f "$tmp/.failed" ]; then
    FAIL=$((FAIL + 1))
  else
    PASS=$((PASS + 1))
  fi
  rm -rf "$tmp"
}

# ---- tests: argument shapes ----

test_warns_when_claude_payload_adds_banned_comment() {
  local out
  out=$(python3 "$HOOK" <<<"$(claude_payload)")
  assert_contains "$out" "narrates history" "an added history comment must be flagged"
  assert_contains "$out" '"hookSpecificOutput"' "Claude Code reads the warning under hookSpecificOutput"
}

test_warns_when_copilot_tool_args_is_json_string() {
  local out
  out=$(python3 "$HOOK" <<<"$(copilot_payload)")
  assert_contains "$out" "narrates history" \
    "Copilot CLI's string-encoded toolArgs must be decoded, not skipped"
}

test_stays_silent_when_tool_args_unparseable() {
  local out
  out=$(python3 "$HOOK" <<<'{"toolName":"edit","toolArgs":"{not json"}')
  assert_eq "$out" "" "an undecodable toolArgs must produce no output"
}

test_stays_silent_when_tool_args_decodes_to_non_object() {
  local out
  out=$(python3 "$HOOK" <<<'{"toolName":"edit","toolArgs":"[1,2]"}')
  assert_eq "$out" "" "a toolArgs that is not an object must produce no output"
}

# ---- tests: tool result channel ----

test_appends_to_result_when_tool_result_is_object() {
  local text
  text=$(python3 "$HOOK" <<<"$(copilot_payload_with_result)" | jq -r '.modifiedResult.textResultForLlm')
  assert_contains "$text" "File updated." "the original tool result must be kept"
  assert_contains "$text" "narrates history" "the warning must ride on the tool result"
}

test_appends_to_result_when_tool_result_is_json_string() {
  local text
  text=$(python3 "$HOOK" <<<"$(copilot_payload_with_string_result)" | jq -r '.modifiedResult.textResultForLlm')
  assert_contains "$text" "File updated." "the original tool result must be kept"
  assert_contains "$text" "narrates history" \
    "a string-encoded toolResult must be decoded, not crash the whole output"
}

# ---- run ----

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t"
done

echo
echo "Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]
