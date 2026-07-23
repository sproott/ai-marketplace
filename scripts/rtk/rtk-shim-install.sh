#!/usr/bin/env bash
# Idempotent installer: symlinks rtk-hook-wrapper.sh into ~/.rtk/shim/ as `rtk`.
# Never edits shell rc files. Emits the PATH-fix instruction only when the shim
# dir is absent from this hook's inherited $PATH — silent once activated.

set -euo pipefail

SHIM_DIR="$HOME/.rtk/shim"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WRAPPER="$SCRIPT_DIR/rtk-hook-wrapper.sh"

mkdir -p "$SHIM_DIR"
ln -sf "$WRAPPER" "$SHIM_DIR/rtk"
chmod +x "$WRAPPER"

case ":$PATH:" in
  *":$SHIM_DIR:"*) exit 0 ;;
esac

echo "RTK SHIM NOT ON PATH — shim installed but inactive. Instruct the user to add the following line to their shell profile (~/.bashrc or ~/.zshrc) and open a new shell:"
echo "  export PATH=\"$SHIM_DIR:\$PATH\""
