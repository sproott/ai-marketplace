#!/usr/bin/env bash
# Standalone unit tests for the fsharp package's fsharplint_check.py hook.
# A stub `dotnet` on PATH stands in for FSharpLint; one integration case uses the real one.
# Run: bash scripts/fsharp/test-fsharplint-hook.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/../../packages/fsharp/.apm/hooks/fsharplint_check.py"
PYTHON=$(command -v python3)
REAL_PATH="$PATH"

PASS=0
FAIL=0
SKIP=0

# ---- assertion helpers ----

fail() {
  echo "FAIL: ${CURRENT_TEST}: $1" >&2
  : > "$FAILMARKER"
}

skip() {
  echo "SKIP: ${CURRENT_TEST}: $1" >&2
  : > "$SKIPMARKER"
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

# Logs "<cwd> <args>" per call. Reports the tool unrestored while STUB_UNRESTORED is set
# and no successful restore has run (or always, when STUB_UNRESTORED=always).
install_stub() {
  local bin="$1/bin"
  mkdir -p "$bin"
  cat > "$bin/dotnet" <<'STUB'
#!/usr/bin/env bash
echo "$PWD $*" >> "$STUB_LOG"
if [ "$1 $2" = "tool restore" ]; then
  code="${STUB_RESTORE_EXIT:-0}"
  [ "$code" = 0 ] && : > "$STUB_LOG.restored"
  exit "$code"
fi
if [ "${STUB_UNRESTORED:-}" = always ] || { [ -n "${STUB_UNRESTORED:-}" ] && [ ! -f "$STUB_LOG.restored" ]; }; then
  echo 'Run "dotnet tool restore" to make the "dotnet-fsharplint" command available.' >&2
  exit 1
fi
printf '%s' "${STUB_LINT_OUT:-}"
exit "${STUB_LINT_EXIT:-0}"
STUB
  chmod +x "$bin/dotnet"
  export PATH="$bin:$REAL_PATH"
  export STUB_LOG="$1/dotnet.log"
  : > "$STUB_LOG"
}

manifest() {
  local file="$1" tool="${2:-dotnet-fsharplint}"
  mkdir -p "$(dirname "$file")"
  jq -n --arg tool "$tool" \
    '{version:1,isRoot:true,tools:{($tool):{version:"0.27.0",commands:["dotnet-fsharplint"]}}}' \
    > "$file"
}

finding() {
  local file="$1" line="$2" rule="$3" message="$4"
  printf '%s(%s,1,%s,10):FSharpLint warning %s: %s\n' "$file" "$line" "$line" "$rule" "$message"
}

claude_write() {
  jq -nc --arg p "$1" '{tool_name:"Write",tool_input:{file_path:$p,content:"x"}}'
}

run_hook() {
  "$PYTHON" "$HOOK"
}

run_test() {
  local name="$1"
  local tmp
  tmp=$(mktemp -d)
  (
    export CURRENT_TEST="$name"
    export FAILMARKER="$tmp/.failed"
    export SKIPMARKER="$tmp/.skipped"
    cd "$tmp" || exit 1
    install_stub "$tmp"
    "$name" "$tmp"
  )
  if [ -f "$tmp/.failed" ]; then
    FAIL=$((FAIL + 1))
  elif [ -f "$tmp/.skipped" ]; then
    SKIP=$((SKIP + 1))
  else
    PASS=$((PASS + 1))
  fi
  rm -rf "$tmp"
}

# ---- tests: silent gates ----

test_should_emit_nothing_when_edited_file_is_not_fsharp() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_OUT="$(finding "$tmp/a.cs" 1 FL0001 m)" STUB_LINT_EXIT=255
  local out
  out=$(claude_write "$tmp/a.cs" | run_hook)
  assert_eq "$out" "" "a non-F# edit must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "a non-F# edit must not spawn dotnet"
}

test_should_emit_nothing_when_edited_file_is_signature_file() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  local out
  out=$(claude_write "$tmp/A.fsi" | run_hook)
  assert_eq "$out" "" "a .fsi edit must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "a .fsi edit must not spawn dotnet"
}

