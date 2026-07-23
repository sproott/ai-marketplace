#!/usr/bin/env python3
"""PreToolUse(Write) hook: surface a path-scoped rule when a NEW matching file is authored.

Native `paths:` rules load only when Claude *reads* a matching file. Creating a brand-new
file is never a read, so the rule would miss it — this gate covers that one case. Because
`additionalContext` is not surfaced on PreToolUse (only a *deny* reason is), the first Write
of a new file a rule scopes to is DENIED with the rule body as the reason; Claude re-issues
the write to comply. A per-session marker clears the block after the first surfacing.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rules_on_create_match import match

MARKER_ROOT = "/tmp/claude-rules-on-create"


def _allow() -> int:
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return _allow()

    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not file_path:
        return _allow()

    # Existing files already reach the model via native path-rules on the required prior read.
    if os.path.exists(file_path):
        return _allow()

    matched = match(file_path)
    if not matched:
        return _allow()

    session = payload.get("session_id") or "nosession"
    marker_dir = os.path.join(MARKER_ROOT, session)
    os.makedirs(marker_dir, exist_ok=True)

    unseen = [r for r in matched if not os.path.exists(os.path.join(marker_dir, r.name))]
    if not unseen:
        return _allow()

    for rule in unseen:
        open(os.path.join(marker_dir, rule.name), "w").close()

    blocks = [f"### `{rule.name}`\n\n{rule.body.strip()}" for rule in unseen]
    reason = (
        f"Path-scoped rule(s) govern the new file `{file_path}`. Read them, then re-issue the "
        f"write to comply — this block clears once per session.\n\n" + "\n\n".join(blocks)
    )

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return _allow()


if __name__ == "__main__":
    sys.exit(main())
