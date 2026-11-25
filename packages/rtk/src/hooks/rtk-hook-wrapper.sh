#!/usr/bin/env bash
# rtk shim — resolves the real binary, injects RTK_ACTIVE unless bypassed, execs through.
# Never renames or replaces the real binary; lives in its own shim dir on PATH.

resolve_real_rtk() {
  # Skip our own shim dir so `command -v` can't resolve back to this script.
  local shim_dir
  shim_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  local IFS=:
  for dir in $PATH; do
    [ "$dir" = "$shim_dir" ] && continue
    [ -x "$dir/rtk" ] && { echo "$dir/rtk"; return; }
  done
  for candidate in "$RTK_INSTALL_DIR/rtk" "$HOME/.local/bin/rtk" "$HOME/.cargo/bin/rtk" \
                    /opt/homebrew/bin/rtk /usr/local/bin/rtk \
                    /home/linuxbrew/.linuxbrew/bin/rtk; do
    [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
}

# APM deploys one hook descriptor to every target, so `hook auto` resolves the agent from
# where the descriptor put this script: `.github/hooks/` is APM's Copilot layout, anything
# else is the Claude one. `rtk hook <agent>` has no auto-detecting form of its own.
resolve_hook_agent() {
  case "$(cd "$(dirname "$0")" && pwd)" in
    */.github/hooks | */.github/hooks/*) echo copilot ;;
    *) echo claude ;;
  esac
}

if [ "$1" = "hook" ] && [ "$2" = "auto" ]; then
  shift 2
  set -- hook "$(resolve_hook_agent)" "$@"
fi

REAL_RTK=${RTK_BIN:-$(resolve_real_rtk)}
if [ -z "$REAL_RTK" ]; then
  echo "[rtk-shim] WARNING: rtk binary not found. Install: https://github.com/rtk-ai/rtk#installation" >&2
  [ "$1" = "hook" ] && exit 0   # PreToolUse contract: never block the agent's command
  exit 127
fi

case "$1" in
  proxy) : ;;                                          # bypass: raw passthrough, no RTK_ACTIVE
  *) [ -z "${RTK_DISABLED:-}" ] && export RTK_ACTIVE=1 ;;
esac

exec "$REAL_RTK" "$@"
