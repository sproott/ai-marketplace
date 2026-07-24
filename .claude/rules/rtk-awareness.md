# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations)

## Meta Commands (always use rtk directly)

```bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history with savings
rtk discover          # Analyze Claude Code history for missed opportunities
rtk proxy <cmd>       # Execute raw command without filtering (for debugging)
```

## Installation Verification

```bash
rtk --version         # Should show: rtk X.Y.Z
rtk gain              # Should work (not "command not found")
which rtk             # Verify correct binary
```

⚠️ **Name collision**: If `rtk gain` fails, you may have reachingforthejack/rtk (Rust Type Kit) installed instead.

## Hook-Based Usage

All other commands are automatically rewritten by the Claude Code hook.
Example: `git status` → `rtk git status` (transparent, 0 tokens overhead)

Refer to CLAUDE.md for full command reference.


## Shim Activation

The rtk PATH shim (`~/.rtk/shim/rtk`) is (re)installed automatically every session via a
`SessionStart` hook, but it only takes effect once `~/.rtk/shim` is on `$PATH` — which
needs a shell rc edit the installer does not make. Until then, a `PreToolUse` gate **denies
every Bash command** with an `RTK shim not on PATH` reason.

**If Bash is denied for that reason, stop and get the user to activate the shim before
anything else.** Tell them to add this line to their shell profile (`~/.bashrc` / `~/.zshrc`)
and open a new shell:

```bash
export PATH="$HOME/.rtk/shim:$PATH"
```
