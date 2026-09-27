#!/usr/bin/env bash
# Standalone unit tests for the shared hook_io.py harness layer, plus a drift check on the
# package copies.
# Run: bash scripts/hook-io/test-hook-io.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

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

# ---- fixtures ----

# Parses stdin as a payload and prints the result of a Python expression over `hook`.
parsed() {
  PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$SCRIPT_DIR" python3 -c '
import json, sys, hook_io
hook = hook_io.parse(json.load(sys.stdin), "PostToolUse")
print(json.dumps(eval(sys.argv[1]), sort_keys=True))
' "$1"
}

PATCH='*** Begin Patch
*** Update File: src/A.fs
@@
 let a = 1
-let b = 2
+let b = 3
*** Add File: src/B.fsx
+printfn "hi"
*** Delete File: src/C.fs
*** Update File: src/D.fs
*** Move to: src/E.fs
@@
+let e = 5
*** End Patch'

copilot_patch() {
  jq -nc --arg patch "$PATCH" \
    '{sessionId:"s",toolName:"apply_patch",toolArgs:$patch,toolResult:{resultType:"success",textResultForLlm:"Done."}}'
}

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

# ---- tests: input ----

test_should_read_claude_edit_as_one_change() {
  local out
  out=$(jq -nc '{session_id:"s",tool_name:"Edit",tool_input:{file_path:"a.py",old_string:"x",new_string:"y"}}' \
    | parsed '[hook.host.value, hook.tool, [c.__dict__ for c in hook.changes]]')
  assert_eq "$out" '["claude", "edit", [{"new_text": "y", "old_text": "x", "path": "a.py"}]]' \
    "a Claude Edit must become one change carrying old and new text"
}

test_should_read_claude_write_as_whole_file_change() {
  local out
  out=$(jq -nc '{tool_name:"Write",tool_input:{file_path:"a.py",content:"z"}}' \
    | parsed '[c.__dict__ for c in hook.changes]')
  assert_eq "$out" '[{"new_text": "z", "old_text": null, "path": "a.py"}]' \
    "a Write must carry the whole file with no old text"
}

test_should_decode_copilot_string_tool_args() {
  local out
  out=$(jq -nc --arg a '{"path":"a.py","old_str":"x","new_str":"y"}' '{toolName:"str_replace_editor",toolArgs:$a}' \
    | parsed '[hook.host.value, [c.path for c in hook.changes]]')
  assert_eq "$out" '["copilot", ["a.py"]]' "a JSON-string toolArgs must be decoded"
}

test_should_list_patch_files_left_behind() {
  local out
  out=$(copilot_patch | parsed '[c.path for c in hook.changes]')
  assert_eq "$out" '["src/A.fs", "src/B.fsx", "src/E.fs"]' \
    "a patch must yield updated, added and moved-to files, never deleted ones"
}

test_should_split_patch_hunks_into_old_and_new_text() {
  local out
  out=$(copilot_patch | parsed '[hook.changes[0].old_text, hook.changes[0].new_text, hook.changes[1].old_text]')
  assert_eq "$out" '["let a = 1\nlet b = 2", "let a = 1\nlet b = 3", null]' \
    "context lines belong to both sides; an added file has no old text"
}

test_should_read_copilot_bash_command() {
  local out
  out=$(jq -nc '{toolName:"bash",toolArgs:"{\"command\":\"ls\"}"}' | parsed 'hook.command')
  assert_eq "$out" '"ls"' "a Copilot bash command must be read from string toolArgs"
}

test_should_yield_no_changes_when_tool_args_unparseable() {
  local out
  out=$(jq -nc '{toolName:"edit",toolArgs:"{not json"}' | parsed 'hook.changes')
  assert_eq "$out" '[]' "an undecodable toolArgs must yield no changes"
}

test_should_read_vscode_payload_by_its_timestamp() {
  local out
  out=$(jq -nc '{timestamp:"t",tool_name:"create_file",tool_input:{filePath:"a.fs",content:"z"}}' \
    | parsed '[hook.host.value, hook.tool, [c.__dict__ for c in hook.changes]]')
  assert_eq "$out" '["vscode", "create_file", [{"new_text": "z", "old_text": null, "path": "a.fs"}]]' \
    "a snake_case payload with a timestamp must read as VS Code"
}