test_should_emit_nothing_when_tool_does_not_edit() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  local out
  out=$(jq -nc --arg p "$tmp/A.fs" '{tool_name:"Read",tool_input:{file_path:$p}}' | run_hook)
  assert_eq "$out" "" "a Read must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "a Read must not spawn dotnet"
}

test_should_emit_nothing_when_payload_has_no_path() {
  local out
  out=$(jq -nc '{tool_name:"Write",tool_input:{content:"x"}}' | run_hook)
  assert_eq "$out" "" "a payload without a path must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "a payload without a path must not spawn dotnet"
}

test_should_emit_nothing_when_no_tool_manifest_exists() {
  local tmp="$1"
  mkdir -p "$tmp/src"
  local out
  out=$(claude_write "$tmp/src/A.fs" | run_hook)
  assert_eq "$out" "" "no manifest up the tree must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "no manifest must not spawn dotnet"
}

test_should_emit_nothing_when_manifest_lacks_fsharplint() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json" fantomas
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$out" "" "a manifest without dotnet-fsharplint must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "a manifest without dotnet-fsharplint must not spawn dotnet"
}

test_should_emit_nothing_when_manifest_is_invalid_json() {
  local tmp="$1"
  mkdir -p "$tmp/.config"
  echo '{not json' > "$tmp/.config/dotnet-tools.json"
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$out" "" "an invalid manifest must produce no output"
  assert_eq "$(cat "$STUB_LOG")" "" "an invalid manifest must not spawn dotnet"
}

# ---- tests: manifest lookup ----

test_should_run_in_ancestor_config_manifest_root() {
  local tmp="$1"
  manifest "$tmp/repo/.config/dotnet-tools.json"
  mkdir -p "$tmp/repo/src/Lib"
  claude_write "$tmp/repo/src/Lib/A.fs" | run_hook >/dev/null
  assert_eq "$(cat "$STUB_LOG")" "$tmp/repo fsharplint --format msbuild lint $tmp/repo/src/Lib/A.fs" \
    "lint must run once, from the manifest root, on the absolute file path"
}

test_should_find_bare_manifest_in_ancestor() {
  local tmp="$1"
  manifest "$tmp/repo/dotnet-tools.json"
  mkdir -p "$tmp/repo/src"
  claude_write "$tmp/repo/src/A.fsx" | run_hook >/dev/null
  assert_contains "$(cat "$STUB_LOG")" "$tmp/repo fsharplint" \
    "a bare dotnet-tools.json must count as a manifest and set cwd"
}

test_should_prefer_nearest_manifest_when_nested() {
  local tmp="$1"
  manifest "$tmp/outer/.config/dotnet-tools.json"
  manifest "$tmp/outer/inner/.config/dotnet-tools.json" fantomas
  mkdir -p "$tmp/outer/inner/src"
  local out
  out=$(claude_write "$tmp/outer/inner/src/A.fs" | run_hook)
  assert_eq "$out" "" "the nearest manifest decides, even when an outer one lists FSharpLint"
  assert_eq "$(cat "$STUB_LOG")" "" "the nearest manifest lacking FSharpLint must not spawn dotnet"
}

test_should_resolve_relative_path_against_cwd() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  mkdir -p "$tmp/src"
  jq -nc '{tool_name:"Edit",tool_input:{file_path:"src/A.fs"}}' | run_hook >/dev/null
  assert_eq "$(cat "$STUB_LOG")" "$tmp fsharplint --format msbuild lint $tmp/src/A.fs" \
    "a relative path must be linted as its absolute form"
}

# ---- tests: findings ----

test_should_emit_block_decision_when_findings_exist() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_EXIT=255 STUB_LINT_OUT="Running FSharpLint
$(finding "$tmp/A.fs" 7 FL0065 'late one')
$(finding "$tmp/A.fs" 3 FL0001 'early one')
Finished: 2 warnings"
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$(jq -r .decision <<<"$out")" "block" "findings must block"
  local reason
  reason=$(jq -r .reason <<<"$out")
  assert_contains "$reason" "2 finding(s) in $tmp/A.fs" "header must name the file and count"
  assert_contains "$reason" "$tmp/A.fs:3 FL0001 early one
