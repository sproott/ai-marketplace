#!/bin/sh
# Records every hook payload Copilot CLI delivers: the full tool-name registry it emits,
# the per-tool `toolArgs` shape, and whether the PascalCase event form switches to Claude
# matcher semantics and snake_case payloads.
#
# Install:   sh scripts/copilot-hook-probe.sh install
# Then run one Copilot CLI session that edits a file and runs a shell command.
# Read:      sh scripts/copilot-hook-probe.sh report
# Remove:    sh scripts/copilot-hook-probe.sh uninstall
set -eu

HOOKS_DIR="$HOME/.copilot/hooks"
PROBE="$HOOKS_DIR/scripts/probe/probe.sh"
LOG="${TMPDIR:-/tmp}/copilot-hook-probe.jsonl"

case "${1:-}" in
install)
    mkdir -p "$(dirname "$PROBE")"
    cat > "$PROBE" <<EOF
#!/bin/sh
{ printf '{"matcher":"%s","stdin":' "\$PROBE_MATCHER"; cat; printf '}\n'; } >> "$LOG"
printf '{}\n'
EOF
    chmod 755 "$PROBE"
    for m in bash apply_patch view rg glob task Bash Edit Write apply_patch_PascalCase; do
        # The PascalCase variant tests the documented claim that PascalCase event keys switch to Claude matcher semantics and snake_case payloads.
        case "$m" in
            apply_patch_PascalCase) event=PreToolUse; matcher=apply_patch ;;
            *)                      event=postToolUse; matcher=$m ;;
        esac
        cat > "$HOOKS_DIR/probe-$m.json" <<EOF
{
  "hooks": {
    "$event": [
      {
        "matcher": "$matcher",
        "hooks": [
          {
            "type": "command",
            "command": "env PROBE_MATCHER=$m $PROBE",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "version": 1
}
EOF
    done
    echo "probe installed; log: $LOG"
    echo "now run one Copilot CLI session that edits a file and runs a shell command"
    ;;
report)
    [ -f "$LOG" ] || { echo "no hook ever fired — log $LOG does not exist"; exit 1; }
    echo "matchers that fired:"
    python3 -c "
import json, sys
seen = {}
for line in open('$LOG'):
    try:
        rec = json.loads(line)
    except ValueError:
        continue
    payload = rec.get('stdin') or {}
    tool = payload.get('toolName') or payload.get('tool_name')
    args = payload.get('toolArgs') or payload.get('tool_input') or {}
    seen.setdefault((rec['matcher'], tool), set()).update(
        args.keys() if isinstance(args, dict) else []
    )
for (matcher, tool), keys in sorted(seen.items(), key=lambda kv: str(kv[0])):
    print(f'  matcher {matcher!r} -> tool {tool!r}, arg keys: {sorted(keys)}')
"
    ;;
uninstall)
    rm -f "$HOOKS_DIR"/probe-*.json
    rm -rf "$(dirname "$PROBE")"
    echo "probe removed (log kept at $LOG)"
    ;;
*)
    echo "usage: $0 install|report|uninstall" >&2
    exit 2
    ;;
esac
