#!/usr/bin/env bash
# PreToolUse gate: denies Bash until the rtk shim dir is on $PATH. The SessionStart
# installer creates the symlink but cannot edit shell rc files, so activation needs a
# user action (add the export, open a new shell) that a passive notice never forces.
# Denying here is the hard stop that surfaces it.

set -euo pipefail

SHIM_DIR="$HOME/.rtk/shim"

case ":$PATH:" in
  *":$SHIM_DIR:"*) exit 0 ;;
esac

jq -cn --arg dir "$SHIM_DIR" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("RTK shim not on PATH — Bash is blocked until it is activated. Tell the user to add this line to their shell profile (~/.bashrc or ~/.zshrc) and open a new shell:\n  export PATH=\"" + $dir + ":$PATH\"")
  }
}'