$tmp/A.fs:7 FL0065 late one" "findings must be listed as path:line RuleId message, sorted by line"
  assert_not_contains "$reason" "Finished" "non-finding output lines must not leak into the report"
  assert_eq "$(jq -r .hookSpecificOutput.additionalContext <<<"$out")" "$reason" \
    "Claude Code additionalContext must carry the same text"
  assert_eq "$(jq -r .additionalContext <<<"$out")" "$reason" \
    "Copilot top-level additionalContext must carry the same text"
}

test_should_report_path_as_given_in_payload() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  mkdir -p "$tmp/src"
  export STUB_LINT_EXIT=255 STUB_LINT_OUT="$(finding "$tmp/src/A.fs" 2 FL0001 m)"
  local out
  out=$(jq -nc '{tool_name:"Edit",tool_input:{file_path:"src/A.fs"}}' | run_hook)
  assert_contains "$(jq -r .reason <<<"$out")" "src/A.fs:2 FL0001 m" \
    "finding lines must use the path the agent used"
}

test_should_cap_listed_findings_and_report_remainder() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  local lines="" i
  for i in $(seq 1 35); do lines+="$(finding "$tmp/A.fs" "$i" FL0001 m)"$'\n'; done
  export STUB_LINT_EXIT=255 STUB_LINT_OUT="$lines"
  local reason
  reason=$(claude_write "$tmp/A.fs" | run_hook | jq -r .reason)
  assert_contains "$reason" "35 finding(s)" "header must count every finding"
  assert_contains "$reason" "A.fs:30 FL0001" "the 30th finding must be listed"
  assert_not_contains "$reason" "A.fs:31 FL0001" "the 31st finding must not be listed"
  assert_contains "$reason" "+5 more" "the remainder must be reported"
}

test_should_emit_nothing_when_lint_output_has_zero_findings() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_EXIT=0 STUB_LINT_OUT="Running FSharpLint
Finished: 0 warnings"
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$out" "" "a clean lint must produce no output"
}

test_should_stay_silent_when_dotnet_fails_with_unparseable_output() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_EXIT=1 STUB_LINT_OUT="Unhandled exception. System.Exception: boom"
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$out" "" "a tool failure must never block"
}

test_should_stay_silent_when_dotnet_is_absent() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  mkdir -p "$tmp/empty"
  local out
  out=$(claude_write "$tmp/A.fs" | PATH="$tmp/empty" run_hook)
  assert_eq "$out" "" "a missing dotnet must produce no output"
}

# ---- tests: restore ----

test_should_restore_then_retry_when_tool_not_restored() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_UNRESTORED=1 STUB_LINT_EXIT=255 STUB_LINT_OUT="$(finding "$tmp/A.fs" 4 FL0001 m)"
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$(cut -d' ' -f2- "$STUB_LOG" | cut -d' ' -f1-2 | paste -sd,)" \
    "fsharplint --format,tool restore,fsharplint --format" "calls must be lint, restore, lint"
  assert_contains "$(cut -d' ' -f1 "$STUB_LOG" | sort -u)" "$tmp" "restore must run in the manifest root"
  assert_contains "$(jq -r .reason <<<"$out")" "A.fs:4 FL0001 m" "findings from the retry must be emitted"
}

test_should_stay_silent_when_restore_fails() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_UNRESTORED=1 STUB_RESTORE_EXIT=1
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$out" "" "a failed restore must produce no output"
  assert_eq "$(grep -c 'tool restore' "$STUB_LOG")" "1" "restore must run exactly once"
  assert_eq "$(grep -c fsharplint "$STUB_LOG")" "1" "lint must not be retried after a failed restore"
}

test_should_restore_at_most_once_when_retry_still_unrestored() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_UNRESTORED=always
  local out
  out=$(claude_write "$tmp/A.fs" | run_hook)
  assert_eq "$out" "" "a still-unrestored retry must produce no output"
  assert_eq "$(grep -c 'tool restore' "$STUB_LOG")" "1" "restore must run at most once"
}

# ---- tests: Copilot payload ----

