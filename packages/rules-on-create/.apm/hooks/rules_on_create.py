#!/usr/bin/env python3
"""PreToolUse hook: surface a path-scoped rule when a NEW matching file is authored.

Native `paths:` rules load only when Claude *reads* a matching file. Creating a brand-new
file is never a read, so the rule would miss it — this gate covers that one case. Because
`additionalContext` is not surfaced on PreToolUse (only a *deny* reason is), the first Write
of a new file a rule scopes to is DENIED with the rule body as the reason; Claude re-issues
the write to comply. A per-session marker clears the block after the first surfacing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Imports must not leave __pycache__ inside the deployed hooks dir of a consumer repo.
sys.dont_write_bytecode = True

import hook_io
from rules_on_create_match import match

MARKER_ROOT = "/tmp/claude-rules-on-create"


def main() -> int:
    try:
        hook = hook_io.read("PreToolUse")
    except Exception:
        return 0
    if hook.tool not in hook_io.CREATE_TOOLS:
        return 0

    # Existing files already reach the model via native path-rules on the required prior read.
    new_files = [c.path for c in hook.changes if not os.path.exists(c.path)]
    matched = {rule.name: (path, rule) for path in new_files for rule in match(path)}
    if not matched:
        return 0

    marker_dir = os.path.join(MARKER_ROOT, hook.session_id or "nosession")
    os.makedirs(marker_dir, exist_ok=True)

    unseen = [
        (path, rule) for name, (path, rule) in matched.items()
        if not os.path.exists(os.path.join(marker_dir, name))
    ]
    if not unseen:
        return 0

    for _, rule in unseen:
        open(os.path.join(marker_dir, rule.name), "w").close()

    paths = ", ".join(f"`{p}`" for p in dict.fromkeys(path for path, _ in unseen))
    blocks = [f"### `{rule.name}`\n\n{rule.body.strip()}" for _, rule in unseen]
    reason = (
        f"Path-scoped rule(s) govern the new file(s) {paths}. Read them, then re-issue the "
        f"write to comply — this block clears once per session.\n\n" + "\n\n".join(blocks)
    )
    hook_io.emit(hook_io.deny(hook, reason))
    return 0


if __name__ == "__main__":
    sys.exit(main())
