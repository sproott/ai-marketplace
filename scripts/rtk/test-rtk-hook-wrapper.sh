#!/usr/bin/env bash
# Standalone unit tests for rtk-hook-wrapper.sh — no vendor/rtk, no APM involved.
# Run: bash scripts/rtk/test-rtk-hook-wrapper.sh

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WRAPPER="$SCRIPT_DIR/rtk-hook-wrapper.sh"

# resolve_real_rtk needs `dirname` externally; fixtures need `bash` to run.
# This machine happens to have a real `rtk` binary on the system PATH
# (/usr/bin, /bin), which would shadow the very fallback paths these tests
# exist to exercise. TOOLBIN is a PATH containing only the non-rtk tools the
# wrapper and fixtures need, so no test can accidentally resolve to the real
# system rtk instead of a fixture.
REAL_BASH=$(command -v bash)
REAL_DIRNAME=$(command -v dirname)
TOOLBIN=$(mktemp -d)
ln -s "$REAL_DIRNAME" "$TOOLBIN/dirname"
# The wrapper's own `#!/usr/bin/env bash` shebang needs `bash` on PATH too.
ln -s "$REAL_BASH" "$TOOLBIN/bash"
trap 'rm -rf "$TOOLBIN"' EXIT

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
# Fixtures use an absolute #!$REAL_BASH shebang (resolved once above) instead
# of `#!/usr/bin/env bash`, so they run under the tests' restricted TOOLBIN
# PATH without needing `env` to resolve `bash` via PATH lookup.

make_fake_rtk() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  {
    echo "#!$REAL_BASH"
    cat <<'EOF'
echo "FAKE_RTK_ARGS:$*"
echo "FAKE_RTK_ACTIVE:${RTK_ACTIVE:-<unset>}"
echo "FAKE_RTK_DISABLED:${RTK_DISABLED:-<unset>}"
EOF
  } > "$path"
  chmod +x "$path"
}

# Each test runs isolated in a subshell: fresh tmp dir, own HOME/PATH. Failures
# are recorded via a marker file, not a shared variable — subshell writes to
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

# ---- tests: resolve_real_rtk candidate discovery ----

test_finds_binary_in_home_local_bin() {
  export HOME
  make_fake_rtk "$HOME/.local/bin/rtk"
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  local out
  out=$("$WRAPPER" git status)
  assert_contains "$out" "FAKE_RTK_ARGS:git status" "should exec the binary found in ~/.local/bin"
}

test_finds_binary_in_home_cargo_bin() {
  export HOME
  make_fake_rtk "$HOME/.cargo/bin/rtk"
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  local out
  out=$("$WRAPPER" git status)
  assert_contains "$out" "FAKE_RTK_ARGS:git status" "should exec the binary found in ~/.cargo/bin"
}

# /opt/homebrew/bin and /usr/local/bin are root-owned in this sandbox and
# can't be populated by an unprivileged test. RTK_INSTALL_DIR exercises the
# identical fallback-loop code path against an arbitrary absolute directory,
# proving the loop mechanism; the hardcoded paths are asserted statically
# below (test_source_lists_standard_install_paths).
test_finds_binary_via_rtk_install_dir() {
  local tmp="$1"
  export HOME
  local install_dir="$tmp/custom-install"
  make_fake_rtk "$install_dir/rtk"
  export RTK_INSTALL_DIR="$install_dir"
  export PATH="$TOOLBIN"
  unset RTK_BIN
  local out
  out=$("$WRAPPER" git status)
  assert_contains "$out" "FAKE_RTK_ARGS:git status" "should exec the binary found via RTK_INSTALL_DIR"
}

test_finds_binary_on_plain_path() {
  local tmp="$1"
  export HOME
  local path_dir="$tmp/pathdir"
  make_fake_rtk "$path_dir/rtk"
  export PATH="$path_dir:$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  local out
  out=$("$WRAPPER" git status)
  assert_contains "$out" "FAKE_RTK_ARGS:git status" "should exec the binary found via a plain PATH entry"
}

test_source_lists_standard_install_paths() {
  assert_contains "$(cat "$WRAPPER")" '/opt/homebrew/bin/rtk' \
    "wrapper source should list /opt/homebrew/bin/rtk as a fallback candidate"
  assert_contains "$(cat "$WRAPPER")" '/usr/local/bin/rtk' \
    "wrapper source should list /usr/local/bin/rtk as a fallback candidate"
  assert_contains "$(cat "$WRAPPER")" '/home/linuxbrew/.linuxbrew/bin/rtk' \
    "wrapper source should list the linuxbrew path as a fallback candidate"
}

