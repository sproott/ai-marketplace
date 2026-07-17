#!/usr/bin/env bash
# Idempotent installer: symlinks rtk-hook-wrapper.sh into ~/.rtk/shim/ as `rtk`.
# Never edits shell rc files — prints the PATH export line for the user to add.

set -euo pipefail

SHIM_DIR="$HOME/.rtk/shim"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WRAPPER="$SCRIPT_DIR/rtk-hook-wrapper.sh"

mkdir -p "$SHIM_DIR"
ln -sf "$WRAPPER" "$SHIM_DIR/rtk"
chmod +x "$WRAPPER"

echo "Add this to your shell profile to activate the rtk shim:"
echo "  export PATH=\"$SHIM_DIR:\$PATH\""
