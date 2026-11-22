#!/usr/bin/env bash
# Unit tests for fallow-gate-io.sh: where it runs the gate, and Copilot payload I/O.
# The vendored gate is replaced by a stub that prints its working directory.
# Run: bash scripts/fallow/test-fallow-gate-io.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/hooks"
cp "$SCRIPT_DIR/fallow-gate-io.sh" "$WORK/hooks/"
cat > "$WORK/hooks/fallow-gate.sh" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null
pwd -P
[ -f block ] && { echo "blocked"; exit 2; }
exit 0
STUB
chmod +x "$WORK/hooks/"*.sh

repo() {
  git init -q "$1"
  mkdir -p "$1/code/packages/core"
  : > "$1/code/fallow.toml"
}
repo "$WORK/main"
repo "$WORK/other"
repo "$WORK/with space"
mkdir -p "$WORK/plain/sub"
git init -q "$WORK/plain"
MAIN=$(cd "$WORK/main" && pwd -P)
OTHER=$(cd "$WORK/other" && pwd -P)
PLAIN=$(cd "$WORK/plain" && pwd -P)
SPACED=$(cd "$WORK/with space" && pwd -P)

FAIL=0
check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected [$expected], got [$actual]" >&2
    FAIL=1
  fi
}

run() {
  jq -nc --arg cwd "$1" --arg cmd "$2" '{tool_name:"Bash", cwd:$cwd, tool_input:{command:$cmd}}' |
    (cd "$WORK" && bash "$WORK/hooks/fallow-gate-io.sh")
}

check "should audit the fallow config root when the session is in a subdirectory" \
  "$MAIN/code" "$(run "$MAIN/code/packages/core" "git commit -m x")"
check "should audit the cd target when the command starts with cd" \
  "$OTHER/code" "$(run "$MAIN/code" "cd $OTHER/code/packages/core && git commit -m x")"
check "should audit the cd target relative to cwd" \
  "$OTHER/code" "$(run "$WORK" "cd other/code && git commit -m x")"
check "should audit a quoted cd target that contains a space" \
  "$SPACED/code" "$(run "$MAIN/code" "cd \"$SPACED/code\" && git commit -m 'a b'")"
check "should audit a quoted git -C target that contains a space" \
  "$SPACED/code" "$(run "$MAIN/code" "git -C '$SPACED/code' commit -m x")"
check "should audit the payload cwd when a quote is unbalanced" \
  "$MAIN/code" "$(run "$MAIN/code" "git commit -m \"oops")"
check "should audit the git -C target" \
  "$OTHER/code" "$(run "$MAIN/code" "git -C $OTHER/code/packages/core commit -m x")"
check "should audit the repository root when no fallow config exists" \
  "$PLAIN" "$(run "$PLAIN/sub" "git commit -m x")"
check "should audit the payload cwd when it is not a git checkout" \
  "$(cd "$WORK/hooks" && pwd -P)" "$(run "$WORK/hooks" "git commit -m x")"

: > "$OTHER/code/block"
copilot=$(jq -nc --arg cwd "$OTHER/code" '{toolName:"bash", cwd:$cwd, toolArgs:"{\"command\":\"git commit -m x\"}"}' |
  bash "$WORK/hooks/fallow-gate-io.sh")
check "should return a deny decision when the gate blocks a Copilot camelCase payload" \
  "deny" "$(jq -r .permissionDecision <<<"$copilot")"

exit "$FAIL"