test_skips_own_shim_dir_when_scanning_path() {
  local tmp="$1"
  export HOME
  local shim_dir="$tmp/shimdir"
  local real_dir="$tmp/realdir"
  mkdir -p "$shim_dir"
  cp "$WRAPPER" "$shim_dir/rtk-hook-wrapper.sh"
  chmod +x "$shim_dir/rtk-hook-wrapper.sh"
  # A file literally named `rtk` inside the shim dir itself — must be skipped,
  # otherwise the wrapper would exec itself instead of the real binary.
  cp "$WRAPPER" "$shim_dir/rtk"
  chmod +x "$shim_dir/rtk"
  make_fake_rtk "$real_dir/rtk"
  export PATH="$shim_dir:$real_dir:$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  local out
  out=$("$shim_dir/rtk-hook-wrapper.sh" git status)
  assert_contains "$out" "FAKE_RTK_ARGS:git status" "should skip its own shim dir and find the real binary"
}

# ---- tests: missing binary ----

test_missing_binary_hook_subcommand_exits_zero_with_warning() {
  export HOME
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  local err
  err=$("$WRAPPER" hook claude 2>&1 1>/dev/null)
  local status=$?
  assert_eq "$status" "0" "hook subcommand must exit 0 when no binary is found (never block the agent)"
  assert_contains "$err" "WARNING" "should print a stderr warning when no binary is found"
}

test_missing_binary_direct_command_exits_127() {
  export HOME
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  "$WRAPPER" cargo build >/dev/null 2>&1
  local status=$?
  assert_eq "$status" "127" "a direct command with no binary found is a genuine command-not-found"
}

# ---- tests: RTK_ACTIVE injection and bypass ----

test_proxy_subcommand_does_not_set_rtk_active() {
  export HOME
  make_fake_rtk "$HOME/.local/bin/rtk"
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR RTK_DISABLED
  local out
  out=$("$WRAPPER" proxy true)
  assert_contains "$out" "FAKE_RTK_ACTIVE:<unset>" "rtk proxy must not set RTK_ACTIVE"
}

test_rtk_disabled_preserved_and_active_not_set() {
  export HOME
  make_fake_rtk "$HOME/.local/bin/rtk"
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR
  export RTK_DISABLED=1
  local out
  out=$("$WRAPPER" cargo build)
  assert_contains "$out" "FAKE_RTK_ACTIVE:<unset>" "RTK_DISABLED=1 already set must keep RTK_ACTIVE unset"
  assert_contains "$out" "FAKE_RTK_DISABLED:1" "RTK_DISABLED's existing value must be preserved untouched"
}

test_other_subcommand_sets_rtk_active() {
  export HOME
  make_fake_rtk "$HOME/.local/bin/rtk"
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR RTK_DISABLED
  local out
  out=$("$WRAPPER" git status)
  assert_contains "$out" "FAKE_RTK_ACTIVE:1" "any non-proxy subcommand should set RTK_ACTIVE=1"
}

test_hook_subcommand_also_sets_rtk_active() {
  export HOME
  make_fake_rtk "$HOME/.local/bin/rtk"
  export PATH="$TOOLBIN"
  unset RTK_BIN RTK_INSTALL_DIR RTK_DISABLED
  local out
  out=$("$WRAPPER" hook claude)
  assert_contains "$out" "FAKE_RTK_ACTIVE:1" "hook claude is not a bypass mode, RTK_ACTIVE should be set"
}

test_rtk_bin_override_skips_discovery() {
  local tmp="$1"
  export HOME
  # A decoy that would be found by discovery if RTK_BIN were ignored.
  make_fake_rtk "$HOME/.local/bin/rtk"
  local override_dir="$tmp/override"
  mkdir -p "$override_dir"
  {
    echo "#!$REAL_BASH"
    echo 'echo "OVERRIDE_RTK_ARGS:$*"'
  } > "$override_dir/rtk"
  chmod +x "$override_dir/rtk"
  export RTK_BIN="$override_dir/rtk"
  export PATH="$TOOLBIN"
  unset RTK_INSTALL_DIR RTK_DISABLED
  local out
  out=$("$WRAPPER" git status)
  assert_contains "$out" "OVERRIDE_RTK_ARGS:git status" "RTK_BIN override should be used verbatim"
  case "$out" in
    *FAKE_RTK*) fail "RTK_BIN override should skip discovery entirely, but the decoy ran" ;;
  esac
}

# ---- run ----

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  run_test "$t"
done

echo
echo "Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]