test_should_read_every_vscode_multi_replacement() {
  local out
  out=$(jq -nc '{timestamp:"t",tool_name:"multi_replace_string_in_file",tool_input:{explanation:"e",replacements:[
      {filePath:"a.fs",oldString:"x",newString:"y"},{filePath:"b.fs",oldString:"u",newString:"v"}]}}' \
    | parsed '[c.__dict__ for c in hook.changes]')
  assert_eq "$out" '[{"new_text": "y", "old_text": "x", "path": "a.fs"}, {"new_text": "v", "old_text": "u", "path": "b.fs"}]' \
    "each replacement must become its own change"
}

test_should_read_vscode_patch_from_input_key() {
  local out
  out=$(jq -nc --arg patch "$PATCH" '{timestamp:"t",tool_name:"apply_patch",tool_input:{input:$patch,explanation:"e"}}' \
    | parsed '[c.path for c in hook.changes]')
  assert_eq "$out" '["src/A.fs", "src/B.fsx", "src/E.fs"]' "a patch under tool_input.input must be parsed"
}

test_should_read_vscode_insert_edit_code_as_new_text() {
  local out
  out=$(jq -nc '{timestamp:"t",tool_name:"insert_edit_into_file",tool_input:{filePath:"a.fs",code:"let x = 1",explanation:"e"}}' \
    | parsed '[c.__dict__ for c in hook.changes]')
  assert_eq "$out" '[{"new_text": "let x = 1", "old_text": "", "path": "a.fs"}]' \
    "an insert edit must carry its code as new text"
}

# ---- tests: output ----

test_should_render_vscode_like_claude() {
  local out
  out=$(jq -nc '{timestamp:"t",tool_name:"create_file",tool_input:{}}' \
    | parsed '[hook_io.block(hook, "t"), hook_io.deny(hook, "r")]')
  assert_eq "$out" '[{"decision": "block", "hookSpecificOutput": {"additionalContext": "t", "hookEventName": "PostToolUse"}, "reason": "t"}, {"hookSpecificOutput": {"hookEventName": "PostToolUse", "permissionDecision": "deny", "permissionDecisionReason": "r"}}]' \
    "VS Code reads Claude's output schema"
}

test_should_render_claude_context_under_hook_specific_output() {
  local out
  out=$(jq -nc '{tool_name:"Edit",tool_input:{}}' | parsed 'hook_io.context(hook, "t")')
  assert_eq "$out" '{"hookSpecificOutput": {"additionalContext": "t", "hookEventName": "PostToolUse"}}' \
    "Claude reads context under hookSpecificOutput only"
}

test_should_append_copilot_context_to_tool_result() {
  local out
  out=$(copilot_patch | parsed 'hook_io.context(hook, "t")')
  assert_eq "$out" '{"additionalContext": "t", "modifiedResult": {"resultType": "success", "textResultForLlm": "Done.\n\nt"}}' \
    "Copilot gets top-level context and the text on the tool result"
}

test_should_render_claude_block_as_decision() {
  local out
  out=$(jq -nc '{tool_name:"Edit",tool_input:{}}' | parsed '[hook_io.block(hook, "t")[k] for k in ("decision", "reason")]')
  assert_eq "$out" '["block", "t"]' "Claude block must carry decision and reason"
}

test_should_degrade_copilot_block_to_context() {
  local out
  out=$(copilot_patch | parsed 'hook_io.block(hook, "t") == hook_io.context(hook, "t")')
  assert_eq "$out" 'true' "Copilot has no post-tool block, so block must equal context"
}

test_should_render_deny_per_host() {
  assert_eq "$(jq -nc '{tool_name:"Write"}' | parsed 'hook_io.deny(hook, "r")')" \
    '{"hookSpecificOutput": {"hookEventName": "PostToolUse", "permissionDecision": "deny", "permissionDecisionReason": "r"}}' \
    "Claude deny must nest under hookSpecificOutput"
  assert_eq "$(jq -nc '{toolName:"apply_patch"}' | parsed 'hook_io.deny(hook, "r")')" \
    '{"permissionDecision": "deny", "permissionDecisionReason": "r"}' \
    "Copilot deny must sit at the top level"
}

# ---- tests: package copies ----

test_should_keep_package_copies_identical_to_canonical() {
  bash "$SCRIPT_DIR/sync.sh" --check 2>"$1/drift" || fail "package hook_io.py drifted: $(cat "$1/drift") — run just sync-hook-io"
}

# ---- run ----

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t"
done

echo
echo "Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]
