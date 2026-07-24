#!/usr/bin/env bash
# Idempotent installer: symlinks rtk-hook-wrapper.sh into ~/.rtk/shim/ as `rtk`.
# Never edits shell rc files. PATH activation is enforced+surfaced by rtk-shim-gate.sh.

set -euo pipefail

SHIM_DIR="$HOME/.rtk/shim"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WRAPPER="$SCRIPT_DIR/rtk-hook-wrapper.sh"

mkdir -p "$SHIM_DIR"
ln -sf "$WRAPPER" "$SHIM_DIR/rtk"
chmod +x "$WRAPPER"