test_should_handle_copilot_create_payload() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_EXIT=255 STUB_LINT_OUT="$(finding "$tmp/A.fs" 2 FL0001 m)"
  local out
  out=$(jq -nc --arg args "$(jq -nc --arg p "$tmp/A.fs" '{path:$p,file_text:"x"}')" \
    '{toolName:"create",toolArgs:$args,toolResult:{resultType:"success",textResultForLlm:"Created file."}}' \
    | run_hook)
  assert_contains "$(jq -r .additionalContext <<<"$out")" "A.fs:2 FL0001 m" \
    "string-encoded toolArgs must be decoded and linted"
  local text
  text=$(jq -r .modifiedResult.textResultForLlm <<<"$out")
  assert_contains "$text" "Created file." "the original tool result must be kept"
  assert_contains "$text" "A.fs:2 FL0001 m" "findings must ride on the tool result"
}

# ---- tests: scoped handlers ----

test_should_lint_claude_payload_from_scoped_handler() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_EXIT=255 STUB_LINT_OUT="$(finding "$tmp/A.fs" 2 FL0001 m)"
  local out
  out=$(claude_write "$tmp/A.fs" | "$PYTHON" "$HOOK" --scoped)
  assert_eq "$(jq -r .decision <<<"$out")" "block" "a scoped handler must lint a Claude Code edit"
}

test_should_skip_copilot_payload_from_scoped_handler() {
  local tmp="$1"
  manifest "$tmp/.config/dotnet-tools.json"
  export STUB_LINT_EXIT=255 STUB_LINT_OUT="$(finding "$tmp/A.fs" 2 FL0001 m)"
  local out
  out=$(jq -nc --arg args "$(jq -nc --arg p "$tmp/A.fs" '{path:$p}')" '{toolName:"edit",toolArgs:$args}' \
    | "$PYTHON" "$HOOK" --scoped)
  assert_eq "$out" "" "Copilot ignores if:, so a scoped handler it fires must not lint a second time"
  assert_eq "$(cat "$STUB_LOG")" "" "a Copilot payload on a scoped handler must not spawn dotnet"
}

test_should_scope_every_claude_handler_and_leave_copilot_handler_unscoped() {
  local json="$SCRIPT_DIR/../../packages/fsharp/.apm/hooks/fsharplint.json"
  assert_eq "$(jq -c '[.PostToolUse[] | select(.matcher != "edit|create") | .hooks[]
      | select((.if | test("^(Edit|Write|MultiEdit)\\(\\*\\.fsx?\\)$")) and (.command | endswith(" --scoped'\''")) | not)]' "$json")" \
    "[]" "every Claude Code handler must carry an if: rule and --scoped"
  assert_eq "$(jq -c '[.PostToolUse[] | select(.matcher == "edit|create") | .hooks[] | has("if")]' "$json")" \
    "[false]" "the Copilot handler must be single and unscoped"
}

# ---- tests: real FSharpLint ----

test_should_report_real_fsharplint_findings_under_project_config() {
  local tmp="$1"
  export PATH="$REAL_PATH"
  local repo="$tmp/repo"
  manifest "$repo/dotnet-tools.json"
  if ! (cd "$repo" && dotnet fsharplint --version >/dev/null 2>&1); then
    skip "dotnet-fsharplint 0.27.0 not available"
    return
  fi
  # A project config replaces FSharpLint's defaults: only the rules it enables run.
  echo '{"redundantNewKeyword":{"enabled":true}}' > "$repo/fsharplint.json"
  cat > "$repo/Bad.fs" <<'FS'
module Bad

let f a = if a then true else false

let g () = new System.Object()
FS
  local reason
  reason=$(claude_write "$repo/Bad.fs" | "$PYTHON" "$HOOK" | jq -r .reason)
  assert_contains "$reason" "Bad.fs:5 FL0014 Usage of \`new\` keyword here is redundant." \
    "a rule enabled in the project's fsharplint.json must be reported with its line"
  assert_not_contains "$reason" "FL0065" \
    "a default rule the project's fsharplint.json leaves out must not fire"
}

# ---- run ----

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t"
done

echo
echo "Passed: $PASS, Failed: $FAIL, Skipped: $SKIP"
[ "$FAIL" -eq 0 ]
